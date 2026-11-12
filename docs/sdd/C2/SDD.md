# SDD — C2 · Comandos `POST /v1/auctions` y `POST /v1/auctions/:id/lots`

- **Ticket:** ClickUp **C2** (`868mvtxzv`, https://app.clickup.com/t/868mvtxzv).
- **Autor:** generado con Claude (Entregable 1).
- **Estado:** Borrador
- **Versión:** 1.0 · **Fecha:** 2026-11-12
- **Fuentes de verdad citadas:**
  1. `docs/product/bidstream_spec.md` §7 (`POST /v1/auctions` 201 con `Location`; `POST /v1/auctions/:id/lots` 201), §5 (validar contra la proyección y escribir en el outbox en una sola transacción), §3 (`AuctionOpened`, `LotPublished`), §8 A01/A03
  2. `docs/sdd/B2/SDD.md` (`withTransaction`, `PrismaOutbox`), `docs/sdd/A2/SDD.md` (`buildEvent`), `docs/sdd/A3/SDD.md` (`Clock`, `IdGenerator`), `docs/sdd/C1/SDD.md` (`buildApp`, `problem+json`, `primitives`)
  3. `docs/decisions/LOG.md` — DEC-006 (clave `auctionId` para eventos de subasta), Q4 (modelo de usuarios sin definir)
  4. `docs/do-not-touch.md` — patrón outbox; contrato de eventos

---

## 0 · Preguntas que el ticket pidió cerrar

| # | Pregunta del ticket | Respuesta |
|---|---|---|
| 1 | ¿Cómo se obtiene `tenantId` mientras no hay autenticación (F1)? | Cabecera `X-Tenant-Id` **solo en desarrollo y pruebas**, detrás de un resolvedor sustituible (§2.2) |

---

## 1 · Alcance

### Entra

- `POST /v1/auctions` → 201 con `Location`: valida, construye `AuctionOpened` y lo escribe en el outbox.
- `POST /v1/auctions/:id/lots` → 201 con `Location`: comprueba la subasta en la proyección, construye `LotPublished` y lo escribe en el outbox.
- Casos de uso `openAuction` y `publishLot` en una capa de aplicación (`apps/api/src/commands/`), sin dependencias de Fastify.
- Resolvedor de tenant (`TenantResolver`) con la implementación temporal por cabecera.
- Implementaciones reales de `Clock` e `IdGenerator` (UUID v7) para la API.
- Ampliar `AppDeps` con base de datos, reloj, ids y topic de eventos; documentación OpenAPI de las dos rutas.
- Pruebas de integración con PostgreSQL real (`app.inject()`).

### No entra (a propósito)

- Publicación en Kafka: el relay (D1) la hace; aquí solo se escribe el outbox.
- Pujas (`POST /v1/lots/:id/bids`, `Idempotency-Key`) → C3/C4, bloqueados por Q2.
- Autenticación, roles y propiedad de recursos → F1 (Q4).
- Lecturas (`GET`): el contrato de lectura es GraphQL (E1).
- Cierre de subastas y lotes → D8 (Q3).

### Premisas verificadas (heredadas de `task-brief`)

| Premisa del ticket | Qué hay de verdad |
|---|---|
| "Escribir el evento en el outbox en la misma transacción que cualquier validación" | `withTransaction` y `PrismaOutbox.enqueue` existen (B2); `buildEvent`, `partitionKey` y los esquemas están en el dominio |
| "Sin autenticación todavía (F1)" | No hay noción de usuario ni de tenant en la API; el esquema no tiene tabla de usuarios (Q4) |
| "Validar la subasta al publicar un lote" | **La proyección es eventualmente consistente**: tras `POST /auctions` la fila de `auction` no existe hasta que relay y `projector` (D1, D4) procesan el evento, así que un `POST …/lots` inmediato puede no encontrar la subasta |
| "`Location` con 201" | No existe `GET /v1/auctions/:id` (las lecturas son GraphQL, ADR de la spec); el `Location` identifica el recurso pero esa URL no devuelve nada hoy |
| Ids de subasta y lote | Los esquemas aceptan cualquier UUID (`primitives.uuid`); el dominio no genera ids de agregado |

---

## 2 · Diseño técnico

### 2.1 Capas

```
Ruta Fastify (Zod en el borde) ──▶ caso de uso ──▶ withTransaction { lecturas de la proyección,
 solo traduce HTTP ↔ comando        openAuction /    buildEvent(...), outbox.enqueue(...) }
                                    publishLot       (decideX puros de dominio cuando aplican)
```

Los casos de uso reciben `{ prisma, clock, ids, eventsTopic }` y un `tenantId`; devuelven el resultado o un error de aplicación tipado (`AuctionNotFound`, `AuctionClosed`, `InvalidCommand`) que la ruta traduce a `problem+json`.

### 2.2 Tenant mientras no hay autenticación

`TenantResolver.resolve(request): string` (lanza 401 si no hay). Implementación temporal `HeaderTenantResolver`: lee `X-Tenant-Id` (UUID). **Solo se permite con `NODE_ENV` distinto de `production`**: en producción la configuración falla al arrancar hasta que F1 aporte el resolvedor real (claim del JWT). Así no queda en producción un modo en el que cualquiera elige su tenant (OWASP A01).

### 2.3 Contratos

`POST /v1/auctions` — cuerpo: `{ title, opensAt, closesAt }` → `201 { auctionId, status: "OPEN" }` + `Location: /v1/auctions/{auctionId}`.

`POST /v1/auctions/:id/lots` — cuerpo: `{ title, startingPrice, minIncrement, currency, closesAt }` → `201 { lotId, auctionId, status: "OPEN" }` + `Location: /v1/auctions/{auctionId}/lots/{lotId}`.

`status` es el estado inicial que **implica el evento aceptado**; no es lectura de la proyección.

### 2.4 Validaciones

| Regla | Dónde | Respuesta |
|---|---|---|
| Formato (título 1–200, fechas ISO-8601 UTC, dinero `Decimal(12,2)`, moneda de 3 mayúsculas, campos desconocidos) | Zod con `primitives` del dominio | 400 `validation-error` |
| `closesAt > opensAt` (subasta) | Zod (refinamiento) | 400 |
| La subasta cierra en el futuro; el lote cierra en el futuro (`closesAt > ahora`) | Caso de uso (usa `Clock`) | 422 `urn:bidstream:problem:business-rule` |
| `startingPrice > 0` y `minIncrement > 0` | Caso de uso | 422 |
| La subasta existe en la proyección (mismo tenant) | Caso de uso | 404 `not-found` |
| La subasta está abierta | Caso de uso | 409 `conflict` |

El cierre del lote **no** se limita al de la subasta: el anti-sniping puede extender un lote más allá de él.

### 2.5 Decisiones y por qué

| Decisión | Elección | Por qué |
|---|---|---|
| Ids de agregado | Los genera el servidor (UUID v7 con `uuid`) | El cliente no elige identidades; v7 ordena por tiempo |
| Evento y respuesta | El evento se construye con `buildEvent` y los `deps` salen de `Clock`/`IdGenerator` | Una sola fuente de tiempo e ids; deterministas en pruebas |
| Validar contra la proyección | Sí, con `PrismaAuctionRepository` dentro de la transacción (spec §5) | Es lo que pide la arquitectura; su coste (consistencia eventual) se documenta, no se oculta |
| Subasta aún no proyectada | 404 con `detail` que lo explica y cabecera `Retry-After: 1` | El cliente puede reintentar; mejor un error claro que aceptar un lote huérfano |
| Idempotencia | No se exige en C2 (solo la puja la exige, spec §7) | Un reintento de red crea otra subasta; se acepta y se documenta (ver §6) |
| Topic de destino | `TOPICS.eventsLot` pasado por la composición (`AppDeps.eventsTopic`) | `db` y `domain` no conocen Kafka |
| Errores de aplicación | Clases tipadas traducidas en la capa de rutas | El caso de uso no sabe de HTTP |

---

## 3 · Cambios por archivo/módulo

| Archivo/módulo | Cambio |
|---|---|
| `apps/api/src/commands/open-auction.ts`, `publish-lot.ts`, `errors.ts` | Casos de uso y errores de aplicación |
| `apps/api/src/routes/auctions.ts` | Las dos rutas, esquemas Zod y OpenAPI |
| `apps/api/src/tenant.ts` | `TenantResolver` y `HeaderTenantResolver` |
| `apps/api/src/system.ts` | `SystemClock` y `Uuid7Generator` (implementan los puertos de A3) |
| `apps/api/src/app.ts` | `AppDeps` con `prisma`, `clock`, `ids`, `tenantResolver`, `eventsTopic`; registra las rutas |
| `apps/api/src/errors.ts` | Mapear errores de aplicación a 404/409/422 y `Retry-After` |
| `apps/api/src/config.ts` | `DATABASE_URL`; falla al arrancar si `NODE_ENV=production` con el resolvedor por cabecera |
| `apps/api/src/main.ts` | Composición: cliente Prisma, topic, resolvedor |
| `apps/api/package.json` | Dependencias `@bidstream/db`, `@bidstream/kafka` (solo `TOPICS`) y `uuid` |
| `.env.example`, `README.md`, `CLAUDE.md` | Variables y ejemplo con `curl` |

---

## 4 · Plan de tests

Integración con la base de datos de `@bidstream/testing` y `app.inject()`.

| Caso | Nivel | Cubre |
|---|---|---|
| `POST /v1/auctions` válido → 201, `Location`, y **una fila de outbox** `AuctionOpened` con `id = eventId`, `key = auctionId`, tenant correcto y payload igual a la petición | integración | Camino feliz + outbox |
| Cuerpo inválido (título vacío, fechas mal formadas, `closesAt <= opensAt`, campo extra) → 400 y **nada en el outbox** | integración | Validación |
| Subasta que cierra en el pasado → 422 y nada en el outbox | integración | Regla de negocio |
| Sin `X-Tenant-Id` o con valor no UUID → 401/400 y nada en el outbox | integración | Tenant |
| `POST …/lots` con la subasta sembrada en la proyección → 201 y fila `LotPublished` con clave `lotId` | integración | Camino feliz |
| Subasta inexistente o de **otro tenant** → 404 con `Retry-After`; subasta cerrada → 409; en ambos casos nada en el outbox | integración | Proyección y aislamiento |
| Lote con `startingPrice`/`minIncrement` cero o negativo, moneda inválida, cierre en el pasado → 400/422 | integración | Validaciones de lote |
| El cierre del lote **puede** ser posterior al de la subasta | integración | Anti-sniping |
| El evento escrito cumple `parseEvent` y la clave coincide con `partitionKey` | integración | Contrato de eventos |
| Si el outbox falla (p. ej. `eventId` duplicado inyectado), la respuesta es 500 genérico y no queda nada (transacción revertida) | integración | Atomicidad |
| `HeaderTenantResolver` rechaza en `production`; la config falla al arrancar | unit | Seguridad |
| OpenAPI incluye las dos rutas con sus códigos de respuesta | integración | Documentación |

**Deliberadamente sin test:** publicación real en Kafka (D1) y proyección (D4); el flujo completo de punta a punta se cubre en D4.

---

## 5 · Definition of Done

- [ ] SDD en `docs/sdd/C2/SDD.md`, Estado = Aprobado
- [ ] Las dos rutas devuelven 201/`Location` y dejan **exactamente un evento válido** en el outbox por petición aceptada, y ninguno por petición rechazada
- [ ] Sin dependencias de Fastify en los casos de uso; sin imports de Prisma en el dominio
- [ ] Resolvedor de tenant por cabecera imposible en `production`
- [ ] OpenAPI documenta las rutas y sus errores
- [ ] Tests del §4 en verde; `npm run check` y `npm run test:integration` en verde
- [ ] PR con CI verde y fusionado

---

## 6 · Riesgos

| Riesgo | Gravedad | Mitigación |
|---|---|---|
| Consistencia eventual: `POST …/lots` justo después de crear la subasta da 404 | Media | 404 explicado con `Retry-After`; es inherente a validar contra la proyección (spec §5); la demostración y los clientes esperan al `projector` |
| La cabecera `X-Tenant-Id` permite elegir tenant | Alta (si llegara a producción) | Prohibida con `NODE_ENV=production` por configuración; se sustituye en F1 |
| Reintentos del cliente crean subastas duplicadas (sin idempotencia en C2) | Media | Documentado; si hace falta, `Idempotency-Key` genérico en un ticket posterior |
| El `Location` apunta a una URL sin `GET` | Baja | Es un identificador de recurso; la lectura es GraphQL (E1). Se decide en §7 #3 |
| Validar la subasta y escribir el outbox no impide una carrera (subasta cerrada entre la lectura y el commit) | Baja | El evento `LotPublished` sobre una subasta ya cerrada lo tolera el `projector` (D4); no es una regla de dinero |

---

## 7 · Preguntas abiertas

1. **Tenant provisional:** ¿cabecera `X-Tenant-Id` solo fuera de producción (propuesta)? Mientras F1 siga bloqueado por Q4, **la API no podría ejecutarse en producción**; para la demostración en Azure (H1) habría que decidir antes cómo autenticar.
2. **Subasta aún no proyectada:** ¿404 con `Retry-After` (propuesta) o aceptar el lote sin validar la subasta y dejar que el `projector` lo resuelva? Lo segundo evita el 404 pero puede aceptar lotes de subastas inexistentes.
3. **`Location`:** ¿`/v1/auctions/{id}` aunque no exista el `GET` (propuesta), o añadir un `GET` mínimo de estado que lea la proyección? Un `GET` REST contradice "GraphQL solo para lecturas" (ADR pendiente en I2).
4. **Reglas numéricas:** `startingPrice > 0` y `minIncrement > 0`; el cierre del lote debe estar en el futuro. ¿De acuerdo?
5. **Sin idempotencia en C2:** ¿aceptas que un reintento cree un duplicado, o quieres `Idempotency-Key` también aquí?
