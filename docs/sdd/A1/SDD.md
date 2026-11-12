# SDD — A1 · Reglas del dominio como funciones puras

- **Ticket:** ClickUp **A1** (`868mvtfqh`, https://app.clickup.com/t/868mvtfqh).
- **Autor:** generado con Claude (Entregable 1).
- **Estado:** Borrador
- **Versión:** 1.0 · **Fecha:** 2026-11-12
- **Fuentes de verdad citadas:**
  1. `docs/product/bidstream_spec.md` §2 (dominio y 5 reglas), §3 (eventos), §6 (desempate, `Decimal(12,2)`)
  2. `docs/product/business-rules.md` #1–#7
  3. `docs/sdd/A2/SDD.md` (contrato de eventos) y DEC-006 (`LotClosed` anulable, motivos de rechazo)
  4. `docs/do-not-touch.md` — dominio sin infraestructura
  5. `docs/product/scope.md` — Fuera de alcance: UI, pagos

---

## 0 · Preguntas que el ticket pidió cerrar

| # | Pregunta | Respuesta |
|---|---|---|
| 1 | ¿Cómo se calcula con dinero sin flotantes dentro del dominio puro? | Enteros `bigint` en centavos; conversión desde/hacia el string decimal del contrato (§2.2) |
| 2 | ¿El dominio produce eventos completos? | No: produce **borradores** (`type` + `payload`); el sobre (`eventId`, `occurredAt`…) lo pone `buildEvent` en la capa de aplicación (§2.1) |

---

## 1 · Alcance

### Entra

- Estado del lote y de la subasta, y las funciones puras que aplican las 5 reglas de negocio:
  1. puja válida (supera el precio actual más el incremento mínimo);
  2. desempate determinista (mayor monto, luego la más antigua, luego `id`);
  3. anti-sniping (extiende el cierre N minutos);
  4. cierre y adjudicación al mejor postor;
  5. un lote nunca se adjudica dos veces.
- Funciones del patrón *decider*: `decideBid`, `decideCloseLot`, `decideCloseAuction`, y `evolveLot`/`evolveAuction` (aplicar un evento al estado).
- Aritmética de dinero exacta (`Money` en centavos).
- Tests unitarios por regla, sin infraestructura.

### No entra (a propósito)

- Persistencia, Kafka, HTTP (A3, B2, C3, D*).
- Quién dispara el cierre al llegar `closesAt` (Q3 → D8): aquí `decideCloseLot` recibe la hora como argumento.
- Autoridad de la puja (Q2): estas funciones son la **regla**; dónde se invocan (API o decisor en el consumidor) se decide en C3.
- `DUPLICATE_BID` y `LOT_NOT_FOUND`: son de aplicación (idempotencia, repositorio), no de la regla.
- Valores de configuración de anti-sniping (Q7): entran como parámetro.

### Premisas verificadas (heredadas de `task-brief`)

| Premisa del ticket | Qué hay de verdad |
|---|---|
| "Funciones puras que validan una puja… sin imports de Prisma, Kafka ni HTTP" | `packages/domain` tiene solo el contrato de eventos (A2); ESLint ya prohíbe imports de infraestructura |
| Reglas en `business-rules.md` | Existen (#1–#7). #1 deja ambiguo si la **primera** puja debe superar `startingPrice` o igualarlo |
| Tipos de evento | Ya existen `DomainEvent`, `PayloadOf<T>` y `BID_REJECTION_REASONS` (A2) |

---

## 2 · Diseño técnico

### 2.1 Patrón decider / evolve

```ts
decideBid(state, bid, config)   -> EventDraft[]      // [BidPlaced] | [BidPlaced, LotExtended] | [BidRejected]
decideCloseLot(state, now)      -> EventDraft[]      // [] | [LotClosed]
decideCloseAuction(state)       -> EventDraft[]      // [] | [AuctionClosed]
evolveLot(state, event)         -> LotState          // aplica un evento ya ocurrido
evolveAuction(state, event)     -> AuctionState
```

`EventDraft` = `{ type, payload }` por tipo (derivado de `PayloadOf<T>`). Es la unión de los eventos del contrato **sin** el sobre.

**Por qué así:** (a) las decisiones son funciones puras sobre un estado; (b) el mismo `evolve` sirve al `projector` para reconstruir el estado desde el log y a las pruebas de reproceso (G2): una sola definición de qué significa cada evento; (c) el dominio no necesita reloj, ids ni tenant: la capa de aplicación los añade con `buildEvent`.

### 2.2 Dinero

`Money` = `bigint` de centavos. `parseMoney('105.50') -> 10550n`, `formatMoney(10550n) -> '105.50'` (siempre dos decimales; el contrato acepta 1 o 2, la salida normaliza a 2). Suma y comparación con operadores nativos de `bigint`. Nunca `number`.

### 2.3 Estado

```ts
LotState = {
  lotId, auctionId, currency,
  startingPrice: Money, minIncrement: Money,
  closesAt: Date,
  status: 'open' | 'closed',
  currentPrice: Money | null,        // mejor puja vigente
  currentBidderId: string | null,
  winnerId: string | null,           // solo cuando está cerrado con adjudicación
  finalAmount: Money | null,
}
AuctionState = { auctionId, status: 'open' | 'closed', openLotIds: ReadonlySet<string> }
```

El estado inicial del lote sale de `LotPublished` (`evolveLot(undefined, LotPublished)`), igual que en la proyección.

### 2.4 Decisiones y por qué

| Decisión | Elección | Por qué |
|---|---|---|
| Puja válida (regla 1) | Sin pujas previas: `amount >= startingPrice`. Con pujas: `amount >= currentPrice + minIncrement` | La spec dice "supera el precio actual más el incremento" y `business-rules` #1 que sin pujas "parte de `startingPrice`". **Interpretación a confirmar** (§7 #1) |
| Desempate (regla 2) | Comparador `compareBids(a, b)`: mayor monto, luego menor `placedAt`, luego menor `id`. En `decideBid` el orden de llegada ya lo impone la partición (ADR-0001), y un monto igual al vigente es siempre `BID_TOO_LOW` | Es el mismo orden que el índice `(lotId, amount DESC, placedAt, id)` de la spec §6; lo reutiliza el `projector` para el ranking |
| Anti-sniping (regla 3) | Si `closesAt - placedAt <= windowMs` (y la puja es válida), se emite también `LotExtended` con `newClosesAt = closesAt + extensionMs` | La spec dice "se extiende N minutos". Extender desde `closesAt` (no desde `placedAt`) hace el cierre predecible. A confirmar (§7 #2) |
| Config | `{ antiSnipingWindowMs, antiSnipingExtensionMs }` como parámetro, sin valores por defecto | Los valores son decisión de negocio (Q7) |
| Puja tardía | `placedAt >= closesAt` o lote cerrado → `BidRejected(LOT_CLOSED)` | Un lote cerrado no acepta pujas |
| Cierre (regla 4) | `decideCloseLot(state, now)`: si abierto y `now >= closesAt` → `LotClosed` con `currentBidderId`/`currentPrice`; sin pujas → `winnerId: null, finalAmount: null` (DEC-006) | Adjudica al mejor postor; contempla lote desierto |
| Adjudicación única (regla 5) | Sobre un lote ya cerrado, `decideCloseLot` devuelve `[]` (idempotente) y `decideBid` rechaza | Garantía en el dominio; el índice único parcial de B1 es la segunda barrera en la base |
| Cierre anticipado | `decideCloseLot` con `now < closesAt` devuelve `[]` | Un cierre antes de hora no existe |
| Cierre de subasta | `decideCloseAuction` solo emite `AuctionClosed` si está abierta y no queda ningún lote abierto | La spec no define la regla; esta es la mínima coherente. A confirmar (§7 #3) |
| `LOT_NOT_OPEN` | No lo produce A1 | Depende de si la subasta ya abrió (`opensAt`), dato de la subasta; se decide en C3 |
| Errores | Las decisiones **no lanzan** por reglas de negocio: devuelven eventos (incluido `BidRejected`) | El rechazo también es un hecho del log (spec §3) |

---

## 3 · Cambios por archivo/módulo

| Archivo/módulo | Cambio |
|---|---|
| `packages/domain/src/money.ts` | `Money`, `parseMoney`, `formatMoney` |
| `packages/domain/src/lot/state.ts` | `LotState` y `evolveLot` |
| `packages/domain/src/lot/decide-bid.ts` | `decideBid` (reglas 1, 2 y 3) y `compareBids` |
| `packages/domain/src/lot/decide-close.ts` | `decideCloseLot` (reglas 4 y 5) |
| `packages/domain/src/auction/state.ts`, `decide-close.ts` | `AuctionState`, `evolveAuction`, `decideCloseAuction` |
| `packages/domain/src/draft.ts` | Tipo `EventDraft` derivado de A2 |
| `packages/domain/src/**/*.test.ts` | Tests de §4 |
| `packages/domain/src/index.ts` | Reexporta; **retira** el marcador `DOMAIN_PACKAGE` (y su test) |
| `docs/product/business-rules.md` | Aclarar #1 (primera puja) y #3 (extensión desde `closesAt`) tras la confirmación |

---

## 4 · Plan de tests

| Caso | Nivel | Cubre |
|---|---|---|
| Primera puja `== startingPrice` válida; menor, rechazada `BID_TOO_LOW` | unit | Regla 1 |
| Puja `== currentPrice + minIncrement` válida; un centavo menos, rechazada | unit | Regla 1 (frontera) |
| Puja igual al precio vigente → `BID_TOO_LOW` | unit | Regla 2 (a igual monto gana la primera) |
| `compareBids`: mayor monto; mismo monto → más antigua; mismo instante → menor id | unit | Desempate determinista |
| Puja dentro de la ventana → `[BidPlaced, LotExtended]` con `closesAt + extensión`; fuera → solo `BidPlaced`; justo en el borde de la ventana | unit | Regla 3 |
| Puja rechazada no extiende el cierre | unit | Regla 3 |
| Puja con `placedAt >= closesAt` o lote cerrado → `LOT_CLOSED` | unit | Cierre |
| `decideCloseLot` adjudica al `currentBidderId` con `currentPrice` | unit | Regla 4 |
| Lote sin pujas se cierra con `winnerId`/`finalAmount` nulos | unit | Regla 4 (desierto) |
| `decideCloseLot` antes de `closesAt` → `[]`; sobre lote cerrado → `[]` | unit | Regla 5 |
| Tras cerrar, `decideBid` rechaza y un segundo cierre no emite nada | unit | Regla 5 (no hay doble adjudicación) |
| `evolveLot` sobre la secuencia `LotPublished, BidPlaced, LotExtended, LotClosed` deja el estado esperado | unit | `evolve` |
| Reproducibilidad: plegar el mismo log dos veces da el mismo estado | unit | Base del reproceso (G2) |
| `parseMoney`/`formatMoney`: `'0.1'+'0.2'` suma `0.30` exacto; ida y vuelta; rechaza `number` | unit | Dinero sin flotantes |
| `decideCloseAuction` solo con todos los lotes cerrados | unit | Cierre de subasta |
| Propiedad: para cualquier secuencia de pujas válidas el precio actual solo crece | unit (propiedad) | Invariante |

**Deliberadamente sin test:** la integración con Kafka y la base (llega con G1/G2); el comportamiento de `Date` en zonas horarias (todo va en UTC por contrato).

---

## 5 · Definition of Done

- [ ] SDD en `docs/sdd/A1/SDD.md`, Estado = Aprobado
- [ ] Las 5 reglas implementadas como funciones puras, cada una con sus tests
- [ ] Ningún `number` representa dinero en el dominio
- [ ] `packages/domain` sin imports de infraestructura (ESLint)
- [ ] `business-rules.md` aclarado según §7 #1 y #2
- [ ] Tests del §4 en verde; `npm run check` en verde
- [ ] Commit con conventional commits

---

## 6 · Riesgos

| Riesgo | Gravedad | Mitigación |
|---|---|---|
| Ambigüedad de la regla 1 (primera puja) cambia el comportamiento visible | Media | Pregunta §7 #1 antes de implementar |
| `evolve` y `decide` se desalinean y el reproceso reconstruye un estado distinto | Alta | Test de reproducibilidad y de secuencia completa; G2 lo repite con la base |
| Anti-sniping con ventanas grandes encadena extensiones indefinidas | Media | Es el comportamiento esperado de la regla; un tope de extensiones se puede añadir con un ADR si se pide (Q7) |
| `bigint` no se serializa a JSON | Baja | `Money` nunca sale del dominio; el contrato usa el string decimal |

---

## 7 · Preguntas abiertas

1. **Primera puja:** ¿debe ser `>= startingPrice` (propuesta) o `>= startingPrice + minIncrement`?
2. **Anti-sniping:** ¿la extensión se cuenta desde `closesAt` (propuesta) o desde el instante de la puja? ¿Y la ventana incluye el borde (`<=`)?
3. **Cierre de subasta:** ¿`AuctionClosed` solo cuando no quedan lotes abiertos (propuesta)? Quien lo dispara se define en D8 (Q3).
4. ¿Puede un postor subir su propia puja vigente? La spec no lo prohíbe; propuesta: sí se permite.
