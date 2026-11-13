# 0007 — Consumidores idempotentes: registro transaccional, reintentos y DLQ

**Estado:** Aceptada
**Fecha:** 2026-11-13 (decisión tomada en D2 y D3)

## Contexto

La entrega es al menos una vez ([ADR-0002](0002-patron-outbox.md)): un mismo evento puede llegar dos
veces. Además, un evento que falla (por un error transitorio o por un dato roto) no debe detener
los siguientes ni perderse.

## Decisión

Cada consumidor registra `(eventId, consumer)` en `processed_event` **en la misma transacción** que
aplica el evento: o se aplica y se registra, o ninguna de las dos cosas. Un evento ya registrado se
ignora como duplicado. Si el handler falla, se reintenta 4 veces con espera creciente y, agotados,
el mensaje va al DLQ con el error adjunto y el offset se confirma. El DLQ se reprocesa por una
ruta administrativa con tope de 3 reprocesos por evento (D7).

## Alternativas descartadas

| Alternativa                         | Por qué no                                                                  |
| ----------------------------------- | --------------------------------------------------------------------------- |
| Idempotencia en memoria             | Se pierde al reiniciar y no es compartida entre réplicas                    |
| _Exactly-once_ de Kafka             | Solo cubre Kafka → Kafka, no Kafka → PostgreSQL                             |
| Sin DLQ (reintentar para siempre)   | Un evento venenoso bloquearía la partición entera                           |

## Consecuencias

**Se gana:** un evento se aplica una sola vez aunque se entregue dos; un fallo no detiene al resto.

**Se pierde:** una fila por evento y consumidor; un evento en el DLQ no detiene a los posteriores del
lote, así que puede aplicarse fuera de orden al reprocesarse (límite documentado de D7; para
integridad total, el reproceso completo de [ADR-0009](0009-el-log-es-la-fuente-de-verdad.md)).

**Obliga a:** que los handlers escriban solo dentro de la transacción que se les entrega.

## Verificación

- SDD: [D2](../sdd/D2/SDD.md), [D3](../sdd/D3/SDD.md), [D7](../sdd/D7/SDD.md).
- Pruebas: [`event-consumer.int.test.ts`](../../packages/consumer/src/event-consumer.int.test.ts),
  [`processor.int.test.ts`](../../packages/consumer/src/processor.int.test.ts),
  [`dlq-admin.int.test.ts`](../../packages/consumer/src/dlq-admin.int.test.ts).
