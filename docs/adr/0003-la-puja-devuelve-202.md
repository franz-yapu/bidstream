# 0003 — La puja devuelve `202 Accepted`, no `201`

**Estado:** Aceptada
**Fecha:** 2026-11-13 (decisión de la spec §7)

## Contexto

Una puja es un comando que el sistema solo puede resolver cuando el evento se procesa: depende del
precio actual y de las demás pujas del lote, y el resultado (ganadora, superada, rechazada) se
conoce después, de forma asíncrona. Los demás comandos (`201`) son «aceptado» porque su efecto es
la creación de un recurso con id conocido.

## Decisión

`POST /v1/lots/:id/bids` responde `202 Accepted` con el `commandId`: el comando se **acepta**, no se
resuelve. Lo resuelve un decisor ([ADR-0011](0011-decisor-unico-por-lote.md)) y el resultado llega por
evento (`BidPlaced` o `BidRejected`), que se consulta o suscribe por GraphQL
([ADR-0004](0004-graphql-solo-lecturas.md)). Una puja baja o tardía **no** es un error HTTP.

## Alternativas descartadas

| Alternativa                                   | Por qué no                                                                       |
| --------------------------------------------- | -------------------------------------------------------------------------------- |
| `201` con el resultado síncrono               | Obligaría a la API a esperar al consumidor: acopla latencia y disponibilidad     |
| Esperar el evento antes de responder          | Convierte un sistema asíncrono en uno síncrono disfrazado y fallaría con tiempos de espera |

## Consecuencias

**Se gana:** la API no depende de la velocidad de los consumidores; el contrato dice la verdad sobre
lo que ocurrió (se aceptó, no se resolvió).

**Se pierde:** el cliente debe esperar el resultado (suscripción o consulta); más trabajo para quien
integra.

**Obliga a:** exponer el seguimiento del resultado (consulta por id y subscription).

## Verificación

- SDD: [C3](../sdd/C3/SDD.md) (implementación), [C1](../sdd/C1/SDD.md) y [C2](../sdd/C2/SDD.md) (semántica de
  «aceptado»).
- Decisiones: [`LOG.md`](../decisions/LOG.md) (Q2 resuelta: consumidor decisor, DEC-045).
- Pruebas: [`decider.int.test.ts`](../../apps/decider/src/decider.int.test.ts) (202, comando en el outbox,
  rechazos como eventos) y [`commands.int.test.ts`](../../apps/api/src/commands.int.test.ts).
