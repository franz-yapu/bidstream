# Seguridad

Este documento recorre el [OWASP Top 10](https://owasp.org/Top10/) y dice, para cada punto, **qué se hizo**,
**dónde está** y **qué prueba lo demuestra**, y qué todavía **no** está hecho. Las afirmaciones sin prueba
no tienen cabida: las rutas de este archivo las comprueba
[`security.test.ts`](packages/testing/src/docs/security.test.ts).

## Reportar una vulnerabilidad

Usa el **reporte privado de GitHub** («Security» → «Report a vulnerability») en
<https://github.com/franz-yapu/bidstream/security/advisories/new>. No abras una incidencia pública con
detalles de explotación. Es un proyecto personal: se responde en cuanto es posible, sin plazo garantizado.

## Fronteras de confianza

| Frontera                         | Qué cruza            | Defensa principal                                                                   |
| -------------------------------- | -------------------- | ----------------------------------------------------------------------------------- |
| Cliente → API / GraphQL          | Peticiones HTTP      | JWT corto, RBAC denegando por defecto, validación con Zod, límites, CORS, cabeceras |
| API → PostgreSQL                 | Comandos y consultas | Prisma parametrizado, tenant en toda consulta, transacciones                        |
| Relay → Kafka → consumidores     | Eventos y comandos   | Firma Ed25519, idempotencia, DLQ                                                    |
| Operador → API de administración | Reproceso del DLQ    | Solo rol `ADMIN`, registro del `actor`                                              |

## Mapeo OWASP Top 10

Estados: **Hecho**, **Parcial** (hay control pero falta algo que depende de otra tarea) y **Pendiente**.

### A01 · Control de acceso roto — _Hecho_

- **Qué se hizo:** control por rol que **deniega por defecto** ([`access-control.ts`](apps/api/src/access-control.ts)):
  toda ruta exige token salvo las públicas y debe declarar los roles que la pueden usar, o responde `403`.
  El tenant y el postor salen **solo del token**, nunca de una cabecera; toda consulta filtra por tenant.
  Un `ADMIN` solo crea usuarios en **su** tenant. GraphQL verifica el mismo JWT.
  [ADR-0013](docs/adr/0013-autenticacion-propia-y-rbac.md).
- **Evidencia:** [`access.int.test.ts`](apps/api/src/access.int.test.ts) (matriz de roles, ruta olvidada
  denegada, enumeración de todas las rutas), [`auth.int.test.ts`](apps/api/src/auth.int.test.ts)
  (cabeceras de identidad ignoradas, aislamiento entre tenants),
  [`auth.int.test.ts`](apps/graphql/src/auth.int.test.ts) (GraphQL).

### A02 · Fallos criptográficos — _Parcial_

- **Qué se hizo:** contraseñas con **Argon2id** ([`password.ts`](packages/auth/src/password.ts)); JWT y firma de
  eventos con **Ed25519** ([`tokens.ts`](packages/auth/src/tokens.ts), [ADR-0012](docs/adr/0012-firma-ed25519-de-eventos.md));
  refresh tokens opacos guardados solo como SHA-256; HSTS en producción; secretos solo por entorno, nunca
  en las imágenes ni en los logs.
- **Evidencia:** [`auth.test.ts`](packages/auth/src/auth.test.ts), [`signing.test.ts`](packages/signing/src/signing.test.ts),
  [`docker-policy.test.ts`](packages/testing/src/policy/docker-policy.test.ts) (sin secretos en la imagen),
  [`hardening.int.test.ts`](apps/api/src/hardening.int.test.ts) (HSTS).
- **Falta:** **TLS extremo a extremo** y **custodia de claves en Key Vault** dependen del despliegue en
  Azure (H1, bloqueado por la suscripción). Hoy el entorno local va en texto plano.

### A03 · Inyección — _Hecho_

- **Qué se hizo:** Prisma parametrizado; el SQL crudo (outbox, cierre, bloqueos) usa solo plantillas
  etiquetadas, nunca `*Unsafe`; validación **con Zod en el borde** de cada ruta; GraphQL con límites de
  profundidad, complejidad, alias, tokens y tamaño ([E2](docs/sdd/E2/SDD.md)).
- **Evidencia:** [`security.test.ts`](packages/testing/src/docs/security.test.ts) (ningún `*Unsafe`),
  [`limits.int.test.ts`](apps/graphql/src/limits.int.test.ts), [`commands.int.test.ts`](apps/api/src/commands.int.test.ts)
  (entradas inválidas rechazadas).

### A04 · Diseño inseguro — _Hecho_

- **Qué se hizo:** **límite de pujas por postor y minuto** (30), contado en PostgreSQL con un bloqueo por
  postor (exacto entre réplicas); **claves de idempotencia** obligatorias en la puja; **anti-sniping**; un
  **único escritor por lote** (el decisor) para que ninguna puja se acepte tras el cierre
  ([ADR-0011](docs/adr/0011-decisor-unico-por-lote.md)); tope de reprocesos del DLQ.
- **Evidencia:** [`hardening.int.test.ts`](apps/api/src/hardening.int.test.ts) (429, ráfaga entre dos
  instancias), [`idempotency.int.test.ts`](apps/api/src/idempotency.int.test.ts) (20 peticiones simultáneas,
  un comando), [`closer.int.test.ts`](apps/closer/src/closer.int.test.ts) (puja y cierre a la vez).

### A05 · Configuración de seguridad incorrecta — _Hecho_

- **Qué se hizo:** cabeceras de seguridad (helmet, CSP `default-src 'none'`, en [`app.ts`](apps/api/src/app.ts) y
  [`security-headers.ts`](apps/graphql/src/security-headers.ts)), **CORS con lista blanca**
  (vacía por defecto; `*` rechazado), **sin trazas de error al cliente** (`problem+json`), configuración
  validada al arrancar, el modo por cabecera **prohibido en producción**, imágenes como usuario no root y
  con la base fijada por digest ([`Dockerfile`](Dockerfile)).
- **Evidencia:** [`hardening.int.test.ts`](apps/api/src/hardening.int.test.ts) y
  [`hardening.int.test.ts`](apps/graphql/src/hardening.int.test.ts), [`config.test.ts`](apps/api/src/config.test.ts),
  [`docker-policy.test.ts`](packages/testing/src/policy/docker-policy.test.ts).

### A06 · Componentes vulnerables y desactualizados — _Hecho_

- **Qué se hizo:** `npm audit` en cada PR y cada semana (producción y alto/crítico), Dependabot para npm,
  acciones de GitHub y la imagen base, todas las acciones fijadas por SHA y `overrides` para los avisos
  conocidos ([F6](docs/sdd/F6/SDD.md)).
- **Evidencia:** [`repo-policy.test.ts`](packages/testing/src/policy/repo-policy.test.ts) y el flujo
  [`security.yml`](.github/workflows/security.yml).
- **Falta:** escaneo de vulnerabilidades de las imágenes (H1).

### A07 · Fallos de identificación y autenticación — _Hecho_

- **Qué se hizo:** ([`service.ts`](packages/auth/src/service.ts), [ADR-0013](docs/adr/0013-autenticacion-propia-y-rbac.md))
  JWT de acceso de 10 minutos, **refresh token de un solo uso con rotación y revocación de
  toda la familia si se reutiliza**, **bloqueo** de 15 minutos tras 5 fallos, **un único error** de
  credenciales (sin enumerar usuarios) y límite de peticiones por IP en `/v1/auth/*`.
- **Evidencia:** [`auth.int.test.ts`](packages/auth/src/auth.int.test.ts) (rotación, reutilización, bloqueo),
  [`auth.int.test.ts`](apps/api/src/auth.int.test.ts) (respuestas idénticas, 429).
- **Falta:** MFA, verificación de correo y recuperación de contraseña (no hay infraestructura de correo).

### A08 · Fallos de integridad de software y datos — _Parcial_

- **Qué se hizo:** **firma Ed25519 de cada mensaje** y verificación en los cinco consumidores (uno
  manipulado va al DLQ sin aplicarse); bitácora `audit_log` **append-only** (disparadores en la base);
  acciones por SHA y base de imagen por digest.
- **Evidencia:** [`signing.int.test.ts`](apps/projector/src/signing.int.test.ts), [`audit.int.test.ts`](packages/db/src/audit/audit.int.test.ts).
- **Falta / límite conocido:** la fecha de un mensaje **sin firma** la declara el propio mensaje, así que el
  corte `EVENT_SIGNING_REQUIRED_FROM` (que acepta el historial anterior a la firma) solo protege hasta que
  se selle el historial; después hay que quitarlo ([ADR-0012](docs/adr/0012-firma-ed25519-de-eventos.md)).
  Falta además un rol de base de datos con solo `INSERT`/`SELECT` sobre `audit_log` (H1).

### A09 · Fallos de registro y monitorización — _Parcial_

- **Qué se hizo:** logs JSON estructurados con **id de correlación** de la petición a los consumidores,
  **redacción de secretos** y contraseñas de URL, la bitácora append-only y el registro del `actor` en las
  operaciones de administración ([F4](docs/sdd/F4/SDD.md)).
- **Evidencia:** [`logger.test.ts`](packages/logging/src/logger.test.ts) (redacción),
  [`correlation.int.test.ts`](apps/projector/src/correlation.int.test.ts) (la cadena completa y sin fugas),
  [`auth.int.test.ts`](apps/api/src/auth.int.test.ts) (ninguna contraseña, hash ni token en logs).
- **Falta:** **alertas** y métricas de _consumer lag_ (H4, requiere Azure).

### A10 · Falsificación de peticiones del lado del servidor (SSRF) — _Hecho_

- **Qué se hizo:** la aplicación **no hace llamadas HTTP salientes**: solo habla con PostgreSQL ([`index.ts`](packages/db/src/index.ts)) y Kafka
  ([`client.ts`](packages/kafka/src/client.ts)), así
  que ninguna URL controlada por un usuario se solicita desde el servidor.
- **Evidencia:** [`security.test.ts`](packages/testing/src/docs/security.test.ts) busca en el código de la
  aplicación cualquier cliente HTTP (`fetch`, `axios`, `undici`, `http.request/get`) y falla si aparece.

## Límites conocidos y pendientes

- TLS extremo a extremo, Key Vault y el escaneo de imágenes llegan con el despliegue en Azure (H1).
- Alertas y métricas de _consumer lag_ (H4).
- MFA, verificación de correo y recuperación de contraseña.
- El tenant es un UUID que elige quien se registra: quien lo conozca puede registrarse como `BIDDER`
  ([ADR-0013](docs/adr/0013-autenticacion-propia-y-rbac.md)).
- El límite global por IP es **por réplica** (el límite de pujas, en cambio, es exacto entre réplicas).
- Sellar el historial de eventos firmados para retirar el corte `EVENT_SIGNING_REQUIRED_FROM`.
