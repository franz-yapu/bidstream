# 0011 — Decisor único por lote con estado propio

**Estado:** Aceptada
**Fecha:** 2026-11-13 (decisión Q2 del usuario, implementada en C3)

## Contexto

Una puja es válida según el precio vigente del lote. La proyección que lee GraphQL va **por detrás** del
log (consistencia eventual), así que decidir contra ella aceptaría dos pujas seguidas contra el mismo
precio viejo. La versión anterior lo resolvía con un bloqueo asesor en PostgreSQL; este proyecto dice
que el orden lo da la partición ([ADR-0001](0001-clave-de-particion-lotid.md)).

## Decisión

La API **acepta** la puja y publica un comando `PlaceBid` en `bidstream.commands.bid` (clave `lotId`,
por el outbox). Un **decisor** (`apps/decider`) lo consume en el orden de la partición y, en **una
transacción**, lee y bloquea el estado del lote (`lot_decision`), aplica `decideBid` con la hora de
recepción del comando, guarda el nuevo estado y encola los eventos (`BidPlaced`, `BidRejected`,
`LotExtended`). Es el **único escritor** de las decisiones de un lote. `lot_decision` es un modelo de
escritura distinto de la proyección; los eventos que no son suyos (`LotPublished`, `LotClosed`) los
aplica un segundo consumidor (`decider-state`), y los propios se marcan como ya aplicados en la misma
transacción para no repetirlos.

## Alternativas descartadas

| Alternativa                                         | Por qué no                                                                                   |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| La API decide con `SELECT … FOR UPDATE`             | Reintroduce el bloqueo en la base que el proyecto dice evitar y acopla la latencia de la API |
| Decidir contra la proyección                        | Es eventual: dos pujas seguidas verían el mismo precio                                       |
| Reconstruir el estado de memoria desde el log       | Arranque lento y estado perdido al reiniciar; el estado en PostgreSQL es transaccional       |

## Consecuencias

**Se gana:** el orden por lote lo da la partición; cada puja ve el resultado de la anterior sin esperar
al `projector`; el rechazo es un evento más; un cierre por tiempo (D8) entra por la misma partición y no
puede colarse una puja después del ganador.

**Se pierde:** un proceso más y una tabla de estado que mantener; la puja se resuelve de forma asíncrona
(el cliente espera el evento). Si el decisor aún no conoce un lote, el comando se reintenta y, agotados
los intentos, va al DLQ.

**Obliga a:** que el nombre del consumidor `state` coincida con su grupo (si no, volvería a aplicar los
eventos propios y retrocedería el estado); a reconstruir `lot_decision` borrándolo y releyendo el log
con un grupo nuevo (probado); y a que cualquier otro escritor de `BidPlaced`/`LotClosed` pase también
por esta partición.

## Verificación

- SDD: [C3](../sdd/C3/SDD.md), [D8](../sdd/D8/SDD.md).
- Pruebas: [`decider.int.test.ts`](../../apps/decider/src/decider.int.test.ts) (50 pujas simultáneas
  coinciden con el dominio, mismo monto: gana la primera, duplicados, DLQ y reproceso, reconstrucción
  del estado) y código: [`decide.ts`](../../apps/decider/src/decide.ts).
