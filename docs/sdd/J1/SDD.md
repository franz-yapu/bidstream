# SDD — J1 · Front web (React + Vite)

- **Ticket:** ClickUp **J1** (`868mwftc2`, https://app.clickup.com/t/868mwftc2).
- **Autor:** generado con Claude (Entregable 1).
- **Estado:** Implementado (2026-11-16) — aprobado con las propuestas de §7; ver la revisión 0.2 al pie
- **Versión:** 0.1 · **Fecha:** 2026-11-16
- **Fuentes de verdad citadas:**
  1. `docs/product/bidstream_spec.md` §7 (GraphQL solo lectura, subscriptions), §8 (seguridad)
  2. `apps/graphql/src/schema.ts` (`Query`, `Subscription`, `LotUpdate`)
  3. `apps/api/src/routes/{auth,auctions,bids,admin}.ts` (contratos REST y roles)
  4. `docs/sdd/F1/SDD.md` y `docs/adr/0013-*.md` (autenticación), `docs/sdd/F2/SDD.md` (CORS)
  5. `docs/sdd/C3/SDD.md` y `docs/adr/0011-decisor-unico-por-lote.md` (la puja es asíncrona)
  6. Decisión del usuario (2026-11-16): «React + Vite».

---

## 1 · Alcance

### Entra

- Una **SPA** en `apps/web` (workspace nuevo): React 19 + TypeScript + Vite.
- **Acceso:** login, registro de postor, cierre de sesión y renovación automática del token (JWT de 10 min, refresh rotatorio).
- **Postor:** lista de subastas, detalle de subasta con sus lotes, detalle de lote con precio vigente, ranking de pujas y **precio en vivo** (subscription `lotUpdated` por SSE), formulario de puja con cuenta atrás al cierre y aviso de extensión (anti-sniping).
- **Administrador/vendedor:** crear subasta y lote (`POST /v1/auctions`, `POST /v1/auctions/:id/lots`); el administrador además ve el DLQ (`GET /v1/admin/dlq`) y puede reprocesarlo.
- **Backend mínimo que el front necesita** (§2.5): consulta GraphQL `auctions` (lista paginada) y, si falta, `GET` equivalente para el rol creador.
- Pruebas unitarias/de componente, un e2e con Playwright contra `make demo`, y documentación (README, `docs/DESARROLLO.md`, `CLAUDE.md`, ADR).

### No entra (a propósito)

- SSR/Next.js: toda la app está tras login; no hay SEO que ganar (ADR nuevo, §2.1).
- Catálogo público sin sesión (GraphQL exige token; abrirlo es una decisión de seguridad aparte).
- Pagos, notificaciones push/correo, internacionalización más allá de español, modo offline.
- Despliegue a Azure del front (H3 sigue bloqueada por Q1); aquí solo imagen y `make demo`.
- Editar o cancelar subastas/lotes (la API no lo ofrece).

### Premisas verificadas

| Premisa | Qué hay de verdad en el repo |
|---|---|
| «GraphQL permite listar subastas» | **No.** `Query` solo tiene `auction(id)`, `lot(id)`, `lotBids`, `activeLots(auctionId)`. Sin lista de subastas el front no puede descubrirlas → §2.5. |
| «El navegador puede llamar a la API» | Solo si el origen está en `CORS_ALLOWED_ORIGINS` (vacío por defecto). El patrón admite `http://localhost:5173` (`^https?://…`). |
| «La puja devuelve el resultado» | **No:** responde 202 con `commandId`; el resultado llega por la subscription (`BidPlacedUpdate`/`LotExtendedUpdate`) o al volver a consultar. `BidRejected` **no** se expone por GraphQL → §2.4. |
| «GraphQL muestra quién pujó» | No: ni postores ni ganadores (`hasWinner`, `finalAmount`). El front muestra «tu puja va primera» comparando importes y ranking, no identidades. |
| «Los roles» | `register` crea `BIDDER`; `POST /v1/auctions[/lots]` exige `ADMIN`/`SELLER`; pujar exige `BIDDER` (el admin recibe 403). |
| «El token se guarda donde queramos» | Access token de 10 min y refresh opaco de 7 días con rotación de un solo uso → §2.3. |

---

## 2 · Diseño técnico

### 2.1 Stack y por qué

| Capa | Elección | Motivo |
|---|---|---|
| UI | React 19 + TypeScript estricto | El ecosistema más extendido; el backend ya es TS. |
| Build | Vite | Estándar para SPA, arranque y HMR rápidos. |
| Rutas | React Router (modo declarativo) | Sin SSR no se necesita más; menos superficie que un meta-framework. |
| Datos | TanStack Query | Caché, reintentos y estado de carga de las lecturas. |
| GraphQL | `graphql-request` (consultas) + `graphql-sse` (subscription) | El esquema es solo lectura; no hace falta un cliente normalizado. |
| Formularios | React Hook Form + Zod | Valida importes (`Money`) antes de enviar. |
| Estilos | Tailwind CSS + componentes accesibles (shadcn/ui, Radix) | Rapidez y accesibilidad; no hay diseño previo. |
| Pruebas | Vitest + Testing Library; Playwright (e2e) | Mismo runner que el resto del repo. |

**Por qué SPA y no Next.js:** sin SEO y con backend propio, un segundo servidor Node (SSR) sería complejidad sin beneficio. Si más adelante hay catálogo público, se añade ese trozo con SSR sin rehacer la SPA.

### 2.2 Estructura

`apps/web/` (workspace `@bidstream/web`), independiente de los procesos del backend (no importa `@bidstream/db` ni paquetes Node):

```
src/
  api/        rest.ts (cliente con token + refresh), graphql.ts, sse.ts, tipos
  auth/       AuthProvider, useSession, rutas protegidas por rol
  features/   auctions/, lots/ (detalle + puja), admin/ (crear, DLQ)
  lib/        money.ts (Money como cadena/centavos BigInt), time.ts (cuenta atrás)
  routes.tsx, main.tsx
```

Importes: **nunca `number`**. `Money` llega como cadena `"105.50"`; se compara y suma con centavos en `BigInt` (misma regla que el dominio). El formulario muestra `nextMinimumBid` y valida contra él, pero **decide el backend**.

### 2.3 Sesión y seguridad del navegador

- **Access token solo en memoria** (variable del `AuthProvider`), nunca en `localStorage`.
- **Refresh token en `sessionStorage`** (una pestaña; se pierde al cerrarla). Alternativa más estricta (cookie `HttpOnly`) exige cambios de backend (§7.1).
- Cliente REST: ante 401 por token caducado hace **un solo** `refresh` compartido (cola de peticiones) y reintenta; si el refresh falla, cierra sesión. Tras usar un refresh se guarda el nuevo (rotación de un solo uso).
- CSP del `index.html` servido estricta (sin `unsafe-inline` de scripts); sin HTML de usuario con `dangerouslySetInnerHTML`; títulos y textos se renderizan como texto.
- Rutas protegidas por rol (`BIDDER`, `SELLER`, `ADMIN`); la interfaz solo oculta lo que el backend ya deniega, no es una barrera de seguridad.
- Nunca se registran contraseñas ni tokens (consola incluida).

### 2.4 Puja y tiempo real

1. El postor envía `POST /v1/lots/:id/bids` con `Idempotency-Key` (UUID generado al abrir el formulario y **reutilizado en los reintentos** de esa misma puja; uno nuevo tras cada puja nueva).
2. 202 → estado «enviada, esperando decisión». La pantalla se actualiza por `lotUpdated(lotId)`: `BidPlacedUpdate` (nuevo precio), `LotExtendedUpdate` (nuevo cierre), `LotClosedUpdate`.
3. Si no llega confirmación en N s, se vuelve a consultar `lot(id)` (precio, ranking). **El rechazo de una puja no se publica por GraphQL**, así que la interfaz dirá «tu puja no es la vigente» según el precio, sin motivo exacto (§7.2).
4. `ResyncRequired` o reconexión de la subscription → reconsulta del lote. Cuenta atrás con el reloj del servidor (se corrige con el desfase de `occurredAt`) y bloqueo del botón al llegar a cero.
5. Errores 422/429/403 de la API se muestran con su `title`/`detail` (problem+json).

### 2.5 Cambios de backend necesarios (los menos posibles)

- **`Query.auctions(first, after, status)`** en GraphQL: lista paginada por cursor de subastas del tenant del token, orden por `opensAt`, sin identidades. Resolver nuevo sobre la proyección (`apps/graphql/src/resolvers.ts`, `data.ts`); índice `(tenant_id, opens_at)` si no existe (migración 0007). Misma política de límites de complejidad/profundidad.
- **CORS:** sin cambios de código; `CORS_ALLOWED_ORIGINS` incluye `http://localhost:5173` (desarrollo) y el origen del contenedor web en `make demo`.
- Sin cambios en los contratos REST de auth, subastas, lotes y pujas.

### 2.6 Cómo se sirve

- **Desarrollo:** `npm run dev -w @bidstream/web` (Vite, :5173) con las URL de la API y GraphQL en `VITE_API_URL` / `VITE_GRAPHQL_URL`.
- **Demo:** servicio `web` en el perfil `app` de `docker-compose.yml`: imagen multi-etapa (build con Vite → `nginxinc/nginx-unprivileged` por digest) en :8080, con cabeceras de seguridad y CSP. Las URL se inyectan al arrancar (`config.js` generado), no al compilar, para usar la misma imagen en cualquier entorno.
- CI: job `web` (typecheck, lint, pruebas, build) dentro de `check`; e2e dentro del job `demo`.

---

## 3 · Cambios por archivo/módulo

| Archivo/módulo | Cambio |
|---|---|
| `apps/web/**` | Nuevo workspace: Vite, React, rutas, `api/`, `auth/`, `features/`, `lib/`, estilos |
| `apps/web/Dockerfile` o `Dockerfile` (`ARG APP=web`) | Imagen estática con nginx sin privilegios; `config.js` en el arranque |
| `apps/graphql/src/{schema,resolvers,data}.ts` | `Query.auctions` paginada + pruebas |
| `packages/db/prisma/migrations/0007_*` | Índice `(tenant_id, opens_at)` si hace falta; actualizar listas en `db.int.test.ts`/`testing.int.test.ts` |
| `docker-compose.yml`, `Makefile` | Servicio `web`; `make demo` imprime la URL; `CORS_ALLOWED_ORIGINS` en API y GraphQL |
| `.github/workflows/ci.yml` | Job de la web (check) y e2e en `demo` |
| `scripts/demo-smoke.sh`, `packages/testing/src/policy/docker-policy.test.ts` | Incluir la nueva imagen |
| `README.md`, `docs/DESARROLLO.md`, `CLAUDE.md`, `SECURITY.md` | Front, CORS, almacenamiento de tokens (A02/A07) |
| `docs/adr/0014-front-spa-react-vite.md` | ADR: SPA, sesión en memoria + sessionStorage |
| `docs/planning/…Sprint-Roadmap.md`, `docs/decisions/LOG.md` | J1 y DEC |

---

## 4 · Plan de tests

| Caso | Nivel | Cubre |
|---|---|---|
| `Money`: comparación, suma y formato con centavos BigInt | unit | Sin `number` en importes |
| Cliente REST: refresh único compartido ante varios 401; cierre de sesión si falla | unit | §2.3 |
| `Idempotency-Key` estable en reintentos y nueva por puja | unit/componente | §2.4 |
| Rutas protegidas por rol; el postor no ve crear subasta | componente | §2.3 |
| Cuenta atrás y bloqueo del botón al cierre; extensión por `LotExtendedUpdate` | componente | §2.4 |
| Reducción de `lotUpdated` incl. `ResyncRequired` → reconsulta | unit | §2.4 |
| `Query.auctions`: paginación, orden, aislamiento por tenant, límites | integración | §2.5 |
| Playwright: login → crear subasta y lote (admin) → registro y puja (postor) → precio en vivo en otra pestaña | e2e (contra `make demo`) | Flujo completo |
| Accesibilidad básica (axe) en las pantallas principales | componente | Teclado, etiquetas |
| Nada de tokens en `localStorage`; sin `dangerouslySetInnerHTML` | unit/política | §2.3 |

No se prueba: el aspecto visual píxel a píxel ni los componentes de librería de terceros.

---

## 5 · Definition of Done

- [ ] `apps/web` compila, pasa lint, typecheck y pruebas (`npm run check`)
- [ ] `Query.auctions` con pruebas de integración y migración si aplica
- [ ] E2E de Playwright verde en la CI (job `demo`)
- [ ] `make demo` levanta también el front y muestra su URL; `scripts/demo-smoke.sh` lo comprueba
- [ ] Access token solo en memoria; sin secretos en el bundle (prueba de política)
- [ ] ADR-0014, README, `DESARROLLO.md`, `CLAUDE.md` y `SECURITY.md` actualizados
- [ ] CI verde, PR fusionado, ticket en `completadas`, roadmap y `LOG.md`

---

## 6 · Riesgos

| Riesgo | Gravedad | Mitigación |
|---|---|---|
| XSS robaría el refresh token de `sessionStorage` | Media | CSP estricta, sin HTML crudo, refresh rotatorio de un solo uso; cookie `HttpOnly` como mejora (§7.1) |
| La subscription (SSE) se corta o pierde eventos | Media | `ResyncRequired` y reconexión → reconsulta; el precio vigente siempre se puede releer |
| El rechazo de una puja no es visible por GraphQL | Media | Mensaje genérico basado en el precio (§7.2); no se cambia el esquema sin decisión |
| Dos pestañas rotan el mismo refresh y una pierde la sesión | Baja | `sessionStorage` por pestaña; sesión nueva si el refresh es rechazado |
| Desfase de reloj del cliente en la cuenta atrás | Baja | Se corrige con `occurredAt` del servidor; el backend decide el cierre |
| Ampliar GraphQL con `auctions` abre un vector de consultas pesadas | Baja | Paginación obligatoria y los límites de complejidad ya existentes |

---

## 7 · Preguntas abiertas (con propuesta)

1. **Dónde guardar el refresh token.** Propuesta: `sessionStorage` por ahora (sin cambios de backend) y dejar la cookie `HttpOnly` + `SameSite` como mejora posterior con su ADR.
2. **Mostrar el motivo del rechazo de una puja.** Propuesta: no exponerlo; mensaje genérico según el precio. Exponer `BidRejected` por GraphQL requeriría decidir qué se filtra a otros postores.
3. **Lista de subastas.** Propuesta: añadir `Query.auctions` (§2.5), solo lectura y por tenant.
4. **Tenant en el login.** El login pide `tenantId` (UUID). Propuesta: en la demo, campo precargado con el tenant de demostración y editable; un selector por nombre queda fuera.
5. **Diseño.** Propuesta: interfaz sobria en español, claro/oscuro automático, sin marca propia; ajustes visuales después.

---

## Revisión 0.2 (2026-11-16) — desviaciones del diseño aprobado, ya implementadas

- **Sin `graphql-request` ni el paquete `graphql`:** las consultas son `fetch` con cadenas (menos peso y
  sin riesgo de dos copias de `graphql`). Solo `graphql-sse` para la subscription.
- **Reloj del servidor:** en vez de `occurredAt` de los eventos (que llegan con retraso del relay), se usa
  la cabecera `Date` de las respuestas; por eso API y GraphQL **exponen `date`** por CORS (cambio de una
  línea en `apps/api/src/app.ts` y `apps/graphql/src/server.ts`).
- **Subastas:** el filtro por defecto es «Abiertas» (la lista no empieza por el histórico cerrado).
- **Imagen:** `apps/web/Dockerfile` propio (contexto: la raíz) con nginx sin privilegios; la configuración
  y la CSP se generan al arrancar y se validan (§2.6).
- **Revisión visual:** una pasada de diseño (`impeccable`, sin hallazgos del detector): el precio se resalta
  al cambiar y se anuncia por `aria-live`, la cuenta atrás avisa de la urgencia (`role="timer"`), la puja
  vigente se marca, `prefers-reduced-motion` se respeta y las tarjetas y botones responden al pulsar.
- La lista de pujas se refresca cada 4 s porque la proyección llega un instante después del aviso en vivo.

