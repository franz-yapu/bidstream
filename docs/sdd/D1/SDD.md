# SDD — D1 · Relay de outbox → Kafka

- **Ticket:** ClickUp **D1** (`868mvtxzz`, https://app.clickup.com/t/868mvtxzz).
- **Autor:** generado con Claude (Entregable 1).
- **Estado:** Implementado (2026-11-12) — aprobado el mismo día
- **Versión:** 1.0 · **Fecha:** 2026-11-12
- **Fuentes de verdad citadas:**
  1. `docs/product/bidstream_spec.md` §5 (patrón outbox: "la API nunca escribe en la base y publica en Kafka como dos operaciones separadas"; un relay publica después), §4 (clave `lotId`), §9 (Container Apps: el relay es un proceso propio)
  2. `docs/adr/0001-clave-de-particion-lotid.md` (orden estricto por lote)
  3. `docs/sdd/B1/SDD.md` §2.5 (índice parcial `outbox_message_pending_idx`), `docs/sdd/B2/SDD.md` §7 #3 (las consultas de pendientes viven en `@bidstream/db`)
  4. `docs/sdd/D2/SDD.md` (productor idempotente, `acks=all`), `docs/sdd/D3/SDD.md` (consumidores idempotentes: el relay puede duplicar)
  5. `docs/do-not-touch.md` — patrón outbox

---

## 0 · Preguntas que el ticket pidió cerrar

| # | Pregunta del ticket | Respuesta |
|---|---|---|
| 1 | "Varios relays en paralelo sin duplicar trabajo" | **No con `SKIP LOCKED` solo**: rompería el orden por lote (§2.2). Un relay activo a la vez, elegido con un bloqueo asesor de PostgreSQL |

---

## 1 · Alcance

### Entra

- Proceso `apps/relay` (`@bidstream/relay`): lee las filas pendientes de `outbox_message`, las publica en Kafka con la clave guardada y las marca como publicadas.
- En `@bidstream/db`: `claimPending(limit)` (`FOR UPDATE SKIP LOCKED`) y `markPublished(ids)` junto a `enqueue`.
- Un único relay activo, con liderazgo por **bloqueo asesor** (`pg_try_advisory_lock`) y *standby* para los demás.
- Orden garantizado por clave, **al menos una vez**, reintentos con backoff ante fallos de Kafka, apagado ordenado.
- Pruebas de integración con PostgreSQL y Kafka reales.

### No entra (a propósito)

- Escalado horizontal del relay por *sharding* de claves (queda como evolución; ver §7 #1).
- Limpieza de filas ya publicadas (retención del outbox): tarea posterior; se documenta el crecimiento.
- Métricas y consumer lag (H4); aquí solo registros estructurados y un gancho `onBatch`.
- Despliegue, imagen y escalado → H2/H3.

### Premisas verificadas (heredadas de `task-brief`)

| Premisa del ticket | Qué hay de verdad |
|---|---|
| "Lee `OutboxMessage` pendientes con `FOR UPDATE SKIP LOCKED`" | `PrismaOutbox` solo tiene `enqueue`; el índice parcial de pendientes existe. Prisma no expresa `FOR UPDATE SKIP LOCKED`: hay que usar `$queryRaw` |
| "Publica con la clave guardada" | `key = partitionKey(event)` ya viene escrito por `enqueue`; `payload` es el evento completo; `row.id` es el `eventId` |
| Productor | `createProducer(config).publish(topic, { key, value, headers })` existe (idempotente, `acks=all`) |
| `created_at` como orden | Es `CURRENT_TIMESTAMP` de PostgreSQL, que es el instante de **inicio de la transacción**, no el del *commit*: dos comandos concurrentes pueden confirmarse en orden distinto al de su `created_at` |
| Eventos de una misma transacción | Comparten `created_at`; `id = eventId` (UUID v7 generado en orden) los desempata |

---

## 2 · Diseño técnico

### 2.1 Ciclo del relay

```
loop (mientras sea el líder):
  transacción:
    filas = SELECT * FROM outbox_message WHERE published_at IS NULL
            ORDER BY created_at, id LIMIT :batch FOR UPDATE SKIP LOCKED
    por cada fila, EN ORDEN:
        producer.publish(row.topic, { key: row.key, value: JSON(row.payload),
                                      headers: { eventId: row.id, type, version } })
        (si falla: se detiene aquí, no se salta ninguna)
    UPDATE outbox_message SET published_at = now() WHERE id IN (las publicadas con éxito)
  commit
  si no había filas → dormir `pollIntervalMs`; si hubo fallo de Kafka → backoff y reintentar
```

Publicar **dentro** de la transacción mantiene bloqueadas las filas hasta marcarlas: si el proceso muere tras publicar y antes del *commit*, esas filas se vuelven a publicar (**al menos una vez**); los consumidores lo absorben con `ProcessedEvent` (D3).

### 2.2 El orden: por qué un solo relay

El orden por lote (ADR-0001) debe conservarse desde el outbox hasta Kafka. Con varios relays y `SKIP LOCKED`, un relay puede publicar `e2` de un lote mientras otro aún tiene `e1` de ese lote en su lote de trabajo, y `e2` llegaría antes. **Decisión:** un solo relay activo a la vez. El liderazgo lo da `pg_try_advisory_lock(<constante>)` sobre una conexión `pg` dedicada y sostenida (el bloqueo es de sesión y se libera solo si el proceso cae). Los demás procesos quedan en *standby* y reintentan cada pocos segundos: se obtiene alta disponibilidad (conmutación) sin perder el orden. `SKIP LOCKED` se conserva como red de seguridad durante un cambio de líder.

Un relay secuencial publica a miles de mensajes por segundo; el outbox no es el cuello de botella de este proyecto. Escalar mediante *sharding* por `hash(key)` queda como evolución con su ADR.

### 2.3 El orden en el origen (condición para C3)

El relay respeta el orden de `(created_at, id)`, pero `created_at` es el inicio de la transacción. Para que el orden de publicación coincida con el orden de decisión de las pujas, **los comandos de un mismo lote deben serializarse al escribirse** (p. ej. `SELECT … FROM lot WHERE id = $1 FOR UPDATE` al inicio de la transacción de la puja). No lo resuelve D1: es un **requisito para C3 y para la decisión Q2**, y queda registrado aquí para que no se pierda.

### 2.4 Decisiones y por qué

| Decisión | Elección | Por qué |
|---|---|---|
| Ubicación del SQL | `PrismaOutbox.claimPending` / `markPublished` con `$queryRaw` en `@bidstream/db` | Aprobado en B2 §7 #3: el SQL de la tabla vive en un solo sitio |
| Lote | 100 filas, sondeo cada 200 ms (configurables) | Latencia baja sin sondear en bucle apretado |
| Fallo parcial | Se marcan las publicadas y se hace *commit*; se reintenta desde la primera no publicada | Nunca se salta una fila (orden) ni se re-publica de más |
| Backoff ante Kafka caído | Exponencial con tope (1 s → 30 s) y jitter; se registra en nivel `error` | No saturar y no ocultar el problema |
| Cabeceras | `eventId = row.id`, `type` y `version` leídos del payload | Igual que `publishEvent`: enrutamiento y diagnóstico sin parsear el valor |
| Liderazgo | Conexión `pg` dedicada, no el *pool* de Prisma | Un bloqueo de sesión sobre un pool se perdería al reciclarse la conexión |
| Apagado | `SIGTERM`: termina el lote en curso, marca lo publicado, suelta el liderazgo y desconecta | No dejar filas publicadas sin marcar |
| Proceso | `apps/relay` con `main.ts` mínimo y una clase `OutboxRelay` probada por separado | Lo importante es testeable sin arrancar un proceso |

---

## 3 · Cambios por archivo/módulo

| Archivo/módulo | Cambio |
|---|---|
| `packages/db/src/repositories/outbox.ts` | `claimPending(limit)` y `markPublished(ids)` |
| `apps/relay/src/relay.ts` | `OutboxRelay`: `runOnce()`, `run()` (bucle), liderazgo, backoff, apagado |
| `apps/relay/src/leader.ts` | Bloqueo asesor sobre conexión `pg` dedicada |
| `apps/relay/src/config.ts`, `main.ts` | Entorno (`DATABASE_URL`, `KAFKA_*`, `RELAY_BATCH_SIZE`, `RELAY_POLL_MS`), composición y señales |
| `apps/relay/package.json`, `tsconfig*.json` | Nuevo `@bidstream/relay` |
| `tsconfig.json` (raíz), `package.json` | Referencia y `dev:relay` |
| `.env.example`, `README.md`, `CLAUDE.md` | Variables y cómo arrancarlo |
| `docs/product/bidstream_spec.md` | Sin cambio (la nota de un solo relay se documenta en el README, sección de decisiones) |

---

## 4 · Plan de tests

| Caso | Nivel | Cubre |
|---|---|---|
| Filas pendientes de varios lotes entrelazados → todas publicadas; cada una con su `key`, cabeceras y valor; `published_at` marcado | integración (PostgreSQL + Kafka) | Camino feliz |
| Para cada lote, el orden de llegada a Kafka coincide con el orden de `(created_at, id)` | integración | Orden por clave (ADR-0001) |
| Una fila ya publicada no se vuelve a publicar en la siguiente ronda | integración | Marcado |
| Fallo del productor en el mensaje *n*: las anteriores quedan publicadas y marcadas, la *n* y siguientes siguen pendientes; la siguiente ronda continúa **desde la *n*** y el orden final es el correcto | integración (productor falso inyectado) | Fallo parcial sin saltos |
| Si falla el marcado tras publicar, las filas se vuelven a publicar (duplicado en Kafka) y quedan marcadas al reintentar | integración | Al menos una vez |
| Dos relays sobre la misma base: solo uno obtiene el liderazgo; al cerrar el líder, el otro lo adquiere | integración | Liderazgo / alta disponibilidad |
| `claimPending` bloquea las filas: otra transacción con `SKIP LOCKED` no las ve hasta el *commit* | integración | `SKIP LOCKED` |
| Backoff ante errores repetidos: crece y respeta el tope (con `sleep` y `random` inyectados) | unit | Reintentos |
| Apagado con `stop()`: termina el lote en curso, marca lo publicado y suelta el liderazgo | integración | Apagado ordenado |
| Con el outbox vacío no publica nada y duerme `pollIntervalMs` | unit | Reposo |
| Un evento escrito con `PrismaOutbox.enqueue` y publicado por el relay lo lee `createEventConsumer` (D3) sin cambios | integración | Contrato extremo a extremo con D3 |

**Deliberadamente sin test:** caída real del proceso entre publicar y confirmar (se simula con el fallo de marcado); rendimiento bajo carga.

---

## 5 · Definition of Done

- [x] SDD en `docs/sdd/D1/SDD.md`, Estado = Aprobado
- [x] El relay publica en orden por clave, al menos una vez, y marca lo publicado
- [x] Un solo relay activo (bloqueo asesor) y conmutación probada
- [x] Sin saltos de filas ante fallos parciales
- [x] Requisito de serialización de comandos por lote registrado para C3 (§2.3)
- [x] Tests del §4 en verde; `npm run check` y `npm run test:integration` en verde
- [x] PR con CI verde y fusionado

---

## 6 · Riesgos

| Riesgo | Gravedad | Mitigación |
|---|---|---|
| `created_at` (inicio de transacción) ≠ orden de *commit*: una fila con `created_at` anterior puede aparecer **después** de que se publicara una posterior | Alta | Serializar los comandos del mismo lote al escribir (§2.3, requisito de C3/Q2); el relay documenta y registra la limitación |
| Duplicados en Kafka por caída entre publicar y confirmar | Media | Esperado en "al menos una vez"; consumidores idempotentes (D3) |
| El outbox crece indefinidamente | Media | Limpieza posterior (retención) y vigilancia del tamaño; el índice parcial mantiene rápido el sondeo |
| Un topic inexistente o un mensaje que Kafka rechaza bloquea la cola (no se salta por orden) | Media | Backoff, registro de nivel `error` y alerta (H4); el mensaje queda pendiente y visible |
| El relay único es un punto de fallo | Media | Standby con conmutación por bloqueo asesor; reinicio por Container Apps |
| Publicar dentro de la transacción mantiene bloqueos mientras Kafka responde | Baja | Lotes pequeños y tiempos de espera acotados |

---

## 7 · Preguntas abiertas

1. **Un relay activo + standby (propuesta)** frente a varios relays por *sharding* de claves. Lo primero garantiza el orden con poco código; lo segundo escala más y exige más piezas. ¿Aceptas lo primero y dejar el *sharding* como evolución?
2. **Parámetros:** lote de 100 y sondeo cada 200 ms (configurables). ¿De acuerdo? (Sondeo en vez de `LISTEN/NOTIFY`: más simple; se puede cambiar sin tocar el contrato.)
3. **Retención del outbox:** ¿dejamos la limpieza de filas publicadas para un ticket posterior (propuesta) o la incluimos aquí con un parámetro de antigüedad?
4. **Requisito para C3:** ¿confirmas que los comandos de un mismo lote deben serializarse al escribir (`SELECT … FOR UPDATE` sobre el lote), para que el orden del outbox sea el de decisión? Se aborda con Q2.

---

## Changelog de implementación

- **Implementado (2026-11-12)** con las propuestas aprobadas de §7: un relay activo con bloqueo asesor y standby, lote de 100 y sondeo cada 200 ms (configurables con `RELAY_BATCH_SIZE`, `RELAY_POLL_MS`, `RELAY_STANDBY_POLL_MS`), limpieza del outbox en un ticket posterior, y el requisito de serializar los comandos de un mismo lote al escribir queda para C3/Q2.
- `PrismaOutbox.claimPending(limit)` (`FOR UPDATE SKIP LOCKED`, orden `(created_at, id)`) y `markPublished(ids)` en `@bidstream/db`; `DbClient` incluye ahora `$queryRaw`.
- `apps/relay`: `OutboxRelay` (`runOnce`, `start`, `stop`), liderazgo en `leader.ts` sobre una conexión `pg` **dedicada** (el bloqueo es de sesión), backoff con «jitter igual» (mitad fija, mitad aleatoria; 1 s → 30 s) y `main.ts` con logs JSON estructurados. El relay no es HTTP: no hay `GET /health`; la señal de vida es el log y el liderazgo.
- `runOnce` devuelve solo lo **confirmado** (publicado y marcado). Si falla la base de datos al marcar, la transacción se revierte y lo publicado se vuelve a publicar: probado como «al menos una vez» (8 envíos para 4 mensajes, 4 distintos).
- 16 pruebas nuevas: 4 unitarias de backoff y 12 de integración con PostgreSQL y Kafka reales, estables en tres ejecuciones seguidas: publicación con clave y cabeceras, orden por lote con tres lotes entrelazados en tres particiones, no republicar, outbox vacío, fallo parcial sin saltos, fallo al marcar, backoff creciente, `SKIP LOCKED`, liderazgo exclusivo y conmutación entre dos relays, apagado ordenado y el contrato con `createEventConsumer` (D3).
- Comprobado a mano con el proceso real: arranca, toma el liderazgo y se apaga con SIGTERM liberándolo.
