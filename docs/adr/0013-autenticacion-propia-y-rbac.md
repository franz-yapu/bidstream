# 0013 — Autenticación propia, JWT corto con refresh rotatorio y RBAC denegando por defecto

**Estado:** Aceptada
**Fecha:** 2026-11-13 (decisión Q4 del usuario, implementada en F1)

## Contexto

Hasta F1 el tenant y el postor llegaban en cabeceras (`X-Tenant-Id`, `X-Bidder-Id`) que cualquier cliente
podía elegir ([ADR-0010](0010-tenant-provisional-por-cabecera.md)), por lo que la API y GraphQL se negaban
a arrancar en producción. Hacía falta identificar a quien opera, limitar lo que puede hacer (OWASP A01,
A07) y aislar a los tenants.

## Decisión

Autenticación **propia** (decisión del usuario, frente a delegar en un proveedor de identidad externo):

- **Usuarios** (`app_user`) por tenant, con rol `ADMIN`, `SELLER` o `BIDDER`; el postor **es** el usuario
  (`bidderId = userId`). Contraseñas con **Argon2id** y política mínima; el registro público solo crea
  `BIDDER` y un `ADMIN` crea los demás roles dentro de **su** tenant. El primer `ADMIN` sale de la
  configuración.
- **JWT de acceso** EdDSA de 10 minutos (`sub`, `tid`, `role`, `jti`), verificable por la API y por GraphQL
  con la clave pública (rotación por `kid`). **Refresh token** opaco de 7 días, solo su SHA-256 en base de
  datos, **de un solo uso**: cada refresco lo rota y presentar uno ya usado revoca toda la familia.
- **Bloqueo** de 15 minutos tras 5 fallos y **un único error** de credenciales (`401` genérico) para
  usuario inexistente, contraseña incorrecta, tenant equivocado, cuenta bloqueada o deshabilitada; se
  iguala el coste con un hash falso. Límite de peticiones por IP en `/v1/auth/*`.
- **RBAC denegando por defecto**: en modo `jwt` toda ruta exige un token válido salvo las declaradas
  públicas, y debe declarar los roles que la pueden usar; una ruta sin política se deniega con `403`. El
  tenant y el postor salen **solo del token**. La administración del DLQ ([ADR-0007](0007-consumidores-idempotentes-y-dlq.md))
  pasa de una clave de servicio al rol `ADMIN`.
- El modo `header` solo existe fuera de producción (pruebas y desarrollo); en producción el modo es `jwt` y
  las claves son obligatorias.

## Alternativas descartadas

| Alternativa                                    | Por qué no                                                                                    |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Proveedor externo (OIDC, p. ej. Entra ID)      | Era la opción con menos superficie propia; el usuario eligió autenticación propia completa    |
| JWT de larga duración sin refresh              | No se puede revocar; un token robado serviría hasta caducar                                   |
| Sesiones en servidor                           | Estado compartido entre réplicas de API y GraphQL; el JWT se verifica sin llamarse            |
| Roles comprobados a mano en cada ruta          | Olvidar uno deja una ruta abierta; la política declarativa con denegación por defecto no       |
| Mantener `X-Admin-Key` para el DLQ             | Una clave compartida no identifica a nadie y no se revoca; ahora el log registra al `actor`    |

## Consecuencias

**Se gana:** identidad y aislamiento por tenant reales; el fallo de una ruta olvidada es cerrar, no abrir;
API y GraphQL pueden desplegarse en producción; trazabilidad de quién administra.

**Se pierde:** superficie de ataque propia que mantener (registro, inicio de sesión, almacén de
contraseñas y tokens) y una clave de emisión que custodiar (Key Vault en H1). No hay verificación de
correo, recuperación de contraseña ni MFA. El tenant se elige al registrarse: quien conozca el UUID de un
tenant puede registrarse como `BIDDER` en él.

**Obliga a:** declarar `config.roles` en toda ruta nueva; a no poner jamás contraseñas, hashes ni tokens en
logs (probado); a retirar un `kid` de `AUTH_JWT_PUBLIC_KEYS` si se compromete la clave; y a sellar el
registro si el tenant deja de ser público.

## Verificación

- SDD: [F1](../sdd/F1/SDD.md).
- Pruebas: [`auth.test.ts`](../../packages/auth/src/auth.test.ts) (Argon2id, JWT: caducidad, `alg none`,
  HS256 con la clave pública, `kid`, rol inventado), [`auth.int.test.ts`](../../packages/auth/src/auth.int.test.ts)
  (rotación, reutilización, bloqueo, errores idénticos), [`auth.int.test.ts`](../../apps/api/src/auth.int.test.ts)
  y [`access.int.test.ts`](../../apps/api/src/access.int.test.ts) (matriz de roles, denegar por defecto,
  aislamiento entre tenants, sin secretos en logs), [`admin.int.test.ts`](../../apps/api/src/admin.int.test.ts)
  (DLQ solo ADMIN) y [`auth.int.test.ts`](../../apps/graphql/src/auth.int.test.ts) (GraphQL).
