# SDD — F1 · Autenticación propia: JWT corto, refresh revocable, Argon2, bloqueo y RBAC

- **Ticket:** ClickUp **F1** (`868mw2q3j`, https://app.clickup.com/t/868mw2q3j).
- **Autor:** generado con Claude (Entregable 1).
- **Estado:** Aprobado (2026-11-13) — parte 1 implementada (núcleo); parte 2 (RBAC y GraphQL) pendiente
- **Versión:** 0.1 · **Fecha:** 2026-11-13
- **Decisión que lo desbloquea:** **Q4** = autenticación propia completa (respuesta del usuario, 2026-11-13).
- **Fuentes de verdad citadas:** spec §8 (A01 RBAC y propiedad, A02 Argon2, A07 JWT corto + refresco revocable + bloqueo por intentos); `docs/adr/0010` (tenant provisional); `apps/api/src/tenant.ts`, `config.ts` (no arranca en producción); `apps/graphql/src/tenant.ts`; `docs/sdd/D7/SDD.md` (`X-Admin-Key`)

---

## 0 · Preguntas que el ticket pidió cerrar

| # | Pregunta | Respuesta |
|---|---|---|
| 1 | Modelo de usuarios | `app_user` por tenant con rol (`ADMIN`, `SELLER`, `BIDDER`); el postor **es** el usuario: `bidderId = userId` |
| 2 | ¿Qué reemplaza a `X-Tenant-Id` y `X-Bidder-Id`? | El token: `tenantId`, `sub` (userId) y `role` salen de sus claims. ADR-0010 queda **reemplazado** |

---

## 1 · Alcance

### Entra

- **Tablas** (migración): `app_user` (`id`, `tenant_id`, `email` único por tenant, `password_hash` Argon2id, `role`, `status`, `failed_attempts`, `locked_until`, timestamps) y `refresh_token` (`id`, `user_id`, `family_id`, `token_hash` SHA-256, `expires_at`, `revoked_at`, `replaced_by`, `user_agent`, `ip`).
- **Rutas** `POST /v1/auth/register` (solo `BIDDER`; `ADMIN` y `SELLER` los crea un `ADMIN`), `/login`, `/refresh`, `/logout`, `GET /v1/auth/me`.
- **Contraseñas**: Argon2id (parámetros OWASP), política mínima de longitud, comparación en tiempo constante; mismo error y mismo coste para «usuario inexistente» y «contraseña incorrecta».
- **JWT de acceso** de 10 min (EdDSA, librería `jose`) con `sub`, `tid`, `role`, `jti`; **refresh token opaco** de 7 días, de un solo uso con **rotación** y **detección de reutilización** (si se presenta un refresh ya usado se revoca toda la familia).
- **Bloqueo por intentos**: 5 fallos → bloqueo 15 min (con respuesta genérica) y límite de peticiones por IP en `/auth/*`.
- **RBAC y propiedad**: decorador `requireRole(...)` y comprobación de propiedad; denegar por defecto: toda ruta `/v1/**` exige token salvo `/v1/health`, `/v1/docs` y `/v1/auth/*`. `BIDDER` solo puja; `SELLER` crea subastas y lotes; `ADMIN` todo y las rutas de D7 (sustituye `X-Admin-Key`, §7.4).
- **GraphQL** verifica el mismo JWT con la clave pública; `tenantId` del token.
- **Quitar el bloqueo de `NODE_ENV=production`** de la API y GraphQL.
- Claves de firma del JWT por entorno (`AUTH_JWT_PRIVATE_KEY`/`AUTH_JWT_PUBLIC_KEYS`, con `kid`).

### No entra

- Verificación de correo y recuperación de contraseña (no hay infraestructura de correo).
- MFA, OAuth/OIDC social.
- Panel de administración de usuarios (solo la API).

### Premisas verificadas

| Premisa | Qué hay de verdad |
|---|---|
| El esquema tiene usuarios | **No**: ni usuarios ni roles (por eso estaba bloqueado) |
| El tenant ya está abstraído | Sí: `TenantResolver` en la API y en GraphQL; se añade un resolvedor por JWT y se retira el de cabecera |
| La API no arranca en producción | Sí, deliberado (ADR-0010); F1 lo levanta |
| `bidderId` es un UUID | Sí; será `userId` |

---

## 2 · Diseño técnico

| Decisión | Elección | Por qué |
|---|---|---|
| Hash | Argon2id (`argon2`, binario nativo con prebuilds para glibc) | spec A02; ya hay binarios nativos en la imagen |
| Token de acceso | JWT EdDSA 10 min | Verificable por GraphQL sin llamar a la API; corto limita el daño |
| Refresh | Opaco, hash en BD, rotación y familia | Revocable y detecta robo |
| Dónde viven las claves | Variables de entorno; Key Vault en H1 | Igual que F3 |
| Autorización | Deny-by-default en un hook global + roles por ruta | A01 |
| Tenant | Del token; ya no de cabecera | Cierra ADR-0010 |
| Errores | `problem+json` genérico en `/auth`; sin enumeración de usuarios | A07 |

---

## 3 · Cambios por archivo/módulo

| Archivo/módulo | Cambio |
|---|---|
| `packages/db/prisma` | Migración: `app_user`, `refresh_token`, enum de rol |
| `packages/auth` (nuevo) | Argon2, JWT (firma/verificación con `kid`), rotación de refresh, bloqueo; sin dependencia de Fastify |
| `apps/api` | Rutas de auth, hook de autenticación, `requireRole`, `TenantResolver` por token, `/v1/admin/*` por rol |
| `apps/graphql` | Verificación del JWT y tenant |
| `docs/adr/0013-…` | ADR de autenticación; ADR-0010 → «Reemplazada por 0013» |
| compose/`make demo` | Claves de desarrollo y un `ADMIN` inicial por entorno |
| README, CLAUDE.md | Fin del límite de producción |

---

## 4 · Plan de tests

| Caso | Nivel | Cubre |
|---|---|---|
| Argon2: verifica la correcta y rechaza la incorrecta; hashes distintos para la misma clave | unit | A02 |
| JWT: válido, expirado, firma alterada, `kid` desconocido, `alg: none` | unit | A07 |
| Registro → login → `me` → refresh → logout | integración | Flujo |
| Refresh de un solo uso: el segundo uso revoca la familia | integración | Rotación |
| 5 intentos fallidos bloquean 15 min; el desbloqueo ocurre al caducar; misma respuesta para usuario inexistente | integración | Bloqueo y enumeración |
| Toda ruta `/v1/**` sin token → `401`; con rol insuficiente → `403`; ruta nueva sin declarar → denegada | integración | Deny-by-default |
| Un `BIDDER` de otro tenant no ve ni puja en lotes ajenos | integración | Aislamiento |
| GraphQL sin token → error de autenticación; con token ve solo su tenant | integración | Lecturas |
| La API arranca con `NODE_ENV=production` | integración | Fin del bloqueo |
| Contraseñas, hashes y tokens nunca salen en logs ni en respuestas de error | integración | A09 |

---

## 5 · Definition of Done

- [ ] SDD Aprobado; implementación; tests del §4; `npm run check` e `integration` en verde; PR fusionado

## 6 · Riesgos

| Riesgo | Gravedad | Mitigación |
|---|---|---|
| Superficie de ataque propia (registro, login) | Alta | Argon2id, límites, bloqueo, errores genéricos, pruebas de enumeración |
| Argon2 nativo en la imagen | Media | La CI arranca las imágenes (H2); alternativa `@node-rs/argon2` |
| Robo del refresh | Media | Un solo uso, familia y revocación; TTL de 7 días |
| Bloqueo usado como denegación contra un usuario | Media | Bloqueo temporal y limitación por IP |
| Mucho alcance (8 h) | Media | Separable en dos PR: núcleo (`packages/auth`, rutas) y RBAC/GraphQL |

## 7 · Preguntas abiertas

1. **Registro:** abierto solo para `BIDDER` y `ADMIN`/`SELLER` creados por un `ADMIN` (propuesta). El primer `ADMIN` por variable de entorno al arrancar. ¿Bien?
2. **Vida de los tokens:** acceso 10 min, refresh 7 días con rotación (propuesta). ¿Bien?
3. **Bloqueo:** 5 fallos → 15 min (propuesta).
4. **`X-Admin-Key` de D7** se sustituye por el rol `ADMIN` (propuesta); la clave de servicio desaparece. ¿O se mantiene para operaciones sin usuario?
5. **Dos PR** (núcleo y RBAC/GraphQL) en lugar de uno. ¿Bien?

---

## Changelog de implementación — parte 1 (núcleo)

- Migración `0006_auth` (`app_user`, `refresh_token`, enums `user_role`/`user_status`; sin deriva respecto al esquema).
- `@bidstream/auth`: Argon2id (19 MiB, 2 iteraciones, 1 hilo) con verificación contra un hash falso para igualar tiempos, política de contraseñas, JWT EdDSA con `jose` (solo `EdDSA`; rechaza `none`, HS256 con la clave pública como secreto, emisor/audiencia distintos, `kid` desconocido, rol inventado), `AuthService` (registro, login con bloqueo 5/15 min, refresh con rotación y detección de reutilización atómica, logout, perfil) y configuración con rotación por `kid`. 14 pruebas unitarias y 15 de integración.
- API: `AUTH_MODE` (`jwt` por defecto en producción; `header` prohibido en producción), `/v1/auth/{register,login,refresh,logout,me}` con límite por IP (429 `problem+json`), `registerAuthentication`, `JwtTenantResolver`/`JwtBidderResolver` (el tenant y el postor salen del token y se **ignoran** `X-Tenant-Id`/`X-Bidder-Id`), administrador inicial por entorno e imágenes con argon2 verificadas. 20 pruebas de integración de la API.
- Desviación: el modo `header` se conserva solo fuera de producción (pruebas y desarrollo) en lugar de retirarse; en producción la API ya arranca y exige token.
- Pendiente (parte 2): `requireRole`, deny-by-default, creación de SELLER/ADMIN por un ADMIN, GraphQL con el mismo JWT, `/v1/admin/*` por rol, `make demo` autenticado, ADR-0013 y quitar el bloqueo de GraphQL en producción.
