# SDD — D5 · Consumidor `notifier`

- **Ticket:** ClickUp **D5** (`868mvty0f`, https://app.clickup.com/t/868mvty0f).
- **Autor:** generado con Claude (Entregable 1).
- **Estado:** Aprobado (2026-11-12)
- **Versión:** 1.0 · **Fecha:** 2026-11-12
- **Fuentes de verdad citadas:**
  1. `docs/product/bidstream_spec.md` §4 (grupo `notifier`: "publica a las subscriptions de GraphQL"), §7 (`Subscription.lotUpdated(lotId)` "alimentada por el consumidor `notifier`"), §9 (Container Apps: cada proceso con su escalado)
  2. `docs/sdd/D3/SDD.md` (`createEventConsumer`: idempotencia en la misma transacción, reintentos y DLQ), `docs/sdd/A2/SDD.md` (contrato de eventos, `tenantId`)
  3. `docs/product/bidstream_spec.md` §8 A01 (control de acceso: aislamiento por tenant y por propietario)
  4. `docs/product/business-rules.md`; `docs/do-not-touch.md` (log como fuente de verdad)

---

## 0 · Preguntas que el ticket pidió cerrar

| # | Pregunta del ticket | Respuesta |
|---|---|---|
| 1 | ¿Cuál es el canal entre el consumidor y el servidor GraphQL (pub/sub en proceso, Redis o `LISTEN/NOTIFY`)? | **`LISTEN/NOTIFY` de PostgreSQL**, con un único grupo `notifier` (§2.1) |

---

## 1 · Alcance

### Entra

- Paquete `packages/notifier` (`@bidstream/notifier`) con:
  - el **contrato de notificación** `LotNotification` (esquema Zod) y `toLotNotification(event)`;
  - `publishNotification(tx, notification)`: `pg_notify` **dentro** de la transacción del consumidor base;
  - `createNotificationListener(...)`: conexión dedicada que escucha el canal, con reconexión;
  - `InMemoryNotificationBus`: reparto por `(tenantId, lotId)` dentro de un proceso.
- Proceso `apps/notifier`: compone `createEventConsumer` con el grupo `notifier`.
- Pruebas de integración con PostgreSQL y Kafka reales.

### No entra (a propósito)

- El servidor GraphQL y la `Subscription` (E1/E3): consumirán el `InMemoryNotificationBus` que entrega este ticket.
- Autenticación y autorización de los suscriptores → F1.
- Garantías de entrega «exactamente una vez» a los clientes: es *best-effort* (ver §2.4).
- Notificaciones privadas por postor (p. ej. «su puja fue rechazada»): requieren identidad (F1).

### Premisas verificadas (heredadas de `task-brief`)

| Premisa del ticket | Qué hay de verdad |
|---|---|
| "Entrega al mecanismo de publicación de las subscriptions (E3)" | No existe servidor GraphQL todavía; E3 define cómo se sirven las subscriptions. D5 debe dejar un canal y un contrato que E3 pueda usar sin cambios |
| "Grupo propio" | El consumidor base (D3) usa el nombre del consumidor como grupo y registra `ProcessedEvent`; sirve tal cual |
| Réplicas del servidor GraphQL | Azure Container Apps escala por réplicas. **Si cada réplica tuviera su propio consumidor con el mismo grupo**, Kafka repartiría los eventos entre ellas y un suscriptor conectado a la réplica A no vería los que consumió la B |
| Grupos por instancia como alternativa | Cada réplica con un grupo propio recibiría todo, pero **Azure Event Hubs limita el número de grupos de consumidores por Event Hub** (a verificar en H1; ~20 en el nivel Standard): con reinicios y réplicas se agotaría |
| `NOTIFY` | Transaccional: el mensaje se entrega al confirmar la transacción. Carga útil máxima < 8 000 bytes. Cada oyente necesita una conexión **dedicada** (no compatible con un *pooler* en modo transacción) |

---

## 2 · Diseño técnico

### 2.1 Arquitectura del canal

```
Kafka ──▶ notifier (grupo único «notifier», D3) ──▶ pg_notify('lot_updates', json)   [en la transacción]
                                                          │  PostgreSQL
                       ┌──────────────────────────────────┼──────────────────────────────────┐
                       ▼                                  ▼                                  ▼
             réplica GraphQL A                  réplica GraphQL B                  réplica GraphQL C
             LISTEN → InMemoryNotificationBus   LISTEN → …                         LISTEN → …
                       │ subscriptions de sus clientes
```

Un solo consumidor (grupo `notifier`, como pide la spec) convierte eventos en notificaciones y las difunde con `NOTIFY`; **todas** las réplicas del servidor GraphQL las reciben porque cada una escucha el canal. No hace falta infraestructura nueva (PostgreSQL ya existe) ni un grupo de Kafka por instancia.

### 2.2 Contrato de notificación

`LotNotification` se deriva **solo del evento** (no consulta la proyección: el `projector` y el `notifier` son consumidores independientes y la proyección puede ir por detrás):

| Evento | Notificación | Campos |
|---|---|---|
| `LotPublished` | `LotPublished` | `lotId`, `auctionId`, `startingPrice`, `closesAt` |
| `BidPlaced` | `BidPlaced` | `lotId`, `amount` (nuevo precio vigente), `placedAt` |
| `LotExtended` | `LotExtended` | `lotId`, `newClosesAt` |
| `LotClosed` | `LotClosed` | `lotId`, `finalAmount` (`null` si desierto), `hasWinner` |
| `AuctionOpened`, `AuctionClosed` | — (sin notificación de lote) | |
| `BidRejected` | — | (privado del postor) |

Todas llevan `eventId`, `type`, `occurredAt` y `tenantId`. **No** incluyen la identidad del postor (`bidderId`) ni del ganador (`winnerId`): una subasta pública no debe revelar quién puja en tiempo real, y sin autenticación (F1) no hay forma de decidir quién puede verlo. La identidad quedaría para consultas autorizadas.

### 2.3 Decisiones y por qué

| Decisión | Elección | Por qué |
|---|---|---|
| Canal | `LISTEN/NOTIFY` con grupo único | Escala con las réplicas, no consume grupos de Event Hubs, sin infraestructura nueva y transaccional |
| `NOTIFY` dentro de la transacción de D3 | `pg_notify` con el cliente `tx` del handler | Se registra `ProcessedEvent` **si y solo si** se encola la notificación: nada se notifica dos veces por un reintento fallido ni se pierde una que sí se confirmó |
| Reutilizar D3 | `createEventConsumer` con el grupo `notifier` | Reintentos, DLQ e idempotencia gratis; el `notifier` necesita base de datos de todos modos |
| Notificación derivada del evento | Sin lectura de la proyección | Evita la carrera con el `projector` y mantiene los consumidores independientes (spec §4) |
| Sin identidad de postor | `amount` sí, `bidderId` no | Privacidad (OWASP A01); revisable con F1 |
| Bus en proceso | `InMemoryNotificationBus` por `(tenantId, lotId)` | E3 solo suscribe; el reparto síncrono aísla los fallos de cada oyente |
| Oyente | Conexión `pg` dedicada con reconexión y backoff | `LISTEN` es de sesión: si la conexión cae hay que volver a escuchar |
| Tamaño | Si la carga serializada supera 7 500 bytes se rechaza (error visible) | El límite de `NOTIFY` es 8 000; con los campos de §2.2 nunca debería ocurrir |

### 2.4 Garantías

Entrega **best-effort** a los suscriptores: si una réplica pierde la conexión de escucha, las notificaciones del intervalo **no** se recuperan; el cliente debe poder volver a consultar el estado actual por GraphQL (E1). Al reconectar se escribe en el registro y se emite un aviso de «resincronización» al bus para que E3 pueda indicar a los clientes que recarguen. No es un fallo de pérdida de datos: el log y la proyección siguen siendo la fuente de verdad.

---

## 3 · Cambios por archivo/módulo

| Archivo/módulo | Cambio |
|---|---|
| `packages/notifier/**` | Nuevo `@bidstream/notifier`: `notification.ts` (esquema y `toLotNotification`), `publisher.ts` (`pg_notify`), `listener.ts` (conexión dedicada), `bus.ts` (`InMemoryNotificationBus`), `index.ts` |
| `apps/notifier/**` | Nuevo `@bidstream/notifier-app`: `main.ts`, `config.ts`, composición `createNotifier` |
| `tsconfig.json` (raíz), `package.json` | Referencias y `dev:notifier` |
| `.env.example`, `README.md`, `CLAUDE.md` | Variables y cómo arrancarlo |

---

## 4 · Plan de tests

| Caso | Nivel | Cubre |
|---|---|---|
| `toLotNotification` para cada uno de los 7 eventos: los 4 de lote producen la notificación esperada, los 3 restantes `null` | unit | Contrato §2.2 |
| La notificación nunca contiene `bidderId` ni `winnerId` | unit | Privacidad |
| El esquema Zod rechaza campos desconocidos y cabe con holgura en el límite de `NOTIFY` | unit | Contrato y tamaño |
| `InMemoryNotificationBus`: reparte solo a los suscriptores del `(tenantId, lotId)`; el que se da de baja deja de recibir; un oyente que lanza no impide el reparto a los demás | unit | Bus |
| Extremo a extremo: evento → Kafka → `notifier` → `NOTIFY` → oyente → bus, con el evento original intacto | integración (Kafka + PostgreSQL) | Canal completo |
| Dos oyentes (dos «réplicas») reciben **ambos** la misma notificación | integración | Difusión a todas las réplicas |
| Aislamiento por tenant: un suscriptor del tenant A no recibe lotes del tenant B | integración | OWASP A01 |
| `BidRejected`, `AuctionOpened` y `AuctionClosed` no generan notificación, pero se marcan como procesados | integración | Filtrado |
| Si el handler falla tras `NOTIFY`, la transacción se revierte y **no** se emite nada; el reintento notifica una sola vez | integración | Atomicidad con D3 |
| Un evento entregado dos veces notifica una sola vez | integración | Idempotencia |
| Tras cortar la conexión del oyente (`pg_terminate_backend`) se reconecta, vuelve a escuchar, emite el aviso de resincronización y recibe las siguientes | integración | Reconexión |
| Los eventos de un mismo lote llegan al bus en orden | integración | Orden (ADR-0001) |

**Deliberadamente sin test:** entrega a clientes WebSocket reales (E3); rendimiento con miles de suscriptores.

---

## 5 · Definition of Done

- [ ] SDD en `docs/sdd/D5/SDD.md`, Estado = Aprobado
- [ ] Contrato `LotNotification` con esquema, sin identidades de postor
- [ ] `notifier` y oyente funcionan de extremo a extremo; difusión a varias réplicas probada
- [ ] Reconexión del oyente probada
- [ ] Tests del §4 en verde; `npm run check` y `npm run test:integration` en verde
- [ ] PR con CI verde y fusionado

---

## 6 · Riesgos

| Riesgo | Gravedad | Mitigación |
|---|---|---|
| Pérdida de notificaciones mientras el oyente está desconectado | Media | Es *best-effort* por diseño; aviso de resincronización; el estado real se consulta por GraphQL |
| `LISTEN` no funciona detrás de un *pooler* en modo transacción (p. ej. el PgBouncer integrado de Azure PostgreSQL) | Media | El oyente usa una conexión directa dedicada; se verifica en H1 |
| El `NOTIFY` añade carga a PostgreSQL | Baja | Mensajes pequeños, uno por evento de lote; no es el camino de escritura de las pujas |
| El `notifier` único es un cuello de botella para tiempo real | Baja | Escala hasta el número de particiones; la latencia añadida es de milisegundos |
| Revelar información en las notificaciones | Alta | Contrato mínimo sin identidades, probado; ampliarlo exige decisión explícita |
| Se agrega una fila a `processed_event` por evento y consumidor | Baja | Es común a todos los consumidores; la retención de esa tabla es un ticket posterior |

---

## 7 · Preguntas abiertas

1. **Canal:** ¿`LISTEN/NOTIFY` con un único grupo `notifier` (propuesta), o un consumidor por réplica del servidor GraphQL con un grupo propio? Lo segundo es más directo pero choca con el límite de grupos de Event Hubs y con la lectura de "grupo `notifier`" de la spec.
2. **Privacidad:** ¿notificaciones sin `bidderId` ni `winnerId` (propuesta) o con identidad? Lo segundo exige decidir primero quién puede verla (F1).
3. ¿`BidRejected` sin notificación pública (propuesta)? Se reconsiderará como notificación privada del postor cuando exista autenticación.
4. **Resincronización:** ¿emitir al bus un aviso al reconectar el oyente (propuesta) para que E3 lo traslade a los clientes?
5. ¿El contrato y el bus viven en `@bidstream/notifier` (propuesta) y el proceso en `apps/notifier`?
