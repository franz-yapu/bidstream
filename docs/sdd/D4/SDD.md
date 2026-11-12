# SDD — D4 · Consumidor `projector`

- **Ticket:** ClickUp **D4** (`868mvty0d`, https://app.clickup.com/t/868mvty0d).
- **Autor:** generado con Claude (Entregable 1).
- **Estado:** Borrador
- **Versión:** 1.0 · **Fecha:** 2026-11-12
- **Fuentes de verdad citadas:**
  1. `docs/product/bidstream_spec.md` §4 (grupo `projector`: estado actual del lote y ranking de pujas), §5 (reproceso: borrar la proyección, reposicionar el grupo a `earliest` y reconstruir desde el log), §6 (modelo de datos y desempate)
  2. `docs/sdd/D3/SDD.md` (`createEventConsumer`, idempotencia, DLQ), `docs/sdd/B1/SDD.md` (esquema, `Bid.id = eventId`, `Bid.awarded`), `docs/sdd/B2/SDD.md` (repositorios de lectura)
  3. `docs/sdd/A1/SDD.md` (`evolveLot`, `evolveAuction`, `compareBids`), `docs/sdd/A2/SDD.md` (contrato y claves de partición), DEC-006
  4. `docs/adr/0001-clave-de-particion-lotid.md`, `docs/do-not-touch.md` — log como fuente de verdad

---

## 0 · Preguntas que el ticket pidió cerrar

| # | Pregunta del ticket | Respuesta |
|---|---|---|
| 1 | ¿Cómo garantiza "determinista y reproducible desde `earliest`"? | Handler sin lecturas del reloj ni de azar, idempotencia de D3, **sin clave foránea entre agregados que viajan por particiones distintas**, y reinicio completo de la proyección (§2.3, §2.4) |

---

## 1 · Alcance

### Entra

- En `@bidstream/db`: `applyEventToProjection(tx, event)`, que traduce cada evento a escrituras sobre `Auction`, `Lot` y `Bid`; y `resetProjection(prisma)`, que borra la proyección **y** los registros de `ProcessedEvent` del `projector`.
- Proceso `apps/projector` (`@bidstream/projector`): compone `createEventConsumer` con el grupo `projector`.
- Migración `0002` que elimina la clave foránea `lot → auction` y la relación del esquema de Prisma (§2.4).
- Pruebas: cada evento, el estado resultante contra `foldLot`/`evolveAuction`, ranking, y el primer flujo completo API → outbox → relay → Kafka → proyección.

### No entra (a propósito)

- La demostración y la prueba del reproceso completo con el grupo reposicionado (G2); aquí solo lo que hace posible que sea correcta.
- Los consumidores `notifier` (D5) y `auditor` (D6) y el endpoint de reproceso del DLQ (D7).
- Las lecturas GraphQL de la proyección (E1).
- Esquema de la bitácora (D6).

### Premisas verificadas (heredadas de `task-brief`)

| Premisa del ticket | Qué hay de verdad |
|---|---|
| "Aplica los eventos con `evolveLot`/`evolveAuction`" | Esas funciones operan sobre estados en memoria (`LotState`); el `projector` escribe filas. La coherencia entre ambos hay que **probarla** (leer la fila con `PrismaLotRepository` y comparar con `foldLot` del mismo historial) |
| "Debe ser determinista y reproducible desde `earliest`" | Dos obstáculos reales: (1) `LotPublished` (clave `lotId`) y `AuctionOpened` (clave `auctionId`) van a **particiones distintas** y en un reproceso el lote puede llegar antes que su subasta, violando la clave foránea `lot.auction_id`; (2) si no se borra también `processed_event` del `projector`, el reproceso ignora todo como duplicado |
| "Respetar el índice único de adjudicación" | `bid_one_awarded_per_lot_idx` (B1): como mucho una puja `awarded` por lote |
| Ranking | `Bid` con índice `(lot_id, amount DESC, placed_at, id)`; `compareBids` es el mismo orden |
| `BidPlaced` no tiene id de puja | Se usa su `eventId` como `Bid.id` (B1) |

---

## 2 · Diseño técnico

### 2.1 Efecto de cada evento

| Evento | Escritura en la proyección |
|---|---|
| `AuctionOpened` | `INSERT Auction(OPEN)` con `tenantId` del evento |
| `LotPublished` | `INSERT Lot(OPEN)`; `currentPrice` y `currentBidder` nulos |
| `BidPlaced` | `INSERT Bid(id = eventId, awarded = false)` y `UPDATE Lot SET currentPrice, currentBidder` |
| `BidRejected` | Sin efecto (el rechazo lo registra el `auditor`) |
| `LotExtended` | `UPDATE Lot SET closesAt` |
| `LotClosed` | `UPDATE Lot SET status = CLOSED, winnerId`; si hay ganador, marca `awarded` la puja de mayor ranking |
| `AuctionClosed` | `UPDATE Auction SET status = CLOSED` |

Un `UPDATE` que no encuentra la fila **lanza** (`ProjectionError`): el evento se reintenta y, si persiste, va al DLQ (D3). Nunca se ignora en silencio.

### 2.2 Adjudicación

Al cerrar con ganador, el `projector` toma la puja de mayor ranking (`ORDER BY amount DESC, placed_at, id LIMIT 1`) y comprueba que coincide con `winnerId` y `finalAmount` del evento; si no coincide, lanza (estado corrupto → DLQ) en lugar de marcar una puja equivocada. Después fija `awarded = true`; si ya hubiera otra adjudicada, el índice único parcial lo impide.

### 2.3 Reproceso

`resetProjection(prisma)`, en una sola transacción: `DELETE` de `bid`, `lot` y `auction`, y de `processed_event` **solo del consumidor `projector`** (el `notifier` y el `auditor` conservan los suyos). Después se reposiciona el grupo `projector` a `earliest` y se reconstruye desde el log. Sin borrar `processed_event`, todos los eventos se tomarían por ya procesados (§1, premisas).

### 2.4 Sin clave foránea entre subasta y lote

Las claves de partición son `auctionId` (eventos de subasta) y `lotId` (eventos de lote), en particiones distintas **sin orden entre sí**. En un reproceso desde `earliest` un consumidor paralelo puede procesar `LotPublished` antes de `AuctionOpened`; con la clave foránea fallaría y, agotados los reintentos, iría al DLQ: la reconstrucción no sería determinista. **Decisión:** la proyección es un dato derivado; se elimina `lot_auction_id_fkey` (migración `0002`) y la relación `Lot.auction` del esquema, conservando la columna `auction_id` indexada. La integridad entre agregados distintos es **consistente en el tiempo, no transaccional**: la garantía real de que un lote pertenece a una subasta existente la da C2 al validar contra la proyección antes de aceptar el comando. Se mantiene la clave foránea `bid → lot`, porque `BidPlaced` y `LotPublished` comparten clave `lotId` y por tanto partición y orden.

### 2.5 Decisiones y por qué

| Decisión | Elección | Por qué |
|---|---|---|
| Dónde vive la lógica | `applyEventToProjection` en `@bidstream/db` | La reutilizan el proceso, las pruebas, G2 y cualquier herramienta de reproceso |
| Proceso | `apps/projector`, composición mínima | La lógica queda probada sin arrancar nada |
| Idempotencia | La de D3 (`ProcessedEvent`) en la misma transacción que las escrituras | Un evento se aplica una vez aunque se entregue dos |
| Escrituras | Inserciones y actualizaciones simples, sin `upsert` | Un duplicado real debe fallar y verse; la deduplicación es de D3, no del handler |
| Dinero | Cadenas decimales a `Decimal(12,2)` directamente | Sin conversiones a `number` (business-rule #6) |
| Estado derivado | El estado del lote lo calcula la base a partir de los eventos, con la misma semántica que `evolveLot` | Una sola definición de "qué significa cada evento", comprobada por prueba |

---

## 3 · Cambios por archivo/módulo

| Archivo/módulo | Cambio |
|---|---|
| `packages/db/prisma/schema.prisma` | Quitar la relación `Lot.auction` y `Auction.lots` |
| `packages/db/prisma/migrations/0002_drop_lot_auction_fk/migration.sql` | `ALTER TABLE lot DROP CONSTRAINT lot_auction_id_fkey` |
| `packages/db/src/projection/apply-event.ts` | `applyEventToProjection(tx, event)` y `ProjectionError` |
| `packages/db/src/projection/reset.ts` | `resetProjection(prisma)` |
| `packages/db/src/index.ts` | Reexporta la proyección |
| `apps/projector/**` | Nuevo `@bidstream/projector`: `main.ts`, `config.ts`, tsconfig |
| `tsconfig.json` (raíz), `package.json` | Referencia y `dev:projector` |
| `docs/sdd/B1/SDD.md` | Nota de que `lot.auction_id` deja de ser clave foránea (revisión 1.1, con changelog) |
| `.env.example`, `README.md`, `CLAUDE.md` | Variables, y cómo arrancar API + relay + projector |

---

## 4 · Plan de tests

Integración con PostgreSQL de `@bidstream/testing`; el flujo completo, también con Kafka.

| Caso | Nivel | Cubre |
|---|---|---|
| Cada uno de los 7 eventos produce el efecto de §2.1 | integración | Tabla de efectos |
| Historial completo (abrir, publicar, pujas, extensión, cierre con ganador): el estado leído con `PrismaLotRepository`/`PrismaAuctionRepository` es igual a `foldLot`/`evolveAuction` del mismo historial | integración | Coherencia con el dominio |
| Lote desierto: `winnerId` y `awarded` nulos | integración | `LotClosed` sin ganador |
| `LotClosed` con un ganador que no coincide con la puja de mayor ranking → lanza y no modifica nada | integración | Estado corrupto |
| `BidPlaced` de un lote que no existe, o `LotExtended`/`LotClosed` sobre un lote inexistente → `ProjectionError` | integración | Sin ignorar en silencio |
| Ranking de pujas con empates (mismo monto): el orden de la base coincide con `compareBids` | integración | Desempate |
| `LotPublished` **antes** que `AuctionOpened` se aplica bien (sin FK) y al llegar la subasta quedan coherentes | integración | §2.4 |
| `resetProjection` vacía `bid`, `lot`, `auction` y los registros del `projector`, **sin** tocar los de otros consumidores | integración | §2.3 |
| Tras `resetProjection`, volver a aplicar el mismo log da exactamente el mismo estado | integración | Determinismo |
| Flujo completo: `POST /v1/auctions`, `POST …/lots` (C2) → relay (D1) → Kafka → `projector` → la proyección refleja ambos | integración (API + relay + consumidor + Kafka + PostgreSQL) | Primera vez de punta a punta |
| Un evento entregado dos veces se aplica una vez | integración | Idempotencia (D3) |
| La migración `0002` se aplica desde cero y `migrate status` queda al día | integración | Migración |

**Deliberadamente sin test:** el reproceso con el grupo de consumidores reposicionado y su vídeo (G2/H5); rendimiento.

---

## 5 · Definition of Done

- [ ] SDD en `docs/sdd/D4/SDD.md`, Estado = Aprobado
- [ ] Los 7 eventos aplicados; el estado coincide con el del dominio para el mismo historial
- [ ] `resetProjection` y reconstrucción determinista verificados
- [ ] Migración `0002` aplicada; `B1` actualizado con su revisión
- [ ] Primer flujo completo API → outbox → relay → Kafka → projector en verde
- [ ] Tests del §4 en verde; `npm run check` y `npm run test:integration` en verde
- [ ] PR con CI verde y fusionado

---

## 6 · Riesgos

| Riesgo | Gravedad | Mitigación |
|---|---|---|
| El estado proyectado se desalinea de `evolveLot` | Alta | Prueba de equivalencia sobre historiales completos (§4); G2 la repite con el log real |
| Quitar la clave foránea permite lotes huérfanos | Media | Es dato derivado; C2 valida la subasta al aceptar el comando; una consulta de integridad puede añadirse al `health` |
| Un evento en DLQ deja la proyección incoherente (decisión ya aceptada en D3) | Alta | Reproceso del DLQ (D7) y reconstrucción completa desde el log (G2) |
| `resetProjection` en producción por error | Alta | Solo desde una herramienta explícita y protegida (G2/D7), nunca desde la API; no se expone como ruta |
| El `projector` es el cuello de botella de la lectura | Baja | Escalable hasta el número de particiones (6 consumidores por grupo) |

---

## 7 · Preguntas abiertas

1. **Eliminar `lot_auction_id_fkey`** (propuesta) para que el reproceso sea determinista, sustituyéndola por validación en C2. ¿Aceptas apartarte del esquema de la spec §6 en este punto? Alternativa: mantener la clave y reintentar hasta que llegue la subasta (frágil: a los ~1,4 s el evento iría al DLQ).
2. **Estricto en `LotClosed`:** si el ganador del evento no coincide con la puja de mayor ranking, el `projector` lanza (DLQ). ¿O prefieres que registre la inconsistencia y siga? Propuesta: lanzar, para no ocultar un estado corrupto.
3. **`BidRejected` sin efecto en la proyección** (lo guarda el `auditor`). ¿De acuerdo? Alternativa: contarlas en el lote para mostrarlas en GraphQL.
4. **`resetProjection` como función de librería**, no como ruta HTTP. ¿De acuerdo?
