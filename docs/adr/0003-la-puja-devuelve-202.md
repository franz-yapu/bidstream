# 0003 — La puja devuelve `202 Accepted`, no `201`

**Estado:** Aceptada
**Fecha:** 2026-11-13 (decisión de la spec §7)

> **Nota:** la decisión está tomada pero **aún no está implementada**: `POST …/bids` llega con C3,
> bloqueado por la decisión Q2 (autoridad de la puja). Este ADR se revisará al escribir el SDD de C3
> y se reemplazará si Q2 cambia la arquitectura.

## Contexto

Una puja es un comando que el sistema solo puede resolver cuando el evento se procesa: depende del
precio actual y de las demás pujas del lote, y el resultado (ganadora, superada, rechazada) se
conoce después, de forma asíncrona. Los demás comandos (`201`) son «aceptado» porque su efecto es
la creación de un recurso con id conocido.

## Decisión

`POST …/bids` responde `202 Accepted` con un identificador de seguimiento: el comando se **acepta**,
no se resuelve. El resultado llega por evento y se consulta o suscribe por GraphQL
([ADR-0004](0004-graphql-solo-lecturas.md)).

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

- SDD: [C1](../sdd/C1/SDD.md) y [C2](../sdd/C2/SDD.md) (semántica de «aceptado» de los comandos ya
  implementados); el SDD de C3 se escribirá cuando se resuelva Q2.
- Decisiones: [`LOG.md`](../decisions/LOG.md) (Q2 abierta).
- Pruebas actuales del contrato «aceptado»: [`commands.int.test.ts`](../../apps/api/src/commands.int.test.ts).
