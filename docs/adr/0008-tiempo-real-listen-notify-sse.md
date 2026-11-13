# 0008 — Tiempo real con `LISTEN/NOTIFY` y SSE

**Estado:** Aceptada
**Fecha:** 2026-11-13 (decisión tomada en D5 y E3)

## Contexto

Los clientes quieren ver cada puja al instante. Cada réplica de GraphQL debe enterarse de los
eventos, pero un grupo de consumidores de Kafka por réplica agotaría los grupos disponibles (y en
Azure Event Hubs están limitados) y complicaría el reparto.

## Decisión

Un único grupo `notifier` consume los eventos y hace `pg_notify` **dentro de la transacción** del
consumidor base. Cada réplica GraphQL escucha con una conexión `pg` dedicada y reparte a sus
suscriptores con un bus en memoria; el cliente recibe por SSE. Las notificaciones se derivan solo
del evento y nunca incluyen la identidad de postores ni ganadores.

## Alternativas descartadas

| Alternativa                        | Por qué no                                                                |
| ---------------------------------- | ------------------------------------------------------------------------- |
| Un grupo de Kafka por réplica      | Límite de grupos (Event Hubs) y rebalanceos al escalar                    |
| Redis pub/sub                      | Infraestructura nueva para algo que PostgreSQL ya ofrece                  |
| WebSockets                         | Más estado y complejidad; SSE basta para flujo en un solo sentido         |

## Consecuencias

**Se gana:** sin infraestructura nueva; escalado de réplicas sin tocar Kafka.

**Se pierde:** entrega best-effort (una réplica desconectada pierde avisos; `onResync` indica recargar);
cola acotada por suscriptor.

**Obliga a:** verificar `LISTEN`/SSE en Azure antes del despliegue (pendiente de H1).

## Verificación

- SDD: [D5](../sdd/D5/SDD.md), [E3](../sdd/E3/SDD.md).
- Pruebas: [`notifier.int.test.ts`](../../packages/notifier/src/notifier.int.test.ts),
  [`subscriptions.int.test.ts`](../../apps/graphql/src/subscriptions.int.test.ts),
  [`flow.int.test.ts`](../../apps/graphql/src/flow.int.test.ts).
