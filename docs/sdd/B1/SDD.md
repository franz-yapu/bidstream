# SDD — B1 · Esquema Prisma, migración inicial e índices

- **Ticket:** ClickUp **B1** (`868mvtxz8`, https://app.clickup.com/t/868mvtxz8).
- **Autor:** generado con Claude (Entregable 1).
- **Estado:** Implementado (2026-11-12) — aprobado el mismo día
- **Versión:** 1.1 · **Fecha:** 2026-11-12
- **Fuentes de verdad citadas:**
  1. `docs/product/bidstream_spec.md` §6 (esquema Prisma y detalles obligatorios), §5 (idempotencia por `eventId`, outbox)
  2. `docs/product/business-rules.md` #2 (desempate), #5 (adjudicación única), #6 (dinero)
  3. `docs/sdd/A1/SDD.md` §2.3 (`LotState`, `AuctionState`), `docs/sdd/A2/SDD.md` (`BidPlaced` no trae id de puja)
  4. `docs/sdd/0.2/SDD.md` (PostgreSQL 16 local, `DATABASE_URL`)
  5. `docs/do-not-touch.md` — dominio sin infraestructura

---

## 0 · Preguntas que el ticket pidió cerrar

| # | Pregunta del ticket | Respuesta |
|---|---|---|
| 1 | ¿Dónde vive el paquete de datos y cómo se genera el cliente? | Nuevo workspace `packages/db` (`@bidstream/db`); cliente generado dentro del paquete (§2.1) |
| 2 | ¿Las enums coinciden con `LotState.status`? | Sí: `OPEN` / `CLOSED` en `LotStatus` y `AuctionStatus` (§2.3) |

---

## 1 · Alcance

### Entra

- Paquete `@bidstream/db` con `schema.prisma`, migración inicial versionada y cliente generado.
- Los cinco modelos de la spec §6 con las correcciones de §2.4 y los índices de §2.5.
- Scripts `db:generate`, `db:migrate` (aplicar), `db:migrate:dev` (crear migraciones) y objetivo `make migrate`.
- Pruebas de integración de las restricciones contra PostgreSQL real.

### No entra (a propósito)

- Adaptadores de repositorio y outbox → B2.
- Tabla de bitácora del `auditor` → D6; tablas de usuarios y credenciales → F1 (Q4).
- Row-Level Security por tenant → Q6 (opcional).
- Datos de ejemplo (seed).

### Premisas verificadas (heredadas de `task-brief`)

| Premisa del ticket | Qué hay de verdad |
|---|---|
| "Esquema de la spec §6" | Se puede usar casi tal cual, pero **tiene dos defectos** (§2.4) y un índice único parcial que, como está descrito, no protege nada (§2.5) |
| PostgreSQL local | `make up` deja `postgres:16-alpine` con `DATABASE_URL=postgresql://bidstream:bidstream@localhost:5432/bidstream` |
| Prisma | Última estable: `prisma`/`@prisma/client` 7.10.1 (la 8.0 solo existe como RC); Prisma 7 usa **driver adapters** (`@prisma/adapter-pg` 7.10.1) y un archivo `prisma.config.ts` |
| Enums del dominio | `LotState.status` y `AuctionState.status` son `'open' \| 'closed'` |

---

## 2 · Diseño técnico

### 2.1 Decisiones y por qué

| Decisión | Elección | Por qué |
|---|---|---|
| Ubicación | `packages/db` (`@bidstream/db`), no en `packages/domain` | El dominio no puede depender de Prisma (`do-not-touch.md`); un paquete aparte lo aísla y lo comparten la API, el relay y el `projector` |
| Versión de Prisma | **7.10.1** (estable), fijada por lockfile | La 8 es candidata a versión; un proyecto de portafolio no debe fundarse en un RC |
| Conexión | Driver adapter `@prisma/adapter-pg` + `prisma.config.ts` leyendo `DATABASE_URL` | Es el modelo de Prisma 7; el SDD se confirma al implementar contra la documentación de esa versión |
| Migraciones | Versionadas en `packages/db/prisma/migrations/`, con partes en SQL a mano (índices parciales) | Prisma no expresa índices parciales; el SQL queda versionado junto a la migración |
| Nombres | Tablas/columnas en `snake_case` con `@@map`/`@map`, modelos en PascalCase | Convención habitual de PostgreSQL y consultas SQL legibles (incluye la demostración del reproceso) |
| Id de `Bid` | **El `eventId` del `BidPlaced`** | El evento no trae id de puja (A2); usar su `eventId` hace al `Bid` determinista e idempotente: reprocesar el mismo evento no crea una segunda puja |
| Enums | `AuctionStatus { OPEN CLOSED }`, `LotStatus { OPEN CLOSED }` | Coinciden con el dominio |
| Dinero | `Decimal(12,2)` en todas las columnas de monto | Spec §6 y business-rule #6 |

### 2.2 Modelos (resumen)

`Auction`, `Lot`, `Bid`, `ProcessedEvent` y `OutboxMessage` según la spec §6, con los cambios de §2.4. `Lot.currentPrice` y `Lot.currentBidder` son el estado vigente; `Lot.closesAt` se actualiza con `LotExtended`.

### 2.3 Mapeo con el dominio

| Evento | Efecto en la proyección (lo implementa D4 con `evolveLot`/`evolveAuction`) |
|---|---|
| `AuctionOpened` | inserta `Auction(OPEN)` |
| `LotPublished` | inserta `Lot(OPEN)` |
| `BidPlaced` | inserta `Bid(id = eventId)` y actualiza `currentPrice`/`currentBidder` |
| `LotExtended` | actualiza `Lot.closesAt` |
| `LotClosed` | `Lot(CLOSED)`, `winnerId`; marca la puja ganadora (§2.5) |
| `AuctionClosed` | `Auction(CLOSED)` |

### 2.4 Correcciones a la spec §6

1. **`ProcessedEvent` tiene la clave mal definida.** La spec declara `eventId @id` *y* `@@unique([eventId, consumer])`. Con `eventId` como clave primaria, el segundo consumidor (`notifier`, `auditor`) no podría registrar el mismo evento que ya registró el `projector`: la idempotencia de los tres grupos se rompería. Corrección: clave primaria compuesta `@@id([eventId, consumer])` y se elimina el `@id` suelto.
2. **Falta una restricción real de adjudicación única** (§2.5).
3. **Índice de pendientes del outbox:** el índice `(publishedAt, createdAt)` de la spec sirve, pero el relay solo consulta filas con `publishedAt IS NULL`; se añade además un índice parcial (§2.5).

### 2.5 Índices

| Índice | Definición | Por qué |
|---|---|---|
| Desempate | `Bid (lotId, amount DESC, placedAt, id)` | Ranking determinista (regla #2); en el esquema Prisma |
| Lotes por estado | `Lot (tenantId, status, closesAt)` y `Auction (tenantId, status)` | Spec §6 |
| Outbox pendientes | `CREATE INDEX ... ON outbox_message (created_at) WHERE published_at IS NULL` (SQL a mano) | El relay recorre solo lo pendiente; el índice se mantiene pequeño |
| **Adjudicación única** | Añadir `Bid.awarded boolean default false` y `CREATE UNIQUE INDEX ... ON bid (lot_id) WHERE awarded` (SQL a mano) | La spec pide "índice único parcial que impide dos lotes adjudicados", pero con `Lot.id` como clave primaria un lote no puede existir dos veces: el índice sería redundante. La garantía útil es que **como mucho una puja por lote** pueda marcarse como adjudicada, y es lo que impide la base si un bug del projector intentara adjudicar otra |

Restricciones de coherencia adicionales (p. ej. exigir `winner_id` al cerrar) quedan fuera: duplicarían la lógica del dominio sin necesidad.

---

## 3 · Cambios por archivo/módulo

| Archivo/módulo | Cambio |
|---|---|
| `packages/db/package.json` | Nuevo `@bidstream/db`: dependencias `@prisma/client`, `@prisma/adapter-pg`, `pg`; dev `prisma`; scripts de §1 |
| `packages/db/prisma.config.ts` | Nuevo: ruta del esquema y `DATABASE_URL` |
| `packages/db/prisma/schema.prisma` | Nuevo: modelos de §2.2 con las correcciones de §2.4 |
| `packages/db/prisma/migrations/0001_init/migration.sql` | Nuevo: generado + SQL a mano de §2.5 |
| `packages/db/src/index.ts` | Reexporta el cliente generado y una función `createPrismaClient(databaseUrl)` |
| `packages/db/tsconfig*.json`, `tsconfig.json` (raíz) | Referencia al nuevo paquete |
| `Makefile` | Objetivo `migrate` |
| `.gitignore` | Ignorar el cliente generado si no se versiona |
| `package.json` (raíz) | Script `test:integration`; `vitest.config.ts` separa `*.int.test.ts` |
| `eslint.config.js` | Añadir `@bidstream/db` y `@prisma/*` ya prohibidos en el dominio (sin cambio de reglas) |
| `docs/product/business-rules.md` | Aclarar #5 con la restricción real (§2.5) |

---

## 4 · Plan de tests

Pruebas de **integración** contra PostgreSQL real de `make up` (archivos `*.int.test.ts`; se ejecutan con `npm run test:integration`, que G1 llevará a la CI).

| Caso | Nivel | Cubre |
|---|---|---|
| Las migraciones se aplican desde una base vacía y `prisma migrate status` queda limpio | integración | Migración inicial |
| `Decimal(12,2)`: `10.50` se guarda exacto; `10.505` se redondea o rechaza según definición; `0.1 + 0.2` sumado en SQL da `0.30` | integración | Dinero sin flotantes |
| Un segundo `Bid` marcado `awarded` para el mismo lote falla por el índice único parcial; dos no adjudicadas conviven | integración | Adjudicación única |
| `ProcessedEvent`: el mismo `eventId` puede registrarse para `projector` y `notifier`, pero no dos veces para el mismo consumidor | integración | Corrección §2.4 #1 |
| Insertar el mismo `Bid.id` dos veces falla (idempotencia del `eventId`) | integración | Id determinista |
| El orden `ORDER BY amount DESC, placed_at, id` coincide con `compareBids` del dominio para un conjunto con empates | integración | Desempate |
| `EXPLAIN` de la consulta de ranking usa el índice compuesto | integración | Índice del desempate |
| La consulta del relay (`WHERE published_at IS NULL ORDER BY created_at`) usa el índice parcial | integración | Índice parcial de outbox |

**Deliberadamente sin test:** el generador de Prisma y los tipos que produce (los valida el compilador); rendimiento con volumen (llega con la demostración).

---

## 5 · Definition of Done

- [x] SDD en `docs/sdd/B1/SDD.md`, Estado = Aprobado
- [x] `@bidstream/db` con esquema, migración inicial y cliente; `make migrate` desde cero funciona
- [x] Dinero en `Decimal(12,2)`; índice del desempate y restricciones de §2.5 en la migración
- [x] `ProcessedEvent` con clave compuesta (corrección documentada en el README/ADR de datos)
- [x] Tests del §4 en verde; `npm run check` en verde; dominio sin imports de Prisma
- [x] `business-rules.md` aclarado
- [x] PR con CI verde y fusionado

---

## 6 · Riesgos

| Riesgo | Gravedad | Mitigación |
|---|---|---|
| Prisma 7 cambia el modelo de conexión y generación respecto a lo que se conoce de la 6 | Media | Confirmar contra la documentación de 7.10.1 al implementar y registrar desviaciones en el changelog |
| Separar el SQL a mano del esquema de Prisma provoca *drift* | Media | Test que aplica las migraciones y comprueba los índices por consulta al catálogo |
| La corrección de `ProcessedEvent` se aparta de la spec publicada | Baja | Explicarla en el README (sección de decisiones): es un defecto de la spec, no una preferencia |
| `awarded` es una columna añadida a la spec §6 | Baja | Justificada en §2.5; se refleja en `business-rules.md` |

---

## 7 · Preguntas abiertas

1. **Adjudicación única:** ¿aceptas `Bid.awarded` + índice único parcial en lugar del índice literal de la spec (redundante con la clave primaria)? Propuesta: sí.
2. **`ProcessedEvent`:** ¿confirmas la clave primaria compuesta `(eventId, consumer)`? Propuesta: sí.
3. **Cliente generado:** ¿versionarlo en git o generarlo en `postinstall`/CI? Propuesta: no versionarlo y generarlo con `npm run db:generate` en `postinstall`.
4. **`snake_case` con `@@map`:** ¿de acuerdo? Propuesta: sí.

---

## Changelog de implementación

- **Implementado (2026-11-12)** con Prisma 7.10.1 y `@prisma/adapter-pg`; respuestas aprobadas de §7: `Bid.awarded` + índice único parcial, `ProcessedEvent` con clave primaria compuesta, cliente generado en `postinstall` sin versionar, nombres en `snake_case`.
- Migración `prisma/migrations/0001_init` (renombrada desde el nombre con marca de tiempo que genera Prisma) con dos índices parciales escritos a mano: `bid_one_awarded_per_lot_idx` y `outbox_message_pending_idx`. Fechas como `timestamptz(3)`.
- `prisma.config.ts` acepta `DATABASE_URL` ausente: `prisma generate` exige la variable aunque no se conecte y fallaba en un clon limpio/CI. Los comandos que se conectan fallan con "Connection url is empty".
- `make migrate`; scripts `db:generate`, `db:migrate`, `db:migrate:dev`. El cliente generado (`src/generated`) está ignorado por git, prettier y eslint.
- Pruebas de integración (12), cada ejecución en su propia base de datos desechable: migración y `migrate status`, cinco tablas, `Decimal(12,2)` (con Prisma y SQL, redondeo de 10.505 a 10.51, desbordamiento rechazado), adjudicación única, clave compuesta de `ProcessedEvent`, `Bid.id` idempotente, ranking SQL = `compareBids` del dominio con empates, y uso de ambos índices (`EXPLAIN`).
- Una prueba falló por un error propio, no del esquema: `SELECT amount::text … ORDER BY amount` ordena por la columna de salida (texto) y `'90.00'` quedaba después de `'150.00'`. Se califican las columnas (`bid.amount`). Es una trampa a recordar en las consultas de ranking de D4/E1.
- `@bidstream/domain` es dependencia de desarrollo del paquete solo para comparar con `compareBids` en las pruebas.

- **Revisión 1.1 (D4):** `lot.auction_id` deja de ser clave foránea (migración `0002_drop_lot_auction_fk`) y se quita la relación `Lot.auction`/`Auction.lots` del esquema. Motivo: los eventos de subasta (clave `auctionId`) y de lote (clave `lotId`) viajan por particiones distintas sin orden entre sí; en un reproceso desde `earliest` el lote puede procesarse antes que su subasta y la clave foránea lo haría fallar. La integridad la da C2 al validar la subasta antes de aceptar el comando. Ver `docs/sdd/D4/SDD.md` §2.4.
