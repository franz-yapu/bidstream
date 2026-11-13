# SDD — F2 · Límite de pujas por postor y minuto, cabeceras de seguridad y CORS

- **Ticket:** ClickUp **F2** (`868mw2q3t`, https://app.clickup.com/t/868mw2q3t).
- **Autor:** generado con Claude (Entregable 1).
- **Estado:** Implementado (2026-11-13)
- **Versión:** 0.1 · **Fecha:** 2026-11-13
- **Depende de:** C3, C4 y F1.
- **Fuentes de verdad citadas:** spec §8 (A04 límite por postor y minuto, A05 cabeceras y CORS con lista blanca, sin trazas al cliente); `docs/sdd/C4/SDD.md` (tabla `idempotency_key`); `apps/api/src/app.ts`, `errors.ts`

---

## 0 · Preguntas que el ticket pidió cerrar

| # | Pregunta | Respuesta |
|---|---|---|
| 1 | ¿Cuántas pujas por minuto? | 30 por postor y minuto (configurable, `BID_RATE_LIMIT_PER_MINUTE`) — §7.1 |
| 2 | ¿Dónde se cuenta? | En PostgreSQL, sobre `idempotency_key`: exacto entre réplicas, sin Redis |

---

## 1 · Alcance

### Entra

- **Límite de pujas** por `(tenant, bidder)` y ventana de 60 s deslizante: antes de aceptar, cuenta las filas de `idempotency_key` de ese postor en los últimos 60 s; si alcanza el máximo → `429` `problem+json` con `Retry-After` y `RateLimit-*`. Una repetición idempotente (C4) **no** cuenta.
- **Cabeceras de seguridad** (`@fastify/helmet`, ajustadas a una API JSON: sin CSP de HTML, `nosniff`, `Referrer-Policy`, HSTS en producción, sin `X-Powered-By`) en la API y en GraphQL.
- **CORS con lista blanca** (`CORS_ALLOWED_ORIGINS`, por defecto vacía = ninguno) en API y GraphQL; sin `*` con credenciales.
- **Límite global por IP** (`@fastify/rate-limit`, en memoria por réplica) como red de seguridad.
- **Sin trazas de error al cliente**: prueba de regresión (ya es la política de `problem+json`).
- Documentación OpenAPI de `429`.

### No entra

- Límite distribuido con Redis; WAF; protección DDoS (H1/Azure Front Door).
- Límite de login (lo hace F1).

### Premisas verificadas

| Premisa | Qué hay de verdad |
|---|---|
| Hay límites en la API | Solo en GraphQL (profundidad, complejidad); la API REST no tiene ninguno |
| Cabeceras de seguridad y CORS | No hay ninguno |
| Un contador por réplica basta | No para el límite por postor: con varias réplicas se multiplicaría; de ahí el recuento en BD |

---

## 2 · Diseño técnico

| Decisión | Elección | Por qué |
|---|---|---|
| Contador del postor | Consulta sobre `idempotency_key` indexada por `(tenant_id, bidder_id, created_at)` | Exacto, sin dependencia nueva, aprovecha C4 |
| Límite por IP | En memoria | Defensa gruesa; la fina es la del postor |
| Respuesta | `429` con `Retry-After` | Estándar |
| CORS | Lista blanca por variable | A05; vacía por defecto = seguro |
| Orden de los controles | Autenticación → rol → límite por postor → idempotencia | No gastar BD en peticiones no autorizadas |

---

## 3 · Cambios por archivo/módulo

| Archivo/módulo | Cambio |
|---|---|
| `apps/api` | Plugins helmet/cors/rate-limit, comprobación del límite en `placeBid`, `429` |
| `apps/graphql` | helmet y CORS |
| `packages/db` | Índice y consulta de recuento |
| `apps/api/src/config.ts` | `BID_RATE_LIMIT_PER_MINUTE`, `CORS_ALLOWED_ORIGINS` |

---

## 4 · Plan de tests

| Caso | Nivel | Cubre |
|---|---|---|
| El postor N+1 en un minuto recibe `429` con `Retry-After`; otro postor no | integración | A04 |
| Tras pasar la ventana vuelve a poder pujar (reloj inyectado) | integración | Ventana deslizante |
| Una repetición idempotente no consume cupo | integración | Interacción con C4 |
| Con 2 instancias de la API el límite es el mismo (no se duplica) | integración | Réplicas |
| Cabeceras de seguridad presentes en API y GraphQL; sin `X-Powered-By` | integración | A05 |
| CORS: origen permitido recibe `Access-Control-Allow-Origin`; no permitido, no; preflight correcto | integración | Lista blanca |
| Un error interno no devuelve traza ni mensajes de la base | integración | Sin trazas |
| El límite por IP responde `429` al exceso | integración | Red de seguridad |

---

## 5 · Definition of Done

- [ ] SDD Aprobado; implementación; tests; `npm run check` e `integration` en verde; PR fusionado

## 6 · Riesgos

| Riesgo | Gravedad | Mitigación |
|---|---|---|
| El recuento añade una consulta a cada puja | Baja | Índice compuesto; solo cuenta una ventana de 60 s |
| Falsos positivos para usuarios legítimos en un cierre reñido | Media | Límite configurable y generoso por defecto |
| CORS mal configurado en producción | Media | Vacío por defecto; prueba de configuración |

## 7 · Preguntas abiertas

1. **Cupo:** 30 pujas por postor y minuto (propuesta). ¿Otro valor?
2. **Recuento en PostgreSQL** (sin Redis) (propuesta).
3. **CORS:** lista vacía por defecto y definida por entorno (propuesta).

---

## Changelog de implementación

- Límite por postor: `lockBidder` (bloqueo asesor de transacción) + `claim` + `countSince`/`oldestSince`, con `createdAt` tomado del reloj de la aplicación; `429` `problem+json` con `Retry-After` exacto (lo que falta para que caduque la puja más antigua) y `RateLimit-*`; la excepción revierte la clave. Probado: N+1, otro postor intacto, ventana deslizante con reloj inyectado, repetición idempotente sin cupo, y **dos instancias con 20 peticiones simultáneas aceptan exactamente 5**.
- API: `@fastify/helmet`, CSP `default-src 'none'; frame-ancestors 'none'` (excepto `/v1/docs`), `Cache-Control: no-store` en `/v1/auth/*`, HSTS solo en producción, `@fastify/cors` con lista blanca (preflight sin token también en modo jwt), límite global por IP (la salud no cuenta) y prueba de que un error interno no filtra pila ni mensaje.
- GraphQL: `securityHeaders` y CORS de Yoga con la misma lista (`CORS_ALLOWED_ORIGINS`).
- Configuración: `BID_RATE_LIMIT_PER_MINUTE`, `API_RATE_LIMIT_PER_MINUTE`, `CORS_ALLOWED_ORIGINS` (rechaza `*`, rutas y esquemas raros).
- 14 pruebas de integración en la API y 6 en GraphQL.
- Cambio de ensamblado: los ganchos de identidad y de acceso se añaden en `app.after(...)`, tras cargar las defensas de borde. Efecto: una URL inexistente responde `404` (antes `401`).
- Hallazgo: `pg_advisory_xact_lock` devuelve `void` y Prisma no sabe deserializarlo; se envuelve en una columna entera.
