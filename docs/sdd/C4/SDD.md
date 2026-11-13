# SDD — C4 · Cabecera `Idempotency-Key` obligatoria en la puja

- **Ticket:** ClickUp **C4** (se crea al aprobar).
- **Autor:** generado con Claude (Entregable 1).
- **Estado:** Borrador (2026-11-13) — pendiente de aprobación
- **Versión:** 0.1 · **Fecha:** 2026-11-13
- **Depende de:** C3 (Q2 resuelta).
- **Fuentes de verdad citadas:** spec §5 (claves de idempotencia), §7 («Exige cabecera `Idempotency-Key`»), §8 A04; `docs/sdd/C3/SDD.md`; `apps/api/src/errors.ts` (`problem+json`)

---

## 0 · Preguntas que el ticket pidió cerrar

| # | Pregunta | Respuesta |
|---|---|---|
| 1 | ¿Qué hace la clave? | Un mismo `(tenant, bidder, clave)` produce **un solo comando**; repetir la petición devuelve la misma respuesta 202 |
| 2 | ¿Y si se reutiliza con otro cuerpo? | `422` (`IDEMPOTENCY_KEY_REUSED`): es un error del cliente |

---

## 1 · Alcance

### Entra

- Cabecera `Idempotency-Key` **obligatoria** en `POST /v1/lots/:id/bids` (`400` si falta o no cumple `^[A-Za-z0-9._-]{16,128}$`).
- Tabla `idempotency_key` (`tenant_id`, `bidder_id`, `key` → PK; `request_hash`, `command_id`, `lot_id`, `created_at`), escrita **en la misma transacción** que el comando en el outbox.
- Reintento con la misma clave y el mismo cuerpo → `202` con el **mismo** `commandId` y la cabecera `Idempotency-Replayed: true`, sin comando nuevo.
- Misma clave con distinto cuerpo o lote → `422`.
- Limpieza de claves antiguas (por defecto 24 h) con una tarea del `closer`/`relay`... → **fuera de este ticket** si F2 no la necesita (§7.2).

### No entra

- Idempotencia de los demás comandos (`POST /v1/auctions`, lotes): la spec solo la exige en la puja.
- Deduplicación en el consumidor: ya existe (`processed_event`, ADR-0007) y sigue siendo la red de seguridad.

### Premisas verificadas

| Premisa | Qué hay de verdad |
|---|---|
| «Claves de idempotencia» (A04) | No existen. Hoy un doble clic generaría dos `commandId` distintos |
| El consumidor ya deduplica | Por `commandId`/`eventId`, que serían distintos en cada reintento HTTP: la deduplicación **debe** ocurrir en la API |
| La tabla sirve a F2 | Sí: `(bidder_id, created_at)` permite contar las pujas por minuto de forma exacta entre réplicas |

---

## 2 · Diseño técnico

`INSERT … ON CONFLICT DO NOTHING` en la transacción del comando: si no inserta, se lee la fila existente, se compara `request_hash` (SHA-256 de `lotId + amount` canónico) y se responde con su `commandId`. Una carrera entre dos peticiones simultáneas con la misma clave la resuelve la clave primaria (la perdedora relee).

| Decisión | Elección | Por qué |
|---|---|---|
| Dónde se guarda | PostgreSQL, misma transacción que el outbox | Atomicidad; sirve a F2 |
| Ámbito de la clave | `(tenant, bidder, key)` | Un postor no puede colisionar ni espiar la clave de otro |
| Caducidad | 24 h (configurable) | Cubre reintentos razonables sin crecer sin límite |
| Qué se compara | Hash del cuerpo canónico y el lote | Detecta reutilización indebida |

---

## 3 · Cambios por archivo/módulo

| Archivo/módulo | Cambio |
|---|---|
| `packages/db/prisma` | Migración: `idempotency_key` |
| `packages/db/src/repositories/` | `PrismaIdempotencyStore` (`claim`, `find`) |
| `apps/api/src/commands/place-bid.ts`, `routes/bids.ts` | Validación de cabecera, repetición, `422` |
| `apps/api` OpenAPI | Cabecera documentada y respuestas `400/422` |

---

## 4 · Plan de tests

| Caso | Nivel | Cubre |
|---|---|---|
| Sin cabecera / formato inválido → `400` | integración | Obligatoria |
| Misma clave y cuerpo, dos veces → mismo `commandId`, **una** fila de outbox, `Idempotency-Replayed` | integración | Repetición |
| Misma clave, otro monto o lote → `422` | integración | Reutilización |
| 20 peticiones **simultáneas** con la misma clave → un comando | integración | Carrera |
| Mismo `key` para dos postores distintos → comandos independientes | integración | Aislamiento |
| Rollback del outbox → no queda clave | integración | Atomicidad |
| El hash es estable ante el orden de las claves | unit | Canonicalización |

---

## 5 · Definition of Done

- [ ] SDD Aprobado; tests del §4 en verde; `npm run check` e `integration` en verde; PR fusionado

## 6 · Riesgos

| Riesgo | Gravedad | Mitigación |
|---|---|---|
| Crecimiento de la tabla | Baja | Caducidad y limpieza (§7.2) |
| Respuesta repetida con estado distinto | Baja | Solo se repite la aceptación (`commandId`); el resultado se consulta por GraphQL |

## 7 · Preguntas abiertas

1. **Formato y obligatoriedad** (16–128 caracteres seguros; `400` si falta). ¿Bien?
2. **Limpieza de claves viejas:** propuesta de borrarlas dentro del `closer` (D8) cada hora, para no crear otro proceso. ¿O prefieres una tarea propia?
3. **Ámbito `(tenant, bidder, key)`** (propuesta).
