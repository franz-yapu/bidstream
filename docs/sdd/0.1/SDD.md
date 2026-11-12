# SDD — 0.1 · Monorepo Node/TypeScript estricto

- **Ticket:** ClickUp **0.1** (`868mvtfny`, https://app.clickup.com/t/868mvtfny).
- **Autor:** generado con Claude (Entregable 1).
- **Estado:** Implementado (2026-11-12) — aprobado el mismo día
- **Versión:** 1.0 · **Fecha:** 2026-11-12
- **Fuentes de verdad citadas:**
  1. `docs/product/bidstream_spec.md` §1 (Node con TypeScript estricto, Clean Code, Agile), §10 (calidad, CI)
  2. `docs/product/PRD.md` §Requisitos funcionales #1–#7
  3. `docs/product/scope.md` §Entra
  4. `docs/do-not-touch.md` — "Dominio sin dependencias de infraestructura"
  5. `docs/decisions/LOG.md` — DEC-001 (SDD antes de código)

---

## 1 · Alcance

### Entra

- Monorepo con **npm workspaces**: `packages/*` y `apps/*`.
- Paquete `packages/domain` con una exportación mínima y su prueba, para que typecheck, lint, test y build tengan algo real que ejecutar.
- TypeScript en modo estricto con una `tsconfig.base.json` compartida.
- ESLint (flat config) + Prettier.
- Conventional commits: commitlint + hook `commit-msg` con husky; hook `pre-commit` con lint-staged.
- Scripts raíz: `typecheck`, `lint`, `format`, `test`, `build`, `check` (los cuatro en cadena; es el *quality gate* que usará la CI de 0.3).
- `.nvmrc`, `engines`, `.editorconfig`.

### No entra (a propósito)

- Apps (`api`, `relay`, consumidores): las crean sus tickets (C1, D1, D4…); aquí `apps/` existe solo como patrón de workspace.
- `docker-compose` y Kafka/PostgreSQL → 0.2.
- Workflow de GitHub Actions → 0.3 (este ticket deja el script `check` que 0.3 invocará).
- Auditoría de dependencias y Dependabot → F6.
- Código de dominio real (reglas, eventos) → A1/A2/A3. El archivo de `packages/domain` es un marcador.

### Premisas verificadas (heredadas de `task-brief`)

| Premisa del ticket | Qué hay de verdad en el repo |
|---|---|
| "No hay código previo que reutilizar" | Cierto: el repo solo tiene `docs/`, `.claude/`, `_templates/`, `scripts/tracker/` y `.clickup.json`. No existe `package.json`, ni `tsconfig`, ni `src/` |
| Workspaces `packages/domain`, `apps/*` | `apps/` y `packages/` no existen todavía; se crean aquí |
| Node disponible | Node v26.11.1 / npm 11.20.0 en la máquina de desarrollo; el proyecto fija una LTS más baja (ver §2.1) |

---

## 2 · Diseño técnico

### 2.1 Decisiones y por qué

| Decisión | Elección | Por qué |
|---|---|---|
| Gestor de paquetes | **npm workspaces** | Sin dependencias extra; SISET usa lo mismo; el proyecto es chico. pnpm/turbo no aportan aquí y suman fricción para quien clone |
| Versión de Node | `.nvmrc` y `engines.node` = **22** (LTS), `>=22` | Evita fijar la 26 del equipo de desarrollo; las imágenes de Docker (H2) y Azure Container Apps tienen Node 22 estable |
| Módulos | **ESM** (`"type": "module"`), `module`/`moduleResolution` = `NodeNext` | Estándar actual; los clientes de Kafka y Prisma lo soportan |
| TypeScript | Último estable 5.x, `strict: true` más `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `verbatimModuleSyntax` | La spec exige "TypeScript estricto". Esas flags cazan errores reales en dominio con dinero y mapas |
| Referencias entre paquetes | `tsc -b` con **project references** y `composite: true` | Orden de build correcto y typecheck incremental sin herramientas extra |
| Test runner | **Vitest** | Soporta TS/ESM sin configuración; usa la misma sintaxis que Jest; la spec pide pruebas de dominio puras y de integración (G1) |
| Lint | ESLint 9 flat config + `typescript-eslint` (reglas `strictTypeChecked`) + regla `no-restricted-imports` en `packages/domain` | Hace cumplir mecánicamente la regla de `docs/do-not-touch.md`: el dominio no importa `@prisma/client`, `kafkajs`, `express`, etc. |
| Formato | Prettier (configuración por defecto + `singleQuote`, `printWidth: 100`) | Evita discusiones de estilo |
| Commits | commitlint con `@commitlint/config-conventional`, hook `commit-msg` | La spec §1 pide conventional commits como evidencia de Agile |
| Hooks | husky + lint-staged (`pre-commit`: eslint --fix y prettier sobre archivos staged) | Falla temprano, antes de la CI |

### 2.2 Estructura

```
bidstream/
├── package.json                # workspaces, scripts, engines, devDependencies
├── tsconfig.base.json          # opciones estrictas compartidas
├── tsconfig.json               # solution file: references a cada paquete
├── eslint.config.js
├── .prettierrc.json  .prettierignore  .editorconfig  .nvmrc
├── commitlint.config.js
├── .husky/{pre-commit,commit-msg}
├── packages/
│   └── domain/
│       ├── package.json        # name: @bidstream/domain
│       ├── tsconfig.json       # extends base, composite, outDir dist
│       └── src/index.ts        # marcador: export const DOMAIN_PACKAGE = '@bidstream/domain'
│       └── src/index.test.ts
└── apps/                       # vacío (.gitkeep); lo llenan C1, D1, D4...
```

### 2.3 Scripts raíz

| Script | Qué hace |
|---|---|
| `typecheck` | `tsc -b --noEmit` equivalente (`tsc -b` con `emitDeclarationOnly` según proyecto) |
| `lint` | `eslint .` |
| `format` / `format:check` | `prettier --write .` / `--check .` |
| `test` | `vitest run` |
| `build` | `tsc -b` |
| `check` | `typecheck && lint && format:check && test && build` — el *quality gate* |

### 2.4 Regla de pureza del dominio

En `eslint.config.js`, para `packages/domain/**`: `no-restricted-imports` con la lista `@prisma/client`, `prisma`, `kafkajs`, `@confluentinc/*`, `fastify`, `express`, `graphql`, `pg`, `node:fs`, `node:net`, `node:http` y patrón `**/apps/**`. Así el dominio solo puede depender de librerías puras (p. ej. Zod, `uuid`).

---

## 3 · Cambios por archivo/módulo

| Archivo/módulo | Cambio |
|---|---|
| `package.json` (raíz) | Nuevo: `private`, `type: module`, `workspaces: ["packages/*","apps/*"]`, `engines`, scripts de §2.3, devDependencies |
| `tsconfig.base.json` | Nuevo: opciones estrictas de §2.1, `target: ES2023`, `module/moduleResolution: NodeNext`, `skipLibCheck: true` |
| `tsconfig.json` | Nuevo: `files: []` + `references: [{ "path": "packages/domain" }]` |
| `packages/domain/*` | Nuevo: paquete `@bidstream/domain` con marcador y prueba |
| `eslint.config.js` | Nuevo: flat config con typescript-eslint y regla de pureza del dominio |
| `.prettierrc.json`, `.prettierignore`, `.editorconfig`, `.nvmrc` | Nuevos |
| `commitlint.config.js`, `.husky/*` | Nuevos; `prepare: husky` en `package.json` |
| `.gitignore` | Añadir `dist`, `*.tsbuildinfo`, `coverage` (ya tiene `node_modules`, `.env`) |
| `CLAUDE.md` | Añadir sección "Comandos" con `npm run check` |
| `README.md` | Crear mínimo (nombre, cómo instalar y correr `npm run check`); el README completo es I1 |

---

## 4 · Plan de tests

| Caso | Nivel | Cubre |
|---|---|---|
| El marcador de `@bidstream/domain` se importa y devuelve el valor esperado | unit | La cadena de test + build de workspaces funciona |
| Un archivo de prueba en `packages/domain` que importe `kafkajs` hace fallar `eslint` | manual, una vez (se revierte) | La regla de pureza del dominio realmente se aplica |
| `npm run check` en un clon limpio (`npm ci`) termina en 0 | verificación | Quality gate completo reproducible |
| Un mensaje de commit `foo` es rechazado y `chore: x` aceptado | manual | commitlint y hooks |
| Introducir un error de tipo deliberado hace fallar `typecheck` | manual | `strict` activo |

**Deliberadamente sin test:** la configuración de Prettier y de editor (no tiene lógica); los hooks de husky más allá de la comprobación manual.

---

## 5 · Definition of Done

- [x] SDD en `docs/sdd/0.1/SDD.md`, Estado = Aprobado
- [x] `npm ci && npm run check` en verde desde un clon limpio
- [x] TypeScript con `strict` y las flags de §2.1; sin `any` implícito en el código del repo
- [x] La regla de pureza del dominio verificada (caso del §4)
- [x] commitlint rechaza commits que no son conventional; este repo ya usa ese formato
- [x] `CLAUDE.md` y `README.md` documentan los comandos
- [ ] PR hacia `main` (pendiente: no hay remoto de GitHub todavía)

---

## 6 · Riesgos

| Riesgo | Gravedad | Mitigación |
|---|---|---|
| Reglas `strictTypeChecked` muy ruidosas para el código marcador y retrasan el ticket | Baja | Se ajustan reglas puntuales con comentario de motivo, no se baja el nivel global |
| Diferencia Node 26 (local) vs 22 (objetivo) esconde incompatibilidades | Media | CI (0.3) corre en Node 22; usar `nvm use` y `engines` con `engine-strict=true` en `.npmrc` |
| ESM + `NodeNext` exige extensiones `.js` en imports relativos, lo que confunde al principio | Baja | Documentarlo en `CLAUDE.md`; lint lo detecta |
| Fijar herramientas ahora (npm, Vitest) condiciona los tickets siguientes | Baja | Son reversibles y están aisladas en la raíz; cualquier cambio se anota con un ADR |

---

## 7 · Preguntas abiertas

1. ~~¿pnpm?~~ Resuelta 2026-11-12: se usa npm.
2. ¿Se añade un paquete `packages/contracts` separado para los eventos (A2) o viven en `packages/domain`? Se decide en el SDD de A2; este ticket solo crea `domain`.
3. ¿Repositorio en GitHub y nombre? No hay `remote` todavía; hace falta para el PR y la CI (0.3). Pendiente en `docs/decisions/LOG.md`.

---

## Changelog de implementación

- **v1.0 → implementado (2026-11-12):** desviaciones menores respecto al diseño aprobado, sin cambiar decisiones:
  - TypeScript resolvió a **6.0.3**, ESLint **10**, Vitest **5.1**, Prettier 3.10 (lo último estable; el lockfile las fija). `@types/node` fijado a **22** para coincidir con el Node objetivo.
  - `packages/domain` usa dos tsconfig: `tsconfig.json` (typecheck y lint, incluye los tests) y `tsconfig.build.json` (build con `composite`, excluye tests). El `typecheck` es `tsc -p packages/domain/tsconfig.json --noEmit`; el `tsconfig.json` raíz referencia al de build.
  - Los archivos `*.js` de configuración se excluyen del lint tipado; `.prettierignore` excluye `docs`, `scripts`, `.claude` y `*.json`.
  - Verificado a mano: la regla de pureza rechaza `import 'kafkajs'` en el dominio; un error de tipo rompe `typecheck`; commitlint rechaza `foo` y acepta `chore: x`; `npm ci && npm run check` en clon limpio termina en 0.
  - `npm audit` reporta 1 vulnerabilidad moderada en `minimatch` (dependencia de desarrollo de ESLint 10). Se trata en F6.
