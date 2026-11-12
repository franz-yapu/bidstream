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
