# 0001 — Clave de partición `lotId` en los topics de Kafka

**Estado:** Aceptada
**Fecha:** 2026-11-12

## Contexto

Todas las pujas de un mismo lote deben procesarse en orden estricto: la regla
de negocio "a igual monto gana la primera en el tiempo" y el cálculo del
precio actual dependen de ese orden. La implementación anterior
(`subastas-cafe-api`, WebSockets) lo garantizaba con un *advisory lock* en
PostgreSQL: correcto, pero serializa en la base de datos y no escala
horizontalmente.

Kafka garantiza orden solo **dentro de una partición**. La clave del mensaje
decide en qué partición cae.

## Decisión

Se usa `lotId` como clave de partición en `bidstream.commands.bid` y
`bidstream.events.lot` (y su DLQ), con 6 particiones en los dos primeros y 1
en el DLQ. Todas las pujas y eventos de un lote caen en la misma partición y
se procesan en orden. El orden deja de imponerlo un bloqueo en la base y lo
impone la partición.

## Alternativas descartadas

| Alternativa | Por qué no |
|---|---|
| Advisory lock en PostgreSQL (versión anterior) | Serializa en la base, no escala horizontalmente, acopla orden a una transacción |
| Clave `auctionId` | Todos los lotes de una subasta compartirían partición: hot spot y orden innecesario entre lotes que no se relacionan |
| Sin clave (round-robin) | Pierde el orden por lote; haría falta coordinación externa |
| Clave `tenantId` | Un tenant grande saturaría una sola partición |

## Consecuencias

**Se gana:** orden estricto por lote sin bloqueos; throughput horizontal (los
lotes se reparten entre particiones y consumidores del grupo); el reproceso
desde el log respeta el mismo orden.

**Se pierde:**
- No se puede rebalancear un **lote caliente** entre particiones: si un lote
  concentra casi todas las pujas, su partición es el techo de rendimiento.
- El número de particiones limita el paralelismo máximo de cada consumer group
  (6 consumidores útiles por grupo). Cambiarlo después reparte las claves de
  otra forma y rompe el orden histórico para eventos en vuelo.
- Los eventos de un mismo lote deben nacer siempre con la clave correcta;
  un productor que la omita rompe la garantía.

**Obliga a:** que todo productor use `lotId` como clave; que cualquier cambio
de clave o de número de particiones pase por un ADR nuevo que reemplace a este
(ver `docs/do-not-touch.md`).
