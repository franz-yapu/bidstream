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
