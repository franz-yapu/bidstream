# bidstream

Motor de subastas orientado a eventos (Node/TS, Kafka, PostgreSQL+Prisma, GraphQL, Azure/Bicep).
Spec normativa: `docs/product/bidstream_spec.md`. PRD/alcance/reglas en `docs/product/`.

## Método (SDD)

1. Planificación: skills `prd-to-tickets` → backlog, roadmap, tickets en `docs/planning/`.
2. Por ticket: `write-sdd` genera `docs/sdd/<ID>/SDD.md` ANTES de codear; luego `task-brief`.
3. Código solo después de un SDD aprobado. Decisiones → ADR (`docs/adr/`) o `docs/decisions/LOG.md`.
4. Respetar `docs/do-not-touch.md`.

## Convenciones

- TypeScript estricto, dominio sin dependencias de infraestructura (hexagonal).
- Dinero en `Decimal(12,2)`. Conventional commits. Documentación en español.
- Pruebas de integración con Postgres y Kafka reales en contenedores.

## Comandos

- `npm ci` instala; `npm run check` = build + typecheck + lint + format:check + test (quality gate). El build va primero: los paquetes se resuelven entre sí desde `dist/`.
- ESM con NodeNext: los imports relativos llevan extensión `.js` (`import { x } from './x.js'`).
- `packages/domain` no puede importar infraestructura (regla de ESLint, ver `docs/do-not-touch.md`).
- `make up` levanta Kafka (apache/kafka 4.3.2, KRaft) y PostgreSQL 16 y crea los topics; `make verify` los comprueba; `make reset` borra datos.
- Desde el host: `KAFKA_BROKERS=localhost:9092`; desde contenedores: `kafka:19092`.
- La CI (`.github/workflows/ci.yml`) ejecuta `npm run check` en Node 22; las acciones se fijan por SHA de commit. `main` se cambia solo por PR.
- Usar **Node 22** (`nvm use`): `@confluentinc/kafka-javascript` no compila en Node 26. `npm run test:integration` (requiere `make up`) corre los `*.int.test.ts`.
- `make migrate` aplica las migraciones de `packages/db`; el cliente Prisma se genera en `postinstall` (`npm run db:generate -w @bidstream/db`). Cambios de esquema: `npm run db:migrate:dev -w @bidstream/db` con `DATABASE_URL` y revisar el SQL; los índices parciales van a mano.
- `npm run dev:api` arranca la API (`apps/api`, Fastify + Zod, `buildApp(deps)` es el punto de composición). Errores siempre `problem+json`, sin trazas al cliente. Los DTO reutilizan `primitives` de `@bidstream/domain`.
- Pruebas de integración: usar `@bidstream/testing` (`createTestDatabase`, `createTestTopic`, `collectMessages`, `waitFor`); cada suite tiene su base de datos y sus topics desechables y **nunca** escribe en los topics reales. Solo se importa desde `*.test.ts` (regla de ESLint). La CI tiene un job `integration` aparte (no requerido por ahora).
- Acceso a datos: `withTransaction(prisma, async ({ lots, auctions, outbox }) => …)` de `@bidstream/db`; los repositorios son de solo lectura y filtran por tenant, y los eventos se escriben con `outbox.enqueue(events, topic)` en la misma transacción.
- Consumidores: `createEventConsumer` de `@bidstream/consumer`; cada uno aporta solo su `handler(event, { tx })`. El evento se registra en `processed_event` en la misma transacción; 4 intentos y luego DLQ (`dlqMessageSchema`). En pruebas, esperar a `onOutcome` (se emite tras el commit), no al retorno del handler.
- Comandos HTTP: la ruta solo traduce; la lógica está en `apps/api/src/commands/` (`openAuction`, `publishLot`) y escribe el evento en el outbox con `withTransaction`. El `201` es «aceptado». La API necesita `DATABASE_URL`; con `NODE_ENV=production` no arranca hasta F1 (tenant por cabecera prohibido). Los ids de aggregates los genera el servidor (UUID v7).
- Relay (`apps/relay`): un solo líder activo (bloqueo asesor sobre una conexión `pg` dedicada); `runOnce()` devuelve solo lo confirmado. El orden de publicación es `(created_at, id)`: C3 debe serializar los comandos de un mismo lote al escribir. `claimPending` solo se usa dentro de una transacción.
- Proyección: `applyEventToProjection(tx, event)` (`@bidstream/db`) traduce cada evento a escrituras y **lanza** `ProjectionError` si el estado es incoherente. `lot.auction_id` no tiene clave foránea (ver D4 §2.4). Reprocesar = `resetProjection` (borra también `processed_event` del `projector`) + reposicionar el grupo a `earliest`; nunca como ruta HTTP. Flujo local completo: `make up && make migrate` y `npm run dev:api` / `dev:relay` / `dev:projector`.
