# Seguridad en bidstream

**Fecha:** 2026-11-13 · **Alcance:** este repositorio (API, GraphQL, consumidores y paquetes) · **Revisión:** al cerrar H1/H4 (Azure y observabilidad)

Este documento es el mapeo de los controles del sistema contra el **OWASP Top 10** que pide la
[especificación §8](docs/product/bidstream_spec.md). No es un pentest ni una certificación: dice qué
está implementado, **dónde está la evidencia** y qué queda pendiente con su bloqueo.

## Cómo reportar una vulnerabilidad

Usa un **aviso de seguridad privado** del repositorio (GitHub → _Security_ → _Report a
vulnerability_). No abras un _issue_ público con detalles explotables. Incluye la versión o commit,
los pasos para reproducirlo y el impacto que observaste; confirma antes de publicar nada.

## Leyenda de estados

| Estado | Significado                                                         |
| ------ | ------------------------------------------------------------------- |
| ✅     | Implementado y cubierto por pruebas en el repositorio               |
| 🟡     | Implementado en parte; el resto depende de un bloqueo conocido      |
| ⛔     | Pendiente y bloqueado; se indica el bloqueo y la mitigación vigente |

## Índice

| Punto                                                      | Control                        | Estado | Bloqueo                 |
| ---------------------------------------------------------- | ------------------------------ | ------ | ----------------------- |
| [A01](#a01--control-de-acceso)                             | Control de acceso              | ✅     | —                       |
| [A02](#a02--fallos-criptográficos)                         | Fallos criptográficos          | 🟡     | TLS y Key Vault → H1/H3 |
| [A03](#a03--inyección)                                     | Inyección                      | ✅     | —                       |
| [A04](#a04--diseño-inseguro)                               | Diseño inseguro                | ✅     | —                       |
| [A05](#a05--mala-configuración)                            | Mala configuración             | ✅     | —                       |
| [A06](#a06--componentes-vulnerables-y-desactualizados)     | Componentes vulnerables        | ✅     | —                       |
| [A07](#a07--fallos-de-identificación-y-autenticación)      | Fallos de autenticación        | ✅     | —                       |
| [A08](#a08--fallos-de-integridad-de-datos-y-software)      | Integridad de datos y software | ✅     | —                       |
| [A09](#a09--fallos-de-registro-y-monitorización)           | Registro y monitorización      | 🟡     | Alertas → H4            |
| [A10](#a10--falsificación-de-peticiones-del-servidor-ssrf) | SSRF                           | ✅     | —                       |

---

## A01 · Control de acceso

**Qué hay.** Denegar por defecto: toda ruta de la API exige token salvo las declaradas públicas
(salud, documentación, registro, login y refresh) y debe declarar los roles que la pueden usar o se
deniega con `403`. El tenant y el postor salen **del token**, no de cabeceras. Los repositorios
filtran siempre por `tenantId`; GraphQL toma el tenant de la misma identidad. La identidad por
cabeceras (`X-Tenant-Id`/`X-Bidder-Id`) solo existe fuera de producción y el arranque falla si se
intenta en producción.

**Evidencia.** [access-control.ts](apps/api/src/access-control.ts),
[auth-context.ts](apps/api/src/auth-context.ts),
[auction-repository.ts](packages/db/src/repositories/auction-repository.ts),
[lot-repository.ts](packages/db/src/repositories/lot-repository.ts),
[tenant.ts](apps/graphql/src/tenant.ts), [ADR-0013](docs/adr/0013-autenticacion-propia-y-rbac.md).

**Estado:** ✅ implementado y probado (`access.int.test.ts`, `auth.int.test.ts` en API y GraphQL).

**Límite.** No hay Row-Level Security en PostgreSQL: es opcional en la spec (Q6). La propiedad del
recurso se resuelve por tenant y por el filtro de los repositorios.

## A02 · Fallos criptográficos

**Qué hay.** Contraseñas con **Argon2id** y los parámetros recomendados por OWASP (19 MiB, 2
iteraciones, 1 hilo). JWT de acceso **EdDSA (Ed25519)** y firma de eventos con el mismo tipo de
clave. El refresh es un valor aleatorio de 32 bytes; en la base solo se guarda su **SHA-256**. Los
secretos y claves entran por variables de entorno: `.env*` está ignorado, las claves de desarrollo
se generan con un script y nunca se versionan, y la imagen de contenedor no copia fuentes ni `.env`.

**Evidencia.** [password.ts](packages/auth/src/password.ts), [tokens.ts](packages/auth/src/tokens.ts),
[keys.ts](packages/signing/src/keys.ts), [generate-keys.mjs](scripts/generate-keys.mjs),
[.gitignore](.gitignore), [Dockerfile](Dockerfile).

**Estado:** 🟡. Argon2id y Ed25519 están implementados; **TLS** lo terminará el borde de Azure
(H1/H3) y **Key Vault** es H1.

**Límite.** En local y en el contenedor no hay TLS: se usa HTTP. Mitigación actual: HSTS en
producción, contraseñas y claves fuera del repositorio y `Cache-Control: no-store` en las respuestas
de autenticación. El Bicep de H1 ya crea Key Vault con RBAC y PostgreSQL con TLS obligatorio; falta
desplegarlo (Q1).

## A03 · Inyección

**Qué hay.** Validación **Zod en el borde** (cuerpo, parámetros, cabeceras y respuestas) y cuerpos
`strictObject`. Prisma parametriza las consultas; el SQL crudo se escribe solo con plantillas
etiquetadas y valores ligados (`$queryRaw`, `$executeRaw`), nunca concatenando texto. GraphQL tiene
límites de profundidad, alias, complejidad, tamaño de token y de cuerpo, _batching_ desactivado e
introspección configurable; se aplican antes de los resolvers.

**Evidencia.** [bids.ts](apps/api/src/routes/bids.ts),
[idempotency-store.ts](packages/db/src/idempotency/idempotency-store.ts),
[lot-decision-repository.ts](packages/db/src/decision/lot-decision-repository.ts),
[limits/](apps/graphql/src/limits/index.ts).

**Estado:** ✅ implementado y probado (`limits.test.ts`, `hardening.int.test.ts` de GraphQL y las
pruebas de la API).

## A04 · Diseño inseguro

**Qué hay.** Límite de **30 pujas por postor y minuto** contado en PostgreSQL (exacto entre
réplicas), `Idempotency-Key` obligatoria que evita duplicar un comando, ventana anti-sniping que
extiende el cierre y cierre decidido por la misma partición del lote (un solo escritor de
`LotClosed`). El dinero usa `Decimal(12,2)` y las reglas de dominio son funciones puras con pruebas.

**Evidencia.** [place-bid.ts](apps/api/src/commands/place-bid.ts),
[idempotency-store.ts](packages/db/src/idempotency/idempotency-store.ts),
[decide.ts](apps/decider/src/decide.ts), [closer.ts](apps/closer/src/closer.ts),
[schema.prisma](packages/db/prisma/schema.prisma).

**Estado:** ✅ implementado y probado (`idempotency.int.test.ts`, `hardening.int.test.ts` y las
pruebas del decisor y del closer).

## A05 · Mala configuración

**Qué hay.** `@fastify/helmet` con CSP `default-src 'none'; frame-ancestors 'none'` (la
documentación es la única excepción), `Referrer-Policy`, HSTS solo en producción y sin
`X-Powered-By`. CORS con **lista blanca exacta** (vacía por defecto, `*` rechazado) en API y
GraphQL. Los errores salen como `problem+json` sin pila ni mensajes de la base. `AUTH_MODE` se fuerza
a `jwt` en producción. El contenedor corre como usuario `node`, sobre una imagen fijada por digest y
sin secretos.

**Evidencia.** [app.ts](apps/api/src/app.ts),
[security-headers.ts](apps/graphql/src/security-headers.ts), [problem.ts](apps/api/src/problem.ts),
[config.ts](apps/api/src/config.ts), [Dockerfile](Dockerfile).

**Estado:** ✅ implementado y probado (`hardening.int.test.ts` de API y GraphQL).

**Límite.** La configuración del proxy, WAF y TLS de borde corresponde al despliegue en Azure (H1).

## A06 · Componentes vulnerables y desactualizados

**Qué hay.** Un flujo `security` en la CI ejecuta `npm audit --omit=dev --audit-level=low` y
`npm audit --audit-level=high`, verifica las firmas del registro con un npm fijado y corre también
cada semana. Dependabot abre actualizaciones agrupadas de npm, acciones e imagen base; las acciones
de GitHub van fijadas por SHA; `minimatch` está forzado a una versión corregida con `overrides`.

**Evidencia.** [security.yml](.github/workflows/security.yml),
[dependabot.yml](.github/dependabot.yml), [package.json](package.json),
[ci.yml](.github/workflows/ci.yml).

**Estado:** ✅ implementado (`docs/sdd/F6/SDD.md`).

**Límite.** El escaneo de imágenes y su publicación en ACR dependen de H1.

## A07 · Fallos de identificación y autenticación

**Qué hay.** Autenticación propia: Argon2id, JWT de acceso EdDSA de **10 minutos** con `sub`, `tid`,
`role` y `jti`, y refresh opaco de **7 días** de un solo uso con rotación; reutilizar un refresh
revoca la familia. Tras **5 fallos** la cuenta se bloquea **15 minutos**. Todos los fallos de
credenciales devuelven el mismo error. El registro público solo crea `BIDDER`; un `ADMIN` crea los
demás roles en su tenant. El login tiene límite por IP.

**Evidencia.** [service.ts](packages/auth/src/service.ts), [tokens.ts](packages/auth/src/tokens.ts),
[password.ts](packages/auth/src/password.ts), [config.ts](packages/auth/src/config.ts),
[ADR-0013](docs/adr/0013-autenticacion-propia-y-rbac.md).

**Estado:** ✅ implementado y probado (`auth.test.ts` y `auth.int.test.ts`).

**Límite.** El primer administrador se crea de forma idempotente con variables de entorno; su
contraseña debe rotarse fuera de la demostración.

## A08 · Fallos de integridad de datos y software

**Qué hay.** El relay firma con **Ed25519** los bytes exactos del valor y añade `x-signature` y
`x-key-id`; cada consumidor verifica la firma (`enforce` en producción, `off` fuera de ella, con un
corte para el historial anterior a la firma). Un mensaje manipulado o sin firma no se aplica: va al
DLQ como veneno, conservando la firma para un reproceso correcto. Los eventos tienen contrato Zod y
`version`, y la bitácora `audit_log` es **append-only** por disparadores de base de datos.

**Evidencia.** [relay.ts](apps/relay/src/relay.ts), [verifier.ts](packages/signing/src/verifier.ts),
[dlq.ts](packages/consumer/src/dlq.ts),
[migración 0003](packages/db/prisma/migrations/0003_audit_log/migration.sql),
[ADR-0012](docs/adr/0012-firma-ed25519-de-eventos.md).

**Estado:** ✅ implementado y probado (`signing.test.ts`, `event-consumer.int.test.ts` y las pruebas
de la bitácora).

**Límite.** La rotación usa `kid` y exige conservar las claves públicas antiguas; el corte del
historial sin firma se podrá quitar cuando el log esté sellado. La clave privada vivirá en Key Vault
cuando llegue H1.

## A09 · Fallos de registro y monitorización

**Qué hay.** Una línea JSON por evento con `createLogger`, que **redacta** claves sensibles y
contraseñas de URL. El `requestId` de la API viaja como `meta.correlationId` al evento, como cabecera
de Kafka y aparece en los logs del consumidor y en el DLQ. Nunca se registra el `payload` del evento
ni `bidderId`. La bitácora `audit_log` es append-only y solo se escribe con `recordAuditEntry`; el
DLQ permite inspeccionar y reprocesar por HTTP para `ADMIN`.

**Evidencia.** [logger.ts](packages/logging/src/logger.ts),
[redact.ts](packages/logging/src/redact.ts),
[migración 0003](packages/db/prisma/migrations/0003_audit_log/migration.sql),
[dlq-admin.ts](packages/consumer/src/dlq-admin.ts).

**Estado:** 🟡. Los logs y la bitácora están implementados; las **alertas** y las métricas de
_consumer lag_ son H4.

**Límite.** Hoy no hay alertas automáticas ni centralización en Azure; la detección depende de los
logs y del DLQ. El Bicep de H1 deja Log Analytics listo; H4 añadirá las métricas y alertas, bloqueado
por Q1.

## A10 · Falsificación de peticiones del servidor (SSRF)

**Qué hay.** El sistema **no hace peticiones HTTP salientes** ni acepta URLs del usuario: solo habla
con PostgreSQL y Kafka, cuyos destinos vienen de variables de entorno. No hay webhooks, importación
remota de imágenes ni redirecciones controladas por el cliente.

**Evidencia.** [bids.ts](apps/api/src/routes/bids.ts), [app.ts](apps/api/src/app.ts),
[Dockerfile](Dockerfile).

**Estado:** ✅. Si en el futuro se añade una integración saliente (por ejemplo, notificaciones por
webhook), deberá validar el destino contra una lista blanca y resolver el DNS de forma segura.

---

## Verificación automática

`packages/testing/src/docs/security.test.ts` comprueba en `npm run check` que las diez secciones
existan, que cada una cite evidencia que realmente está en el repo, que todos los enlaces relativos
resuelvan y que los estados 🟡/⛔ nombren su bloqueo. También impide que TLS, Key Vault o las alertas
se presenten como hechos y que el archivo incluya material secreto.
