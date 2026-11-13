# 0004 — GraphQL solo para lecturas, REST para comandos

**Estado:** Aceptada
**Fecha:** 2026-11-13 (decisión de la spec §7, implementada en E1–E3)

## Contexto

Los clientes necesitan consultas flexibles sobre lotes, pujas y subastas, y notificaciones en tiempo
real; en cambio, los comandos son pocos, con semántica de aceptación y errores propios. Mezclar
ambos en una sola API acopla su escalado y su superficie de ataque.

## Decisión

Los comandos van por la API REST (`apps/api`) y las lecturas por GraphQL (`apps/graphql`), que
**no define mutaciones**. GraphQL lee solo de la proyección y expone una subscription por SSE.
Ningún campo expone la identidad de postores ni ganadores.

## Alternativas descartadas

| Alternativa                                | Por qué no                                                                      |
| ------------------------------------------ | ------------------------------------------------------------------------------- |
| GraphQL para todo (con mutaciones)         | Las mutaciones heredarían los límites de coste de las consultas y ocultarían el `202` |
| REST para todo                             | Lecturas rígidas, más viajes de ida y vuelta y sin tiempo real natural          |
| Un solo servidor con CQRS interno          | No permite escalar ni proteger por separado lecturas y escrituras               |

## Consecuencias

**Se gana:** escalado independiente; lecturas flexibles y acotadas por límites (profundidad,
complejidad, alias); una superficie de escritura mínima.

**Se pierde:** dos APIs y dos formatos de error (`problem+json` y errores GraphQL); consistencia
eventual entre lo escrito y lo leído.

**Obliga a:** que la proyección sea la única fuente de lectura y que los límites de GraphQL se
apliquen antes de los resolvers.

## Verificación

- SDD: [E1](../sdd/E1/SDD.md) (solo lecturas), [E2](../sdd/E2/SDD.md) (límites), [E3](../sdd/E3/SDD.md) (subscriptions).
- Pruebas: [`graphql.int.test.ts`](../../apps/graphql/src/graphql.int.test.ts),
  [`limits.int.test.ts`](../../apps/graphql/src/limits.int.test.ts),
  [`flow.int.test.ts`](../../apps/graphql/src/flow.int.test.ts).
