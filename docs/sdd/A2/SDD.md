# SDD — A2 · Contrato de eventos (7 tipos) con Zod

- **Ticket:** ClickUp **A2** (`868mvtfqz`, https://app.clickup.com/t/868mvtfqz).
- **Autor:** generado con Claude (Entregable 1).
- **Estado:** Borrador
- **Versión:** 1.0 · **Fecha:** 2026-11-12
- **Fuentes de verdad citadas:**
  1. `docs/product/bidstream_spec.md` §3 (modelo de eventos), §4 (clave de partición), §6 (Decimal(12,2))
  2. `docs/product/business-rules.md` #6 (dinero), #8 (sobre del evento)
  3. `docs/adr/0001-clave-de-particion-lotid.md`
  4. `docs/do-not-touch.md` — "Contrato de eventos (§3, `version`)" y "Dominio sin dependencias de infraestructura"
  5. `docs/sdd/0.1/SDD.md` §2.4 (regla de pureza del dominio)

---

## 1 · Alcance

### Entra

- Esquemas Zod de los 7 eventos con el sobre común: `eventId` (UUID v7), `type`, `occurredAt`, `tenantId`, `version`, `payload`.
- Tipos TypeScript derivados de los esquemas (una sola fuente de verdad).
- Unión discriminada `DomainEvent` por `type`, y `parseEvent(unknown)` que valida un mensaje entrante.
- `buildEvent(...)`: fabrica un evento con `eventId` v7 y `occurredAt` generados por funciones **inyectables** (sin leer el reloj directamente).
- `partitionKey(event)`: la clave del mensaje en Kafka.
- Tests de validación.

### No entra (a propósito)

- Publicar o consumir eventos (D1, D3…): aquí solo el contrato.
- Firma de eventos (F3, bloqueado por Q5). El sobre dejará espacio para añadir un campo de firma sin romper la versión (ver §2.4).
- Versionado de evolución (`version` 2, upcasters): solo se fija `version: 1`.
- El puerto `Clock` → A3. `buildEvent` recibe funciones, no depende del puerto.

### Premisas verificadas (heredadas de `task-brief`)

| Premisa del ticket | Qué hay de verdad |
|---|---|
| "Esquemas Zod de los 7 eventos en `packages/domain`" | Existe `packages/domain` (0.1) con un marcador; no hay `zod` ni `uuid` instalados; no existe `src/events/` |
| UUID v7 | Node 22 no genera v7 de serie; se usa el paquete `uuid` (v14.0.3 hoy, soporta v7). Es una librería pura, permitida por la regla de pureza |
| Zod | Zod 4.6.7 (versión actual en el registro) |
| Dinero | La spec §6 fija `Decimal(12,2)` en la base; para el transporte JSON no hay decimal nativo |

---

## 2 · Diseño técnico

### 2.1 Sobre común

```ts
{
  eventId:    UUID v7            // identidad del evento; clave de idempotencia de los consumidores
  type:       'AuctionOpened' | ... // discriminante
  occurredAt: ISO-8601 UTC ('2026-11-12T19:00:00.000Z')
  tenantId:   UUID
  version:    1                  // versión del esquema de ESE tipo de evento
  payload:    { ... }            // específico de cada tipo
}
```

### 2.2 Payloads (spec §3)

| Evento | Payload |
|---|---|
| `AuctionOpened` | `auctionId`, `title`, `opensAt`, `closesAt` |
| `LotPublished` | `lotId`, `auctionId`, `title`, `startingPrice`, `minIncrement`, `currency`, `closesAt` |
| `BidPlaced` | `lotId`, `bidderId`, `amount`, `placedAt` |
| `BidRejected` | `lotId`, `bidderId`, `amount`, `reason` |
| `LotExtended` | `lotId`, `newClosesAt`, `reason: 'anti-sniping'` |
| `LotClosed` | `lotId`, `winnerId` (nullable, ver §7 #3), `finalAmount` (nullable) |
| `AuctionClosed` | `auctionId` |

### 2.3 Decisiones y por qué

| Decisión | Elección | Por qué |
|---|---|---|
| Dinero | **String decimal** con regex `^\d{1,10}(\.\d{1,2})?$` (cabe en `Decimal(12,2)`), nunca `number` | Business-rule #6: nunca flotantes. Un `number` en JSON pierde precisión y `0.1+0.2` rompe la igualdad |
| Fechas | `z.iso.datetime()` con sufijo `Z` (UTC), tipo string en el contrato | El JSON no tiene fecha; UTC explícito evita zonas horarias en el log inmutable |
| `eventId` | UUID **v7** estricto (rechaza v4) | Ordenable por tiempo y exigido por la spec; es la clave de idempotencia |
| Ids de agregado (`lotId`, `auctionId`, `bidderId`, `tenantId`) | UUID (cualquier versión) | La base usa `@db.Uuid` |
| `currency` | 3 letras mayúsculas (`^[A-Z]{3}$`) | `Char(3)`, ISO 4217; no se valida contra la lista completa |
| Objetos | `z.strictObject` (rechaza campos desconocidos) | El contrato es cerrado; un campo extra es un bug o un ataque; evolucionar = subir `version` |
| `version` | Literal `1` por tipo | La spec lista `version` en todo evento; se interpreta como versión del esquema del tipo |
| Unión | `z.discriminatedUnion('type', [...])` | Errores precisos y tipos estrechos por `type` |
| Tipos | `z.infer`, sin interfaces duplicadas | Una sola fuente de verdad |
| Construcción | `buildEvent(input, deps = { newId: uuidv7, now: () => new Date() })` | Determinismo en tests sin reloj global; el dominio no lee el reloj directamente |
| Clave Kafka | `partitionKey(event)`: `lotId` para los 5 eventos de lote; `auctionId` para `AuctionOpened`/`AuctionClosed` | ADR-0001 exige `lotId` para lotes; los eventos de subasta no tienen `lotId` (ver §7 #1) |

### 2.4 Espacio para evolución

El sobre es cerrado (`strictObject`). Añadir la firma (F3) o metadatos de correlación (F4) será un cambio de contrato que sube `version` a 2 con un ADR, o un campo opcional `meta` reservado desde ya. Se propone **reservar ahora** `meta?: { correlationId?: string; signature?: string }` opcional, para no romper consumidores después (§7 #2).

---

## 3 · Cambios por archivo/módulo

| Archivo/módulo | Cambio |
|---|---|
| `packages/domain/package.json` | Añadir dependencias `zod` y `uuid` |
| `packages/domain/src/events/primitives.ts` | Esquemas base: `uuidV7`, `uuid`, `isoDateTime`, `money`, `currency`, `title` (no vacío, máx. 200) |
| `packages/domain/src/events/envelope.ts` | Función que fabrica el esquema del sobre para cada tipo |
| `packages/domain/src/events/{auction,lot,bid}.ts` | Los 7 esquemas con sus payloads |
| `packages/domain/src/events/index.ts` | `DomainEvent`, `EventType`, `parseEvent`, `buildEvent`, `partitionKey` |
| `packages/domain/src/index.ts` | Re-exportar `./events/index.js`; conservar el marcador hasta A1 |
| `packages/domain/src/events/*.test.ts` | Tests de §4 |
| `docs/product/business-rules.md` | Sin cambio (ya cita #8) |
| `docs/decisions/LOG.md` | Decisiones de §7 una vez respondidas |

---

## 4 · Plan de tests

| Caso | Nivel | Cubre |
|---|---|---|
| Cada uno de los 7 eventos válidos se acepta y se tipa correctamente | unit | Esquemas |
| Falta de cada campo del sobre (`eventId`, `type`, `occurredAt`, `tenantId`, `version`, `payload`) → rechazo | unit | Sobre completo |
| `eventId` v4 rechazado; v7 aceptado | unit | UUID v7 estricto |
| Montos: `"10.50"`, `"10"` OK; `10.5` (número), `"10.505"`, `"-1"`, `"1e3"`, 11 enteros → rechazo | unit | Dinero seguro |
| Fecha sin `Z` o con offset → rechazo | unit | UTC |
| Campo desconocido en sobre o payload → rechazo | unit | Contrato cerrado |
| `type` desconocido → rechazo | unit | Unión |
| `LotExtended.reason` distinto de `'anti-sniping'` → rechazo | unit | Literal |
| `buildEvent` con `newId`/`now` fijos produce un evento válido y reproducible | unit | Inyección |
| `parseEvent(JSON.parse(JSON.stringify(e)))` devuelve un evento igual | unit | Round-trip |
| `partitionKey`: `lotId` en eventos de lote, `auctionId` en los de subasta | unit | ADR-0001 |
| Archivos de `packages/domain` no importan infraestructura (lo hace cumplir ESLint) | lint | Pureza |

**Deliberadamente sin test:** ordenabilidad temporal de UUID v7 (es garantía de la librería); validación contra la lista ISO 4217 completa (fuera de alcance).

---

## 5 · Definition of Done

- [ ] SDD en `docs/sdd/A2/SDD.md`, Estado = Aprobado
- [ ] Los 7 esquemas con sobre común, tipos derivados y `parseEvent`/`buildEvent`/`partitionKey`
- [ ] Dinero nunca como `number` en ningún tipo del contrato
- [ ] Tests del §4 en verde
- [ ] `npm run check` en verde; `packages/domain` sin imports de infraestructura
- [ ] Preguntas de §7 respondidas y reflejadas en `docs/decisions/LOG.md`
- [ ] Commit con conventional commits

---

## 6 · Riesgos

| Riesgo | Gravedad | Mitigación |
|---|---|---|
| El contrato es la interfaz de 3 consumidores: un error aquí se propaga a todo | Alta | Contrato cerrado, tests exhaustivos, cambios solo con ADR + subir `version` (ver `do-not-touch.md`) |
| `strictObject` rechaza mensajes de una versión futura durante un despliegue mixto | Media | Evolución por `version`; los consumidores nuevos se despliegan antes que los productores |
| `AuctionOpened`/`AuctionClosed` sin `lotId` rompen la regla "todo en `events.lot` con clave `lotId`" | Media | Decisión explícita en §7 #1 |
| Montos como string se confunden con número en código cliente | Baja | Tipo de marca (`Money`) y documentación; ningún campo del contrato es `number` |
| `uuid` o `zod` cambian API en una versión mayor | Baja | Versiones fijadas por lockfile |

---

## 7 · Preguntas abiertas

1. **Clave y topic de `AuctionOpened`/`AuctionClosed`.** La spec manda todos los eventos a `bidstream.events.lot` con clave `lotId`, pero estos dos no tienen `lotId`. Propuesta: mismo topic, clave `auctionId`. Consecuencia: no hay orden garantizado entre `AuctionClosed` y los `LotClosed` de sus lotes (están en particiones distintas). Alternativa: topic aparte `bidstream.events.auction`. **Respuesta pendiente.**
2. **Reservar `meta` opcional** (`correlationId`, `signature`) en el sobre desde ya, o dejarlo para un cambio de versión. Propuesta: reservarlo.
3. **`LotClosed` sin pujas.** La spec da `winnerId` y `finalAmount`; un lote sin pujas se cierra sin ganador. Propuesta: `winnerId` y `finalAmount` anulables (`null`) y la regla "sin pujas = sin adjudicación" en A1.
4. **Valores de `BidRejected.reason`.** La spec no los enumera. Propuesta: `BID_TOO_LOW`, `LOT_CLOSED`, `LOT_NOT_OPEN`, `LOT_NOT_FOUND`, `DUPLICATE_BID`. A cerrar junto con Q2 (autoridad de la puja).
5. **Ubicación:** el contrato vive en `packages/domain/src/events/` (no en `packages/contracts`). Si luego los clientes externos necesitan solo los tipos, se extrae.
