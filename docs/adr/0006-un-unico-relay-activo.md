# 0006 — Un único relay activo con bloqueo asesor

**Estado:** Aceptada
**Fecha:** 2026-11-13 (decisión tomada en D1)

## Contexto

El relay publica el outbox ([ADR-0002](0002-patron-outbox.md)). Si hubiera dos publicando a la vez,
los eventos de un mismo lote podrían salir fuera de orden, lo que rompe la garantía por lote
([ADR-0001](0001-clave-de-particion-lotid.md)). Aun así, un único proceso es un punto único de fallo.

## Decisión

Solo un relay es líder: obtiene un bloqueo asesor de PostgreSQL sobre una conexión `pg` dedicada y
publica en orden `(created_at, id)`. Los demás esperan; si el líder cae, el bloqueo se libera con
su sesión y otro lo toma.

## Alternativas descartadas

| Alternativa                                        | Por qué no                                                                  |
| -------------------------------------------------- | --------------------------------------------------------------------------- |
| Varios relays con `FOR UPDATE SKIP LOCKED`         | Reparte filas entre procesos y pierde el orden por lote                     |
| Particionar las filas del outbox por clave         | Complejidad de reparto y de rebalanceo para un volumen que no lo exige      |

## Consecuencias

**Se gana:** orden de publicación garantizado; conmutación automática por caída.

**Se pierde:** un solo publicador a la vez (el techo de rendimiento es el de un proceso) y una
conexión dedicada.

**Obliga a:** que quien escribe un lote de eventos los serialice (C3 usará `SELECT … FOR UPDATE`),
porque el relay publica según el orden de escritura.

## Verificación

- SDD: [D1](../sdd/D1/SDD.md) §2.2.
- Pruebas: [`relay.int.test.ts`](../../apps/relay/src/relay.int.test.ts) (liderazgo, orden, fallo parcial);
  código: [`leader.ts`](../../apps/relay/src/leader.ts).
