# Log de decisiones

Append-only. Una entrada por respuesta de stakeholder, resolución de
discrepancia, o decisión de alcance que no queda cubierta por un ADR. Nunca se
edita una entrada pasada — se reemplaza con una nueva que referencia el ID
viejo.

Formato:

```
## DEC-001 — <título corto>
**Fecha:** YYYY-MM-DD · **Fuente:** <quién/dónde> · **Estado:** activa | reemplazada por DEC-XXX

<qué se decidió, en lenguaje llano>
```

## DEC-001 — Metodología: SDD con skills y MCP en Claude Code
**Fecha:** 2026-11-12 · **Fuente:** usuario · **Estado:** activa

El proyecto vive en `~/Documentos/bidstream`. Se trabaja con IA (Claude Code)
usando skills del kit de planificación (prd-to-tickets, write-sdd, task-brief…)
y MCPs, y con SDD (Spec-Driven Development): cada ticket tiene su SDD en
`docs/sdd/<ID>/SDD.md` antes de codear. La spec base es `docs/product/bidstream_spec.md`.

## DEC-002 — Tracker ClickUp y carpeta de Drive
**Fecha:** 2026-11-12 · **Fuente:** usuario · **Estado:** activa

Tickets en ClickUp, lista bidstream `901115726262` en FRANZ's Space (igual que SISET). MCP de Google Drive conectado; carpeta de documentos en Drive: `bidstream` (id 1hZw2PqnTcYj8eV-8ju7VfH12MQZ61GgA).

## DEC-003 — ADR-0001 aceptado y SDD 0.1 en borrador
**Fecha:** 2026-11-12 · **Fuente:** usuario (pidió empezar 0.1 y 0.4) · **Estado:** activa

ADR-0001 (clave de partición `lotId`) escrito y aceptado; cierra el ticket 0.4. SDD de 0.1 en `docs/sdd/0.1/SDD.md`, Estado = Borrador, a la espera de aprobación. Pendientes: (a) npm vs pnpm, (b) `contracts` separado o dentro de `domain` (decidir en A2), (c) crear el remoto de GitHub para PR y CI.

## DEC-004 — SDD 0.1 aprobado e implementado; npm
**Fecha:** 2026-11-12 · **Fuente:** usuario · **Estado:** activa

Gestor de paquetes: **npm** (resuelve la pregunta 1 del SDD 0.1). SDD 0.1 aprobado e implementado (commit `dfc409a`). Pendiente: crear el remoto de GitHub y abrir PR (hace falta para 0.3); `npm audit` moderado en dependencia de desarrollo (minimatch vía ESLint 10) → F6.

## DEC-005 — SDD borrador de 0.2 y A2; preguntas abiertas
**Fecha:** 2026-11-12 · **Fuente:** Claude, a petición del usuario · **Estado:** activa (pendiente de respuesta)

SDD en borrador: `docs/sdd/0.2/SDD.md` y `docs/sdd/A2/SDD.md`. Pendientes de decisión: (A2 #1) clave/topic de `AuctionOpened` y `AuctionClosed`, (A2 #2) `meta` opcional en el sobre, (A2 #3) `LotClosed` anulable sin pujas, (A2 #4) valores de `BidRejected.reason`, (0.2 #1) UI de Kafka opcional. Remoto de GitHub aún sin crear.

## DEC-006 — SDD 0.2 y A2 aprobados con las propuestas de Claude
**Fecha:** 2026-11-12 · **Fuente:** usuario · **Estado:** activa

Aprobados `docs/sdd/0.2` y `docs/sdd/A2` con las propuestas: (A2 #1) `AuctionOpened`/`AuctionClosed` van al mismo topic `events.lot` con clave `auctionId` (sin orden garantizado frente a los `LotClosed`); (A2 #2) `meta` opcional reservado en el sobre; (A2 #3) `LotClosed` con `winnerId` y `finalAmount` anulables; (A2 #4) `BidRejected.reason`: `BID_TOO_LOW`, `LOT_CLOSED`, `LOT_NOT_OPEN`, `LOT_NOT_FOUND`, `DUPLICATE_BID` (se revisa con Q2); (0.2 #1) sin UI de Kafka por ahora. Imagen Kafka fijada: `apache/kafka:4.3.2`.

## DEC-007 — 0.2 y A2 implementados
**Fecha:** 2026-11-12 · **Fuente:** Claude · **Estado:** activa

0.2 implementado (commit `dce8afb`, `make verify` en verde) y A2 implementado (contrato de eventos con Zod, 55 tests). Pendiente: remoto de GitHub y PR; ClickUp sin cambio de estado.

## DEC-008 — Repo en GitHub y SDD borrador de 0.3, A1 y A3
**Fecha:** 2026-11-12 · **Fuente:** usuario · **Estado:** activa (pendiente de respuesta)

Remoto `git@github.com:franz-yapu/bidstream.git` (público) conectado y `main` subido (sin secretos: `.env` y `.clickup.json` ignorados). SDD en borrador: 0.3 (CI; pendiente decidir protección de `main`), A3 (puertos; pendiente si hace falta `UnitOfWork`) y A1 (dominio; pendiente: primera puja `>= startingPrice`, extensión anti-sniping desde `closesAt`, `AuctionClosed` solo sin lotes abiertos, un postor puede subir su propia puja).

## DEC-010 — Ola 1 completa
**Fecha:** 2026-11-12 · **Fuente:** Claude · **Estado:** activa

Ola 1 terminada: 0.1, 0.2, 0.3, 0.4, A1, A2, A3 (19 h). CI verde, `main` protegida (PR + check `check`), 106 tests. ClickUp: los 7 tickets en `completadas`. Nota: 0.1, 0.2, 0.4 y A2 se subieron directo a `main` antes de activar la protección; A1, A3 y 0.3 fueron por PR. Siguiente: Ola 2 (SDD + tickets).

## DEC-011 — Tickets de la Ola 2 creados
**Fecha:** 2026-11-12 · **Fuente:** usuario ("ola 2") · **Estado:** activa

22 tickets de la Ola 2 creados en la lista bidstream de ClickUp (B1, B2, C1, C2, D1–D7, E1–E3, F4, F6, G1, G2, H2, H5, I1, I2; 83 h), asignados al usuario. Cuerpos en `docs/planning/2026-11-12-tickets-ola2/`. Quedan sin ticket las tareas de la Ola 3 (bloqueadas por Q1–Q5). Siguiente: SDD por ticket antes de codear, empezando por B1, C1 y D2.

## DEC-012 — SDD borrador de B1, C1 y D2
**Fecha:** 2026-11-12 · **Fuente:** usuario (pidió los SDD), Claude · **Estado:** activa (pendiente de respuesta)

SDD en borrador: `docs/sdd/B1`, `C1` y `D2`. Hallazgos sobre la spec §6: (1) `ProcessedEvent` con `eventId @id` más `@@unique([eventId, consumer])` impide que dos consumidores registren el mismo evento; se corrige con clave primaria compuesta; (2) el índice único parcial "dos lotes adjudicados" es redundante con la clave primaria de `Lot`; se propone `Bid.awarded` + índice único parcial por lote. Decisiones propuestas: Prisma 7.10.1 en `packages/db`; Fastify 5 + Zod + `problem+json` en `apps/api`; `@confluentinc/kafka-javascript` en `packages/kafka` (`kafkajs` sin mantenimiento desde 2023). Preguntas: ver §7 de cada SDD.

## DEC-013 — SDD de B1, C1 y D2 aprobados con las propuestas; D2 implementado
**Fecha:** 2026-11-12 · **Fuente:** usuario · **Estado:** activa

Aprobados con las propuestas de Claude: (B1) `Bid.awarded` + índice único parcial, `ProcessedEvent` con clave compuesta, cliente Prisma generado en `postinstall` sin versionar, `snake_case`; (C1) Fastify, `problem+json`, `/v1/docs` también en producción, GraphQL en `apps/graphql`; (D2) `@confluentinc/kafka-javascript`. D2 implementado. **Hallazgo:** esa librería no compila en Node 26 (sin binario precompilado, la compilación falla) y funciona con el binario precompilado en Node 22; el proyecto usa Node 22 y no debe subirse a 26 sin repetir el spike. `consumer.stop()` no está implementado.

## DEC-014 — B1 implementado
**Fecha:** 2026-11-12 · **Fuente:** Claude · **Estado:** activa

B1 implementado: `@bidstream/db` (Prisma 7.10.1), migración `0001_init`, 12 pruebas de integración. Correcciones a la spec §6 vigentes: `ProcessedEvent` con clave primaria `(event_id, consumer)`; `Bid.awarded` con índice único parcial por lote en lugar de un índice redundante sobre `Lot`; `Bid.id` = `eventId` del `BidPlaced`. Aviso para D4/E1: en consultas con `amount::text`, calificar la columna en el `ORDER BY`.

## DEC-015 — C1 implementado
**Fecha:** 2026-11-12 · **Fuente:** Claude · **Estado:** activa

C1 implementado: `apps/api` (Fastify 5 + Zod), `/v1/health`, `/v1/docs`, errores `problem+json` con URN, `x-request-id` validado. Arranque: `npm run dev:api` (puerto 3000 por defecto). Las rutas de C2/C3 se añaden como plugins bajo `/v1` en `buildApp`.

## DEC-016 — B1, C1 y D2 completados
**Fecha:** 2026-11-12 · **Fuente:** Claude · **Estado:** activa

B1, C1 y D2 fusionados (PR #8, #9, #10) y en `completadas` en ClickUp. Estado: 10 de 39 tareas, 32 h de 152. 134 tests unitarios y 16 de integración. Siguiente en la Ola 2 (dependencias ya cumplidas): B2 (repositorios Prisma y outbox), D3 (consumidor base), G1 (utilidades de integración), F4, F6, H2 después. Camino crítico: B2 → C2 → D1 → D4.

## DEC-017 — SDD borrador de G1, B2 y D3
**Fecha:** 2026-11-12 · **Fuente:** usuario ("vamos las tareas"), Claude · **Estado:** activa (pendiente de respuesta)

SDD en borrador: `docs/sdd/G1`, `B2`, `D3`. Propuestas: G1 contra `make up` (sin testcontainers) con bases y topics desechables, paquete `@bidstream/testing` y job `integration` en la CI (no requerido al principio); B2 con `OutboxMessage.id = eventId`, `withTransaction` en `@bidstream/db` y repositorios de solo lectura filtrados por tenant; D3 con 4 intentos (200 ms, factor 2, jitter), idempotencia en la misma transacción que el handler, DLQ con el error adjunto, paquete `@bidstream/consumer`. Riesgo a decidir (D3 §7 #2): ¿DLQ y seguir, o pausar la partición ante un fallo persistente del `projector`?

## DEC-018 — SDD de G1, B2 y D3 aprobados con las propuestas; G1 implementado
**Fecha:** 2026-11-12 · **Fuente:** usuario · **Estado:** activa

Aprobados con las propuestas de Claude: (G1) `make up`, job `integration` no obligatorio al principio, logs solo en el job; (B2) `OutboxMessage.id = eventId`, `withTransaction` en `@bidstream/db`, consultas de pendientes del relay en el mismo repositorio; (D3) 4 intentos totales (200 ms, factor 2, jitter), paquete `@bidstream/consumer`, gancho de logger ahora y métricas en H4; ante fallo persistente del `projector`, DLQ y seguir (como pide la spec), mitigado con D7 y G2. G1 implementado: `@bidstream/testing` y job `integration`. **Pendiente de decidir más adelante:** hacer `integration` check requerido de `main` tras una semana estable.

## DEC-019 — B2 implementado
**Fecha:** 2026-11-12 · **Fuente:** Claude · **Estado:** activa

B2 implementado: `PrismaLotRepository`, `PrismaAuctionRepository`, `PrismaOutbox` y `withTransaction` en `@bidstream/db`. Uso: `withTransaction(prisma, async ({ lots, outbox }) => { ... outbox.enqueue(events, TOPICS.eventsLot) })` (el topic lo pasa la app; `db` no depende de `kafka`). Atomicidad lectura + outbox verificada; la carrera entre pujas sigue ligada a Q2.

## DEC-020 — D3 implementado
**Fecha:** 2026-11-12 · **Fuente:** Claude · **Estado:** activa

D3 implementado: `@bidstream/consumer` con `createEventConsumer({ kafka, prisma, consumerName, handler, ... })` para `projector`, `notifier` y `auditor`. Idempotencia por `(eventId, consumer)` en la misma transacción que el handler; 4 intentos con backoff y jitter; DLQ con `dlqMessageSchema` (lo leerá D7); `onOutcome` para métricas. Riesgo aceptado y vigente: un evento en DLQ no detiene a los siguientes del mismo lote.
