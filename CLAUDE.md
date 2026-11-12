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

- `npm ci` instala; `npm run check` = typecheck + lint + format:check + test + build (quality gate).
- ESM con NodeNext: los imports relativos llevan extensión `.js` (`import { x } from './x.js'`).
- `packages/domain` no puede importar infraestructura (regla de ESLint, ver `docs/do-not-touch.md`).
