# SDD — A3 · Puertos hexagonales

- **Ticket:** ClickUp **A3** (`868mvtfrh`, https://app.clickup.com/t/868mvtfrh).
- **Autor:** generado con Claude (Entregable 1).
- **Estado:** Implementado (2026-11-12) — aprobado el mismo día
- **Versión:** 1.0 · **Fecha:** 2026-11-12
- **Fuentes de verdad citadas:**
  1. `docs/product/bidstream_spec.md` §1 (arquitectura hexagonal), §5 (outbox: validar contra la proyección y escribir en outbox en una sola transacción)
  2. `docs/do-not-touch.md` — "Dominio sin dependencias de infraestructura"
  3. `docs/sdd/A1/SDD.md` (tipos `LotState`, `AuctionState` y `EventDraft`; A3 depende de A1)
  4. `docs/sdd/A2/SDD.md` (`DomainEvent`)

---

## 1 · Alcance

### Entra

- Interfaces TypeScript (puertos) en `packages/domain/src/ports/`: `Clock`, `IdGenerator`, `LotRepository`, `AuctionRepository`, `EventPublisher`.
- Dobles de prueba en memoria para usar en los tests de dominio y de aplicación.
- Documentar la regla de dependencia: el dominio define los puertos; las apps los implementan.

### No entra (a propósito)

- Cualquier implementación real (Prisma → B2, outbox → B2/D1, Kafka → D2).
- Casos de uso de aplicación (aceptar puja, crear subasta): C2/C3.
- Un puerto de transacción (`UnitOfWork`): ver §7 #1.

### Premisas verificadas (heredadas de `task-brief`)

| Premisa del ticket | Qué hay de verdad |
|---|---|
| "Sin implementaciones; B2, D1 y otros las implementan después" | Cierto: `packages/domain` solo tiene el contrato de eventos (A2); `BuildDeps` de A2 ya modela reloj e ids como funciones |
| Depende de A1 y A2 | A2 implementado; A1 aún en borrador (los repositorios devuelven los estados que define A1) |

---

## 2 · Diseño técnico

### 2.1 Puertos

```ts
interface Clock { now(): Date }
interface IdGenerator { newId(): string }            // UUID v7

interface LotRepository {
  findById(tenantId: string, lotId: string): Promise<LotState | null>;
}
interface AuctionRepository {
  findById(tenantId: string, auctionId: string): Promise<AuctionState | null>;
}
interface EventPublisher {
  publish(events: readonly DomainEvent[]): Promise<void>;
}
```

### 2.2 Decisiones y por qué

| Decisión | Elección | Por qué |
|---|---|---|
| Repositorios de **solo lectura** | Sin `save`/`update` | En event sourcing el estado de la proyección lo escribe únicamente el `projector` al consumir eventos; el lado de comandos lee la proyección y publica eventos. Un `save` aquí permitiría saltarse el log |
| `tenantId` como parámetro explícito | Todo acceso lleva el tenant | Aislamiento multi-tenant desde el contrato (spec §6, RLS opcional) |
| `EventPublisher` recibe eventos ya construidos | `publish(events)` | La implementación de la API escribe filas de outbox **en la misma transacción** que la validación (spec §5); el puerto no revela cómo |
| `IdGenerator` y `Clock` por separado | Interfaces de una sola función | Cada uno se sustituye por separado en tests; compatibles con `BuildDeps` de A2 mediante un adaptador de una línea |
| Los puertos viven en el dominio | `packages/domain/src/ports/` | Regla de dependencia hexagonal: las apps dependen del dominio, no al revés |
| Dobles en memoria incluidos | `FixedClock`, `SequentialIdGenerator`, `InMemoryLotRepository`, `InMemoryAuctionRepository`, `RecordingEventPublisher` | Permiten probar casos de uso sin infraestructura y fijan la semántica esperada de los puertos |

### 2.3 Transacción

La atomicidad "validar + escribir en outbox" no cabe en estos puertos sin más. Propuesta para C3: el adaptador de `EventPublisher` y el de `LotRepository` se construyen sobre el mismo cliente transaccional, y la aplicación abre la transacción con una función propia de la capa de aplicación (fuera del dominio). Se formaliza en el SDD de C2.

---

## 3 · Cambios por archivo/módulo

| Archivo/módulo | Cambio |
|---|---|
| `packages/domain/src/ports/clock.ts`, `id-generator.ts`, `lot-repository.ts`, `auction-repository.ts`, `event-publisher.ts` | Nuevos, según §2.1 |
| `packages/domain/src/ports/index.ts` | Reexporta los puertos |
| `packages/domain/src/ports/fakes.ts` | Dobles en memoria de §2.2 (se exportan para los tests de otros paquetes) |
| `packages/domain/src/ports/ports.test.ts` | Tests de §4 |
| `packages/domain/src/index.ts` | Reexportar `./ports/index.js` |
| `docs/do-not-touch.md` | Sin cambio |

---

## 4 · Plan de tests

| Caso | Nivel | Cubre |
|---|---|---|
| `FixedClock` devuelve siempre la hora fijada y permite avanzarla | unit | Doble de `Clock` |
| `SequentialIdGenerator` produce UUID v7 válidos, distintos y reproducibles | unit | Doble de `IdGenerator` |
| `InMemoryLotRepository` devuelve `null` si no existe y aísla por `tenantId` | unit | Aislamiento por tenant |
| `RecordingEventPublisher` conserva los eventos en orden | unit | Doble de `EventPublisher` |
| Los dobles cumplen las interfaces (comprobado por el compilador) | typecheck | Contrato |
| `packages/domain` sigue sin importar infraestructura | lint | Pureza |

**Deliberadamente sin test:** las interfaces en sí (no tienen comportamiento).

---

## 5 · Definition of Done

- [x] SDD en `docs/sdd/A3/SDD.md`, Estado = Aprobado (y A1 aprobado/implementado antes)
- [x] 5 puertos y 5 dobles en memoria
- [x] Tests del §4 en verde; `npm run check` en verde
- [x] Sin dependencias de infraestructura en `packages/domain`
- [x] Commit con conventional commits

---

## 6 · Riesgos

| Riesgo | Gravedad | Mitigación |
|---|---|---|
| Los puertos se definen antes de los casos de uso y pueden quedar mal ajustados | Media | Son pequeños y de lectura; C2/C3 pueden ampliarlos con un SDD |
| Los repositorios de solo lectura confunden a quien espera CRUD | Baja | Decisión documentada en §2.2 |
| Atomicidad outbox + validación no resuelta aquí | Media | Se aborda explícitamente en el SDD de C2 (§2.3) |

---

## 7 · Preguntas abiertas

1. ¿Añadimos ya un puerto `UnitOfWork` (`run(work)` transaccional)? Propuesta: no; se decide en C2 con el cliente Prisma a la vista.
2. ¿Los repositorios deben exponer también consultas de lectura de la proyección (ranking de pujas)? Propuesta: no; eso es del lado GraphQL (E1), no del dominio de comandos.

---

## Changelog de implementación

- **Implementado (2026-11-12):** 5 puertos y 5 dobles en memoria en `packages/domain/src/ports/`, según el diseño. Sin `UnitOfWork` ni consultas de ranking (DEC-009).
- Añadido `buildDepsFrom(clock, ids)`: adaptador de `Clock` + `IdGenerator` a las dependencias de `buildEvent` (A2).
- Los dobles se exportan desde el índice del paquete para los tests de otros paquetes; si en el futuro no deben ir en el bundle de producción, se moverán a un subpath `testing`.
- 8 tests nuevos (106 en total); `npm run check` en verde.
