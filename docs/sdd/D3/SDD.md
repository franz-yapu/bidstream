# SDD — D3 · Consumidor base: idempotencia, reintentos y DLQ

- **Ticket:** ClickUp **D3** (`868mvty09`, https://app.clickup.com/t/868mvty09).
- **Autor:** generado con Claude (Entregable 1).
- **Estado:** Borrador
- **Versión:** 1.0 · **Fecha:** 2026-11-12
- **Fuentes de verdad citadas:**
  1. `docs/product/bidstream_spec.md` §5 (idempotencia por `eventId` con clave única; "Kafka garantiza al menos una vez"; tres reintentos con backoff exponencial, al cuarto fallo al dead-letter topic con el error adjunto y reproceso administrativo), §4 (grupos `projector`/`notifier`/`auditor`)
  2. `docs/sdd/D2/SDD.md` (consumidor con commit manual; `consumer.stop()` no implementado), `docs/sdd/B1/SDD.md` (`ProcessedEvent` con clave `(event_id, consumer)`)
  3. `docs/sdd/A2/SDD.md` (`parseEvent`), `docs/adr/0001-clave-de-particion-lotid.md`
  4. `docs/do-not-touch.md` — contrato de eventos; log como fuente de verdad

---

## 0 · Preguntas que el ticket pidió cerrar

| # | Pregunta del ticket | Respuesta |
|---|---|---|
| 1 | ¿Dónde se registra el evento procesado respecto al handler? | **En la misma transacción** que los efectos del handler en la base (§2.2) |
| 2 | ¿Qué cuenta como "tres reintentos"? | 1 intento inicial + 3 reintentos = **4 intentos**; al cuarto fallo, DLQ (§2.3) |

---

## 1 · Alcance

### Entra

- Paquete `packages/consumer` (`@bidstream/consumer`) con `createEventConsumer(...)`: la mecánica común de `projector`, `notifier` y `auditor`.
- Validación del mensaje con `parseEvent`.
- **Idempotencia** por `(eventId, consumer)` con la tabla `ProcessedEvent`, en la misma transacción que el handler.
- **Reintentos** (3, backoff exponencial con jitter) y **DLQ** en `bidstream.events.lot.dlq` con el error adjunto.
- Esquema del mensaje DLQ (Zod) exportado, para que lo lea el endpoint de reproceso (D7).
- Pruebas de integración contra PostgreSQL y Kafka reales.

### No entra (a propósito)

- La lógica de cada consumidor (D4 `projector`, D5 `notifier`, D6 `auditor`).
- El endpoint que reprocesa el DLQ (D7).
- Verificación de la firma de eventos (F3, bloqueado por Q5): el punto de enganche queda previsto (§2.5).
- Métricas y consumer lag (H4).

### Premisas verificadas (heredadas de `task-brief`)

| Premisa del ticket | Qué hay de verdad |
|---|---|
| "Consumidor base reutilizable" | Existe `createConsumer` (D2) con commit manual: confirma el offset solo si el handler resuelve; no valida, no reintenta, no tiene DLQ |
| "Comprueba `ProcessedEvent (eventId, consumer)`" | La tabla existe (B1) con clave primaria `(event_id, consumer)`; **no** existe todavía código que la use |
| "Publica en `bidstream.events.lot.dlq`" | El topic existe (`TOPICS.eventsLotDlq`, 1 partición, 30 días); `createProducer` publica a cualquier topic con `publish` |
| Un fallo dentro de una transacción de PostgreSQL | Un `INSERT` que viola una clave única **aborta** la transacción en curso: la comprobación de duplicados debe usar `ON CONFLICT DO NOTHING`, no capturar el error |

---

## 2 · Diseño técnico

### 2.1 Flujo por mensaje

```
mensaje de Kafka
  │
  ├─ ¿JSON y contrato válidos (parseEvent)? ── no ──▶ DLQ inmediato (veneno, sin reintentos)
  │
  ▼ sí
  intento n (1..4):
    transacción:
      INSERT ProcessedEvent (eventId, consumer) ON CONFLICT DO NOTHING
        ├─ 0 filas → ya procesado ─▶ commit; fin (duplicado ignorado)
        └─ 1 fila  → handler(event, { tx, message })
    ├─ éxito → commit de la transacción → commit del offset; fin
    └─ fallo → rollback (el registro de ProcessedEvent también) → espera backoff(n) → siguiente intento
  tras el cuarto fallo:
    publicar en DLQ (evento original, error, consumidor, intentos, origen) → commit del offset
    si la publicación en DLQ falla → NO se confirma el offset (se vuelve a entregar): nunca se pierde un evento
```

### 2.2 Idempotencia

Registrar el evento **dentro de la misma transacción** que los efectos del handler (por ejemplo, las escrituras del `projector`) hace atómicos "procesar" y "recordar que se procesó": si el handler falla, el registro se revierte y el reintento es seguro; si el proceso muere tras el commit pero antes de confirmar el offset, la reentrega encuentra el registro y se ignora. La clave es `(eventId, consumer)`: cada grupo procesa cada evento una vez, de forma independiente.

### 2.3 Reintentos y backoff

Parámetros (configurables, con estos valores por defecto): `maxRetries = 3`, `baseDelayMs = 200`, factor 2, tope 5 000 ms y jitter completo (`delay = random(0, min(cap, base·2^(n-1)))`). Función pura `backoffDelay(retry, policy, random)` para probarla sin esperar. En pruebas se inyectan `sleep` y `random`.

### 2.4 Mensaje DLQ

```ts
{
  original: string,          // valor original sin tocar (se puede republicar tal cual)
  key: string | null,
  error: { name: string, message: string },   // sin traza
  consumer: string,
  attempts: number,          // 1 si es veneno (sin reintentos), 4 si agotó reintentos
  source: { topic: string, partition: number, offset: string },
  failedAt: string           // ISO-8601 UTC
}
```

Clave del mensaje DLQ = la clave original (`lotId`/`auctionId`). Cabeceras: `eventId` (si se pudo leer), `consumer`, `reason` (`poison` | `retries-exhausted`). Se exporta `dlqMessageSchema` (Zod) para D7.

### 2.5 Decisiones y por qué

| Decisión | Elección | Por qué |
|---|---|---|
| Paquete propio | `packages/consumer`, dependiendo de `@bidstream/kafka`, `@bidstream/db` y `@bidstream/domain` | Los dos primeros no deben conocerse entre sí; este es el único punto que une Kafka y la base |
| Duplicado | `createMany({ skipDuplicates: true })` y comprobar el recuento | Sin errores dentro de la transacción (ver premisas) |
| Evento veneno | Va al DLQ sin reintentar | Reintentar un JSON o contrato inválido nunca va a funcionar |
| Reintentos en línea | El consumidor reintenta sin soltar la partición | Mantiene el orden por lote (ADR-0001) mientras reintenta |
| Mensaje en DLQ: `original` como string | Sin reserializar | Se puede republicar idéntico; no se altera el log |
| Contexto del handler | `(event, { tx, message })`; los consumidores sin base (`notifier`) ignoran `tx` | Un solo contrato para los tres consumidores |
| Firma de eventos (F3) | Función opcional `verify(message, event)` ejecutada antes del handler; si falla, es veneno | Punto de enganche sin comprometer el diseño de F3 |
| Tiempo máximo de transacción | Configurable (5 s por defecto) | Un handler colgado no retiene conexiones |

---

## 3 · Cambios por archivo/módulo

| Archivo/módulo | Cambio |
|---|---|
| `packages/consumer/**` | Nuevo `@bidstream/consumer` |
| `packages/consumer/src/backoff.ts` | `backoffDelay` y `RetryPolicy` |
| `packages/consumer/src/dlq.ts` | `dlqMessageSchema`, `buildDlqMessage` |
| `packages/consumer/src/event-consumer.ts` | `createEventConsumer`: flujo de §2.1 |
| `packages/consumer/src/index.ts` | API pública |
| `packages/consumer/src/*.test.ts`, `*.int.test.ts` | Pruebas de §4 |
| `tsconfig.json` (raíz), `package.json` | Referencia al paquete |
| `README.md`, `CLAUDE.md` | Cómo escribir un consumidor |

---

## 4 · Plan de tests

| Caso | Nivel | Cubre |
|---|---|---|
| `backoffDelay`: crece por potencias de 2, respeta el tope y con jitter queda en `[0, max]` | unit | Política de reintentos |
| `buildDlqMessage` cumple `dlqMessageSchema` y no incluye traza | unit | Formato DLQ |
| Un evento entregado dos veces ejecuta el handler **una vez** (el segundo intento se ignora) | integración (PostgreSQL + Kafka) | Idempotencia |
| Dos consumidores distintos procesan **cada uno** el mismo evento | integración | Clave `(eventId, consumer)` |
| Handler que falla 2 veces y luego funciona: se ejecuta 3 veces, queda un solo `ProcessedEvent`, no hay mensaje en DLQ | integración | Reintentos con rollback |
| Handler que siempre falla: 4 intentos, mensaje en DLQ con el error y los datos de origen, no queda `ProcessedEvent`, el offset avanza y el siguiente mensaje se procesa | integración | DLQ y continuidad |
| Un efecto escrito por el handler en la transacción se revierte cuando el handler falla después | integración | Atomicidad |
| Mensaje con JSON inválido o contrato inválido: DLQ con `attempts = 1` y `reason = poison`, sin reintentos | integración | Eventos veneno |
| Si publicar en el DLQ falla, el offset no se confirma y el mensaje se vuelve a entregar | integración | No se pierden eventos |
| Los eventos de un mismo lote se procesan en orden aun con reintentos en medio | integración | Orden (ADR-0001) |

**Deliberadamente sin test:** latencias reales de backoff (se inyecta `sleep`); rendimiento.

---

## 5 · Definition of Done

- [ ] SDD en `docs/sdd/D3/SDD.md`, Estado = Aprobado
- [ ] `createEventConsumer` implementa el flujo de §2.1, reutilizable por los tres consumidores
- [ ] Idempotencia en la misma transacción que el handler
- [ ] DLQ con el error adjunto y `dlqMessageSchema` exportado
- [ ] Tests del §4 en verde; `npm run check` y `npm run test:integration` en verde
- [ ] PR con CI verde y fusionado

---

## 6 · Riesgos

| Riesgo | Gravedad | Mitigación |
|---|---|---|
| **Un evento fallido va al DLQ y los siguientes del mismo lote se siguen procesando**: el estado del `projector` puede quedar incoherente (p. ej. se aplica un `LotClosed` sin el `BidPlaced` previo) | Alta | Es el comportamiento que pide la spec. Se mitiga con el reproceso desde el DLQ (D7) y con la reconstrucción completa desde el log (G2); el `evolve` del dominio es tolerante a eventos fuera de orden donde es posible |
| El reintento en línea bloquea la partición durante el backoff (hasta ~1 s con los valores por defecto) | Media | Ventana corta y acotada; un fallo persistente se aparta al DLQ |
| Transacciones largas por handlers lentos | Media | Tiempo máximo configurable; handlers que hagan trabajo no transaccional deben hacerlo fuera |
| Duplicados entre el commit de la transacción y el del offset | Baja | Es el caso para el que existe `ProcessedEvent`; probado |
| Un DLQ de 1 partición no escala | Baja | Es volumen de excepciones, no de tráfico; 1 partición está en la spec |

---

## 7 · Preguntas abiertas

1. **Reintentos:** ¿4 intentos totales con backoff de 200 ms, factor 2 y jitter (propuesta)? La spec dice "tres reintentos con backoff exponencial"; los números concretos son decisión nuestra.
2. **Fallo persistente en el `projector`:** ¿seguir la spec y enviar al DLQ continuando con los siguientes eventos (propuesta), o **pausar la partición** hasta que alguien intervenga (más seguro para la coherencia, pero bloquea ese lote y las pujas de los demás lotes de esa partición)?
3. ¿El paquete se llama `@bidstream/consumer` (propuesta) u otro nombre?
4. ¿Hace falta que `createEventConsumer` exponga un gancho de métricas (contadores de éxito/reintento/DLQ) ya, o se deja para H4? Propuesta: gancho de logger ahora, métricas en H4.
