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
