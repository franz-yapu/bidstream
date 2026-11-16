# 0015 — Nombre público de los postores y lectura anónima de GraphQL

**Estado:** Aceptada
**Fecha:** 2026-11-16 (decisión del usuario: «nombre público de cada postor»; resto por las propuestas aprobadas del SDD de J2)

## Contexto

Hasta J1 ningún dato público identificaba a un postor ([ADR-0004](0004-graphql-solo-lecturas.md),
[ADR-0008](0008-tiempo-real-listen-notify-sse.md)) y GraphQL exigía sesión
([ADR-0013](0013-autenticacion-propia-y-rbac.md)). Para que un visitante vea las subastas como
espectador (quién va ganando, quién pujó) hacen falta dos cosas nuevas: mostrar a cada postor de alguna
forma y leer sin cuenta.

## Decisión

- **Nombre público** (`app_user.display_name`, 2–30 caracteres, letras, números, espacios y `. _ - '`): lo
  elige el usuario al registrarse y lo puede cambiar (`PATCH /v1/auth/me`). Es **único por tenant sin
  distinguir mayúsculas** (índice sobre `lower(display_name)`) para evitar suplantaciones.
- GraphQL expone solo ese nombre: `Bid.bidder`, `Lot.leader` (el que va ganando, solo lotes abiertos) y
  `Lot.winner` (solo lotes cerrados) devuelven `Bidder { displayName }`. **Nunca** salen el correo, el id
  del usuario, `bidderId`, `winnerId` ni `currentBidder`; una prueba lo vigila. Las notificaciones en vivo
  siguen sin identidad (el front vuelve a consultar).
- **Lectura anónima:** con `PUBLIC_TENANT_ID` configurado, una petición GraphQL **sin credenciales** lee
  ese tenant. Si trae un token (aunque sea inválido) o `X-Tenant-Id`, no se degrada a anónimo. Sigue
  siendo solo lectura y pasa por los mismos límites de coste y profundidad. La API REST sigue exigiendo
  sesión para todo salvo registro y entrada.
- Los usuarios que crea un administrador sin nombre reciben un alias (`Postor 7a3f`).

## Alternativas descartadas

| Alternativa                          | Por qué no                                                                    |
| ------------------------------------ | ----------------------------------------------------------------------------- |
| Alias anónimo generado por subasta   | Era la recomendación; el usuario prefirió que cada postor tenga nombre propio |
| Solo importes, sin postores          | No permite ver «quién va ganando»                                             |
| Tenant público elegido por el cliente | El cliente podría leer cualquier tenant: el público lo fija el entorno       |

## Consecuencias

- **Riesgo asumido:** un nombre real identifica a la persona. Se avisa al registrarse y se puede cambiar.
- Un nombre ofensivo solo se corrige a mano (renombrado por administrador: pendiente, ticket aparte).
- El tenant público y el de la demo coinciden: `PUBLIC_TENANT_ID` y `DEFAULT_TENANT_ID` del front.

## Verificación

- SDD de origen: [`docs/sdd/J2/SDD.md`](../sdd/J2/SDD.md).
- Lectura anónima, `Bid.bidder`/`Lot.leader`/`Lot.winner` y ausencia de correo e ids:
  [`apps/graphql/src/auth.int.test.ts`](../../apps/graphql/src/auth.int.test.ts).
- El esquema solo expone `Bidder.displayName`:
  [`apps/graphql/src/graphql.int.test.ts`](../../apps/graphql/src/graphql.int.test.ts).
- Registro con nombre público, unicidad y `PATCH /me`:
  [`apps/api/src/auth.int.test.ts`](../../apps/api/src/auth.int.test.ts).
