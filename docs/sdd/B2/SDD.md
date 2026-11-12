# SDD — B2 · Repositorios Prisma de proyección y outbox

- **Ticket:** ClickUp **B2** (`868mvtxzb`, https://app.clickup.com/t/868mvtxzb).
- **Autor:** generado con Claude (Entregable 1).
- **Estado:** Implementado (2026-11-12) — aprobado el mismo día
- **Versión:** 1.0 · **Fecha:** 2026-11-12
- **Fuentes de verdad citadas:**
  1. `docs/product/bidstream_spec.md` §5 (outbox en la misma transacción que la validación), §6 (esquema)
  2. `docs/sdd/A3/SDD.md` §2.1–2.3 (puertos de solo lectura, `EventPublisher`, transacción diferida a C2) y §7 #1
  3. `docs/sdd/B1/SDD.md` §2 (tablas, `Bid.id` = `eventId`) y su changelog
  4. `docs/sdd/A1/SDD.md` §2.3 (`LotState`, `AuctionState`), `docs/sdd/A2/SDD.md` (`partitionKey`)
  5. `docs/do-not-touch.md` — dominio sin infraestructura; patrón outbox

---

## 0 · Preguntas que el ticket pidió cerrar

| # | Pregunta del ticket | Respuesta |
|---|---|---|
| 1 | ¿Cómo se garantiza que la lectura y el outbox compartan transacción? | Un ayudante `withTransaction` que construye los repositorios sobre el mismo cliente transaccional (§2.2) |

---

## 1 · Alcance

### Entra

- En `@bidstream/db`: adaptadores `PrismaLotRepository` y `PrismaAuctionRepository` (implementan los puertos de A3, solo lectura, siempre filtrando por `tenantId`).
- `PrismaOutbox`: `enqueue(events, topic)` que escribe filas de `OutboxMessage` desde eventos de dominio.
- `withTransaction(prisma, work)`: ejecuta `work` con repositorios y outbox ligados a la **misma** transacción.
- Mapeo fila ↔ `LotState`/`AuctionState` (dinero a centavos con `parseMoney`, estados, fechas).
- Pruebas de integración con PostgreSQL real.

### No entra (a propósito)

- Escritura de la proyección (`Auction`, `Lot`, `Bid`): es del `projector` → D4.
- Consulta y marcado de pendientes del outbox (`FOR UPDATE SKIP LOCKED`, `publishedAt`): es del relay → D1, que añade sus métodos aquí o en su paquete.
- Casos de uso (crear subasta, pujar) → C2/C3.
- Un puerto `UnitOfWork` en el dominio: la transacción es una preocupación de la capa de aplicación (decisión de A3 §7 #1); `withTransaction` vive en `@bidstream/db`.

### Premisas verificadas (heredadas de `task-brief`)

| Premisa del ticket | Qué hay de verdad |
|---|---|
| "Adaptadores Prisma de `LotRepository` y `AuctionRepository`" | Los puertos existen en `packages/domain/src/ports/` (A3) y devuelven `LotState`/`AuctionState` o `null` |
| "Dinero a `bigint` con `parseMoney`" | `parseMoney` acepta `^\d{1,10}(\.\d{1,2})?$`; un `Decimal` de Prisma se convierte con `toFixed(2)` |
| Estado de un lote cerrado | `LotState.finalAmount` no tiene columna propia: el monto final es `currentPrice` cuando hay `winnerId` (el evento `LotClosed` lo repite, `finalAmount` = precio vigente) |
| `AuctionState.openLotIds` | No existe columna: se obtiene con una consulta de los lotes `OPEN` de la subasta |
| `OutboxMessage.id` | `@db.Uuid` sin valor por defecto: hay que proporcionarlo |

---

## 2 · Diseño técnico

### 2.1 Decisiones y por qué

| Decisión | Elección | Por qué |
|---|---|---|
| Ubicación | `packages/db/src/repositories/` | Es infraestructura Prisma; el dominio solo conoce los puertos |
| Cliente aceptado | Un tipo mínimo (`DbClient`) que cubre `PrismaClient` y `Prisma.TransactionClient` | El mismo repositorio sirve dentro y fuera de una transacción |
| Aislamiento por tenant | `where: { id, tenantId }` en toda lectura | Un lote de otro tenant devuelve `null`, nunca el dato |
| `OutboxMessage.id` | El `eventId` del evento (UUID v7) | Idempotente: reintentar el `enqueue` del mismo evento no crea un segundo mensaje (clave primaria) |
| `key` y `payload` | `key = partitionKey(event)` (ADR-0001); `payload` = el evento completo como JSON | El relay (D1) publica `key` y `payload` tal cual, sin recalcular nada |
| `topic` | Parámetro de `enqueue`, no una constante de `db` | `@bidstream/db` no debe depender de `@bidstream/kafka`; la app pasa `TOPICS.eventsLot` |
| Mapeo de `Decimal` | `parseMoney(decimal.toFixed(2))` | Sin pasar por `number` (business-rule #6) |
| Lote cerrado | `finalAmount = winnerId === null ? null : currentPrice` | Reconstruye el estado coherente con `evolveLot` |
| `enqueue` con varios eventos | Una sola `createMany` (todo o nada dentro de la transacción) | Atomicidad del lote de eventos de un comando |
| Rechazo de duplicados | `enqueue` usa `skipDuplicates: false`: un `eventId` repetido **falla** | Un duplicado en un mismo comando es un bug que debe verse |

### 2.2 Transacción

```ts
withTransaction(prisma, async (tx) => {
  const lot = await tx.lots.findById(tenantId, lotId);     // lectura de la proyección
  const events = decideBid(lot, bid, config);               // dominio puro (C3)
  await tx.outbox.enqueue(events.map(toEvent), TOPICS.eventsLot);
});
```

`withTransaction` abre `prisma.$transaction(...)` interactiva y entrega `{ lots, auctions, outbox }` ligados a esa transacción. Si `work` lanza, se revierte todo, incluido el outbox: nunca se publica un evento de un comando que falló (spec §5).

### 2.3 Qué pasa con el aislamiento de lecturas

La lectura de la proyección dentro de la transacción usa el nivel por defecto (*read committed*). La condición de carrera "dos pujas simultáneas leen el mismo precio" **no se resuelve aquí**: depende de la autoridad de la puja (Q2/C3). B2 solo garantiza atomicidad lectura + outbox.

---

## 3 · Cambios por archivo/módulo

| Archivo/módulo | Cambio |
|---|---|
| `packages/db/src/repositories/lot-repository.ts` | `PrismaLotRepository` + mapeo fila → `LotState` |
| `packages/db/src/repositories/auction-repository.ts` | `PrismaAuctionRepository` + consulta de `openLotIds` |
| `packages/db/src/repositories/outbox.ts` | `PrismaOutbox.enqueue` |
| `packages/db/src/repositories/transaction.ts` | `withTransaction` y el tipo `DbClient` |
| `packages/db/src/index.ts` | Reexporta repositorios, outbox y `withTransaction` |
| `packages/db/package.json` | `@bidstream/domain` pasa de dev a dependencia (los adaptadores implementan sus puertos y usan `parseMoney`, `partitionKey`) |
| `packages/db/src/repositories/*.int.test.ts` | Pruebas de §4 |
| `docs/do-not-touch.md` | Sin cambio |

---

## 4 · Plan de tests

Integración contra PostgreSQL de `make up` (base desechable; usa las utilidades de G1 cuando estén disponibles).

| Caso | Nivel | Cubre |
|---|---|---|
| `findById` devuelve `LotState` correcto para un lote abierto sin pujas (dinero en centavos, fechas, `currentPrice` nulo) | integración | Mapeo |
| Lote con pujas y lote cerrado con ganador / desierto → `finalAmount` y `winnerId` coherentes con `foldLot` del mismo historial | integración | Mapeo fiel a `evolveLot` |
| Un lote de otro `tenantId` → `null` | integración | Aislamiento |
| `PrismaAuctionRepository` devuelve `openLotIds` solo con lotes abiertos | integración | `AuctionState` |
| `enqueue` escribe filas con `id = eventId`, `key = partitionKey`, `payload` igual al evento y `publishedAt` nulo | integración | Outbox |
| Reenviar el mismo evento falla (clave primaria) | integración | Idempotencia / bug visible |
| Dentro de `withTransaction`, si `work` lanza **después** de `enqueue`, no queda ninguna fila en `outbox_message` | integración | Atomicidad (spec §5) |
| Si `work` termina bien, la lectura previa y las filas del outbox quedan confirmadas a la vez | integración | Commit conjunto |
| Dinero: `10.50` y `0.05` → `1050n` y `5n`; nunca `number` | unit | Conversión de `Decimal` |

**Deliberadamente sin test:** concurrencia de pujas simultáneas (C3/Q2); consultas del relay (D1).

---

## 5 · Definition of Done

- [x] SDD en `docs/sdd/B2/SDD.md`, Estado = Aprobado
- [x] Repositorios y outbox implementan los puertos de A3 y se usan a través de `withTransaction`
- [x] El dominio sigue sin importar Prisma (ESLint)
- [x] Tests del §4 en verde (integración y unitarios); `npm run check` en verde
- [x] PR con CI verde y fusionado

---

## 6 · Riesgos

| Riesgo | Gravedad | Mitigación |
|---|---|---|
| El mapeo se desalinea de `evolveLot` y el lado de comandos lee un estado distinto del que construye el `projector` | Alta | Test que compara el estado leído de la base con `foldLot` del mismo historial |
| Se tomen lecturas obsoletas porque la proyección es eventualmente consistente | Media | Es inherente a la arquitectura; la autoridad de la puja (Q2) lo resuelve en C3 |
| `Decimal` de Prisma convertido por `number` por descuido | Media | Un único punto de conversión con test de bordes |
| Una transacción larga bloquea conexiones | Baja | Transacciones cortas (lectura + `createMany`); tiempo máximo explícito |

---

## 7 · Preguntas abiertas

1. ¿`OutboxMessage.id` = `eventId` (propuesta) o un UUID v7 nuevo? Con `eventId`, reintentar un comando no duplica el mensaje.
2. ¿`withTransaction` en `@bidstream/db` (propuesta) o un puerto `UnitOfWork` en el dominio? Propuesta: en `db`; el dominio no necesita conocer transacciones.
3. ¿Los métodos de consulta de pendientes del outbox (D1) van en este mismo repositorio o en el paquete del relay? Propuesta: en `@bidstream/db`, junto a `enqueue`, para que el SQL de la tabla viva en un solo sitio.

---

## Changelog de implementación

- **Implementado (2026-11-12)** con las respuestas aprobadas de §7: `OutboxMessage.id = eventId`, `withTransaction` en `@bidstream/db`, y las consultas de pendientes del relay (D1) irán en este mismo paquete junto a `enqueue`.
- Archivos en `packages/db/src/repositories/`: `mappers.ts`, `lot-repository.ts`, `auction-repository.ts`, `outbox.ts`, `transaction.ts`. `@bidstream/domain` pasó de dependencia de desarrollo a dependencia normal; el build del paquete referencia explícitamente al dominio.
- `DbClient` es `Pick<PrismaClient, 'lot' | 'auction' | 'outboxMessage'>`: sirve igual el cliente normal que el de una transacción. `withTransaction` fija un tiempo máximo (5 s por defecto, configurable).
- Pruebas (17 nuevas): 4 unitarias de conversión de `Decimal` y 14 de integración. Los estados leídos se comparan con `foldLot`/`evolveAuction` del mismo historial (abierto sin pujas, con pujas y extensión, cerrado con ganador, desierto); aislamiento por tenant; `openLotIds` solo con lotes abiertos de esa subasta; filas del outbox con `id = eventId`, `key = partitionKey` y payload igual al evento; duplicado rechazado; lote de eventos todo o nada; rollback del outbox si el trabajo lanza; y confirmación conjunta (desde otra conexión no se ve nada hasta el commit).
- Mismo choque `dist`/`src` de `PrismaClient` que en G1: la prueba crea su cliente con `createPrismaClient` del propio paquete en lugar de usar el de `@bidstream/testing`.
- Sigue sin resolverse a propósito la carrera entre pujas simultáneas (depende de Q2/C3).
