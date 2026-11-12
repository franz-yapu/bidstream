# SDD — C1 · Servidor REST `/v1`: validación, errores, OpenAPI y health básico

- **Ticket:** ClickUp **C1** (`868mvtxzn`, https://app.clickup.com/t/868mvtxzn).
- **Autor:** generado con Claude (Entregable 1).
- **Estado:** Borrador
- **Versión:** 1.0 · **Fecha:** 2026-11-12
- **Fuentes de verdad citadas:**
  1. `docs/product/bidstream_spec.md` §7 (REST de comandos, `/v1/health`, `/v1/docs`), §8 A03/A05, §5 (arquitectura)
  2. `docs/sdd/A2/SDD.md` (esquemas Zod del contrato), `docs/sdd/A3/SDD.md` (puertos)
  3. `docs/sdd/0.1/SDD.md` (monorepo, ESM/NodeNext, `npm run check`)
  4. `docs/do-not-touch.md` — dominio sin infraestructura

---

## 0 · Preguntas que el ticket pidió cerrar

| # | Pregunta del ticket | Respuesta |
|---|---|---|
| 1 | ¿Qué framework HTTP? | **Fastify 5** con `fastify-type-provider-zod` (§2.1) |

---

## 1 · Alcance

### Entra

- Workspace `apps/api` (`@bidstream/api`) con el servidor Fastify, prefijo `/v1`.
- Validación con Zod en el borde y tipos derivados de los mismos esquemas.
- Manejador de errores central con respuesta `application/problem+json`, sin trazas ni detalles internos.
- `GET /v1/health` básico (liveness) y `GET /v1/docs` (OpenAPI generado desde las rutas, con interfaz).
- Identificador de petición (`x-request-id`) generado o propagado.
- Configuración por entorno validada con Zod; punto único de composición de dependencias.
- Scripts `dev`, `build`, `start` y pruebas sin red.

### No entra (a propósito)

- Rutas de negocio (`/auctions`, `/lots`, `/bids`) → C2/C3.
- Health real con base de datos, Kafka y consumer lag → se amplía cuando existan B2/D2 (la spec §7 lo pide; aquí solo *liveness*).
- Autenticación, RBAC, CORS, cabeceras de seguridad y limitación de tasa → F1/F2.
- Logs estructurados con correlación completa → F4 (aquí solo el id de petición).
- Dockerfile → H2.

### Premisas verificadas (heredadas de `task-brief`)

| Premisa del ticket | Qué hay de verdad |
|---|---|
| "Reutilizar los esquemas de `@bidstream/domain`" | Los esquemas de eventos existen, pero las primitivas (`uuid`, `money`, `isoDateTime`, `currency`, `title`) **no se exportan** desde `@bidstream/domain`; hay que exponerlas |
| Framework | No hay ninguno instalado. Candidatos al día de hoy: Fastify 5.12.8, `fastify-type-provider-zod` 7.0.0 (requiere `zod >= 4.1.5`; el repo tiene 4.6.7), `@fastify/swagger` 9.9.3, `@fastify/swagger-ui` 6.1.3 |
| Node | `engines >=22`; Fastify 5 y el proveedor de tipos soportan Node 22 |
| Monorepo | `apps/` existe vacío; hay que añadir el paquete a las referencias de `tsconfig.json` |

---

## 2 · Diseño técnico

### 2.1 Decisiones y por qué

| Decisión | Elección | Por qué |
|---|---|---|
| Framework | **Fastify 5** | Validación y serialización por esquema integradas, rendimiento, `inject()` para pruebas sin red y ecosistema OpenAPI. Express exigiría añadir a mano validación, tipos y OpenAPI |
| Zod ↔ Fastify | `fastify-type-provider-zod` | Un esquema Zod es a la vez validación, tipo TypeScript y fuente del OpenAPI; evita tres definiciones que se desincronizan |
| OpenAPI | `@fastify/swagger` (generación) + `@fastify/swagger-ui` en `/v1/docs` | La spec pide "OpenAPI generado desde las rutas"; el JSON queda en `/v1/docs/json` |
| Errores | RFC 9457 (`application/problem+json`): `type`, `title`, `status`, `detail`, `instance`/`requestId`; para validación, lista de campos inválidos | Formato estándar y estable; nunca incluye *stack traces* (OWASP A05) |
| 5xx | Respuesta genérica; el detalle solo va al log | No filtrar información interna |
| Rutas `/v1` | Plugin registrado con `prefix: '/v1'` | Versionado desde el primer día (spec §7) |
| Composición | `buildApp(deps)` recibe `{ config, ... }` y devuelve la instancia sin escuchar; `main.ts` la arranca | Pruebas con `app.inject()`; los adaptadores (B2, D2) se inyectan en un único punto |
| Config | `loadConfig(env)` con Zod: `PORT` (3000), `HOST` (`0.0.0.0`), `NODE_ENV`, `LOG_LEVEL` | Fallar al arrancar si falta o sobra algo, no en medio de una petición |
| Desarrollo | `tsx watch src/main.ts` | Ejecución directa de TypeScript sin compilar; producción usa `dist` |
| Apagado | Escucha `SIGTERM`/`SIGINT` y cierra con `app.close()` | Necesario para contenedores y para el relay futuro |

### 2.2 Estructura

```
apps/api/
├── package.json            # @bidstream/api: fastify, plugins, zod, @bidstream/domain; dev: tsx
├── tsconfig.json  tsconfig.build.json
└── src/
    ├── main.ts             # arranque y apagado ordenado
    ├── app.ts              # buildApp(deps): plugins, errores, rutas
    ├── config.ts           # loadConfig(env)
    ├── errors.ts           # ProblemDetails + errorHandler + notFoundHandler
    └── routes/
        └── health.ts       # GET /v1/health
```

### 2.3 Contratos

`GET /v1/health` → `200 { "status": "ok", "uptimeSeconds": <n> }` (liveness, sin dependencias externas).

Error de validación (`400`):

```json
{
  "type": "https://bidstream.dev/problems/validation-error",
  "title": "Solicitud inválida",
  "status": 400,
  "requestId": "…",
  "errors": [{ "path": "amount", "message": "monto decimal inválido" }]
}
```

`404` ruta inexistente y `500` genérico usan el mismo formato.

---

## 3 · Cambios por archivo/módulo

| Archivo/módulo | Cambio |
|---|---|
| `apps/api/**` | Nuevo, según §2.2 |
| `packages/domain/src/events/index.ts` | Reexportar `primitives` (`uuid`, `money`, `isoDateTime`, `currency`, `title`) para reutilizarlas en los DTO de la API |
| `tsconfig.json` (raíz) | Añadir referencia a `apps/api/tsconfig.build.json` |
| `package.json` (raíz) | Scripts `dev:api` y reutilizar `build`/`check` |
| `vitest.config.ts` | Ya incluye `apps/*/src/**/*.test.ts` |
| `eslint.config.js` | Sin cambio (la regla de pureza solo afecta al dominio) |
| `.env.example` | Añadir `PORT`, `HOST`, `LOG_LEVEL` |
| `README.md`, `CLAUDE.md` | Cómo arrancar la API |

---

## 4 · Plan de tests

Todas con `app.inject()` (sin abrir puertos).

| Caso | Nivel | Cubre |
|---|---|---|
| `GET /v1/health` → 200 con `status: ok` | integración (en proceso) | Health básico |
| `GET /v1/docs/json` devuelve un OpenAPI válido que incluye `/v1/health` | integración | OpenAPI generado |
| `GET /v1/docs` responde HTML de la interfaz | integración | Documentación |
| Ruta inexistente → 404 `problem+json` | integración | Manejo de 404 |
| Una ruta de prueba con cuerpo Zod inválido → 400 con lista de campos | integración | Validación en el borde |
| Un error no controlado → 500 genérico, **sin** mensaje ni *stack* en el cuerpo | integración | OWASP A05 |
| Se acepta y se devuelve `x-request-id`; se genera uno si no llega | integración | Id de petición |
| `loadConfig` con entorno válido, valores por defecto y entorno inválido (falla) | unit | Configuración |
| Una petición a `/health` sin prefijo `/v1` → 404 | integración | Versionado |
| El servidor arranca y se cierra ordenadamente (`listen`/`close` en puerto 0) | integración | Ciclo de vida |

**Deliberadamente sin test:** rendimiento y límites de carga; la apariencia de la interfaz de Swagger.

---

## 5 · Definition of Done

- [ ] SDD en `docs/sdd/C1/SDD.md`, Estado = Aprobado
- [ ] API arranca con `npm run dev:api`; `/v1/health` y `/v1/docs` responden
- [ ] Errores en `problem+json` y ningún *stack trace* llega al cliente
- [ ] Primitivas del dominio reutilizadas por los DTO (sin duplicar validaciones)
- [ ] Tests del §4 en verde; `npm run check` en verde
- [ ] README documenta cómo arrancarla
- [ ] PR con CI verde y fusionado

---

## 6 · Riesgos

| Riesgo | Gravedad | Mitigación |
|---|---|---|
| `fastify-type-provider-zod` acopla la API a una versión concreta de Zod | Media | Versiones fijadas por lockfile; el repo ya usa Zod 4 |
| El prefijo `/v1` y los plugins de Swagger interactúan mal | Baja | Test de `/v1/docs` y `/v1/docs/json` |
| Respuestas de error inconsistentes entre validación, 404 y 500 | Media | Un solo manejador central y un test por tipo |
| Health "básico" da falsa sensación de salud | Media | Documentado como *liveness*; el health real llega con B2/D2 |

---

## 7 · Preguntas abiertas

1. ¿Fastify (propuesta) o prefieres otro framework (Express, Hono)? Cambiarlo afecta a las pruebas y al OpenAPI.
2. ¿Formato de error `problem+json` (propuesta) o un formato propio?
3. ¿La interfaz de documentación en `/v1/docs` debe quedar también en producción (Azure), o solo en desarrollo? Propuesta: disponible siempre, es de solo lectura y es parte del valor del repositorio.
4. ¿El servidor GraphQL (E1) irá en este mismo proceso (otra ruta) o en un `apps/graphql` aparte? Propuesta: aparte, para escalar lecturas y comandos por separado (lo decide el SDD de E1).
