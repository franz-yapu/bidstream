# PRD — bidstream

Motor de subastas en tiempo real orientado a eventos (Kafka, event sourcing,
proyecciones, GraphQL, Azure). Para cualquier tipo de producto: arte,
maquinaria, vehículos, ganado, liquidaciones.

**Fuente completa y normativa:** [`bidstream_spec.md`](bidstream_spec.md)
(dominio §2, eventos §3, topics §4, arquitectura §5, datos §6, APIs §7,
seguridad §8, Azure §9, calidad §10, fases §11, README §12).

## Objetivo

Proyecto público y verificable que demuestre el perfil backend orientado a
eventos: Node.js/TypeScript, REST, Kafka, PostgreSQL, Prisma, Clean Code,
OWASP, Azure y GraphQL. Va en la sección de **proyectos** del CV, no en
habilidades. Implementación anterior del dominio: `subastas-cafe-api`
(WebSockets + bloqueos en BD); el README debe compararlas.

## Usuarios

- **Postor** — puja por lotes (REST de comandos, 202 Accepted).
- **Organizador** — crea subastas y lotes.
- **Admin/operador** — reprocesa DLQ, ve health y consumer lag.
- **Entrevistador/lector** — abre el repo, corre `make up`, ve el reproceso.

## Requisitos funcionales (resumen)

1. API REST de comandos versionada (`/v1`): auctions, lots, bids con
   `Idempotency-Key`, health, docs OpenAPI.
2. Patrón outbox + relay hacia Kafka; clave de partición `lotId`.
3. Consumidores independientes: `projector`, `notifier`, `auditor`, con
   idempotencia por `eventId`, 3 reintentos con backoff y DLQ + reproceso admin.
4. API GraphQL de lectura con subscriptions, límites de profundidad,
   complejidad y paginación por cursor.
5. Reproceso: reconstruir la proyección desde el log (offset `earliest`).
6. `SECURITY.md` con mapeo OWASP Top 10.
7. Despliegue Azure (Event Hubs, Container Apps, PostgreSQL Flexible, Key
   Vault, ACR) con Bicep; local con docker-compose KRaft + `make up`.

## Fases

| Fase | Alcance | Esfuerzo |
|---|---|---|
| 1 | Kafka KRaft local, dominio, REST de comandos, outbox, `projector`, Prisma, queries GraphQL | un fin de semana |
| 2 | Idempotencia, reintentos, DLQ, subscriptions, SECURITY.md, CI completa | un fin de semana |
| 3 | Reproceso con video, Azure con Bicep, métricas de lag en Grafana | 2–3 días |
