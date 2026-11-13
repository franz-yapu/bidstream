# 0002 — Patrón outbox: nunca escritura dual

**Estado:** Aceptada
**Fecha:** 2026-11-13 (decisión de la spec §5, formalizada al implementarla en B2 y D1)

## Contexto

Un comando válido debe dejar constancia en la base de datos **y** publicarse como evento en Kafka.
Hacer las dos cosas por separado deja una ventana en la que una falla pierde el evento (se guardó
pero no se publicó) o inventa uno (se publicó pero la transacción se revirtió).

## Decisión

La API escribe el evento en la tabla `outbox_message` **dentro de la misma transacción** que valida
el comando. Un proceso aparte, el relay, lee las filas pendientes y las publica en Kafka; solo marca
como publicada la fila que Kafka confirmó. La API nunca habla con Kafka al aceptar un comando.

## Alternativas descartadas

| Alternativa                                      | Por qué no                                                                                      |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Guardar en la base y publicar en Kafka después   | Escritura dual: una caída entre ambos pasos pierde o duplica el evento sin forma de detectarlo  |
| Transacciones distribuidas (2PC)                 | Kafka y PostgreSQL no comparten coordinador; complejidad y disponibilidad peores                |
| _Change data capture_ sobre las tablas           | Infraestructura adicional (conector, WAL lógico) para un volumen que no la justifica            |

## Consecuencias

**Se gana:** no se pierden ni se inventan eventos; el estado aceptado y el evento nacen o no nacen
juntos; la API sigue aceptando comandos aunque Kafka esté caído.

**Se pierde:** latencia extra (el evento sale cuando el relay lo recoge) y un componente más que
operar. La entrega es **al menos una vez**: puede haber duplicados.

**Obliga a:** que todo consumidor sea idempotente ([ADR-0007](0007-consumidores-idempotentes-y-dlq.md));
a un único relay activo ([ADR-0006](0006-un-unico-relay-activo.md)); y a escribir los eventos de un
mismo lote en el orden en que deben publicarse (el relay publica por `(created_at, id)`).

## Verificación

- SDD: [B2](../sdd/B2/SDD.md) (atomicidad), [D1](../sdd/D1/SDD.md) (relay, orden, fallo parcial).
- Pruebas: [`outbox-to-kafka.int.test.ts`](../../packages/testing/src/outbox-to-kafka.int.test.ts),
  [`relay.int.test.ts`](../../apps/relay/src/relay.int.test.ts),
  [`db.int.test.ts`](../../packages/db/src/db.int.test.ts).
