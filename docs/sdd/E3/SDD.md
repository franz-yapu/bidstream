# SDD — E3 · Subscription `lotUpdated`

- **Ticket:** ClickUp **E3** (`868mvty15`, https://app.clickup.com/t/868mvty15).
- **Autor:** generado con Claude (Entregable 1).
- **Estado:** Aprobado (2026-11-12)
- **Versión:** 1.0 · **Fecha:** 2026-11-12
- **Fuentes de verdad citadas:**
  1. `docs/product/bidstream_spec.md` §7 (`Subscription.lotUpdated(lotId: ID!): LotUpdate!` "alimentada por el consumidor `notifier`"), §8 A01 (control de acceso), A04 (diseño inseguro)
  2. `docs/sdd/D5/SDD.md` (`LotNotification`, `InMemoryNotificationBus`, `startNotificationListener`, aviso de resincronización, entrega *best-effort*, sin identidades)
  3. `docs/sdd/E1/SDD.md` (servidor Yoga, tenant provisional, esquema) y `docs/sdd/E2/SDD.md` (los mismos límites aplican a las subscriptions)
  4. `docs/sdd/B1/SDD.md` (proyección, para comprobar que el lote existe)

---

## 0 · Preguntas que el ticket pidió cerrar

| # | Pregunta del ticket | Respuesta |
|---|---|---|
| 1 | ¿Transporte (WebSocket o SSE) y autorización? | **SSE** (incluido en Yoga) con el tenant provisional por cabecera (§2.1) |

---

## 1 · Alcance

### Entra

- `type Subscription { lotUpdated(lotId: ID!): LotUpdate! }` en el servidor de E1.
- Tipo `LotUpdate` como **unión** de las notificaciones públicas del lote, más un aviso `ResyncRequired`.
- Integración con el canal de D5: el servidor arranca `startNotificationListener` y un `InMemoryNotificationBus`.
- Entrega **por tenant** y por lote, con cola acotada por suscriptor y límite de suscripciones por tenant.
- Limpieza al desconectar el cliente (sin fugas).
- Una prueba de **flujo completo**: API → relay → Kafka → `projector` y `notifier` → GraphQL (consulta y subscription).

### No entra (a propósito)

- Transporte WebSocket (`graphql-ws`): queda como evolución (§7 #1).
- Autenticación y autorización por usuario → F1.
- Notificaciones privadas por postor (p. ej. «su puja fue rechazada»).
- Garantías de entrega «exactamente una vez»: es *best-effort* (D5 §2.4).

### Premisas verificadas (heredadas de `task-brief`)

| Premisa del ticket | Qué hay de verdad |
|---|---|
| "Emite un `LotUpdate` cada vez que el `notifier` recibe un evento del lote" | D5 entrega `LotNotification` (4 tipos) por un bus en proceso; no hay servidor GraphQL ni tipo `LotUpdate` |
| Transporte | `graphql-yoga` 6 sirve subscriptions por **SSE** sin dependencias nuevas; `graphql-ws` 6.4.2 (WebSocket) está disponible pero añade `ws` y un servidor de sockets. Con SSE el cliente envía cabeceras normales (`fetch`), lo que sirve al tenant provisional |
| Fugas | `InMemoryNotificationBus` no expone cuántos suscriptores hay: hace falta para probar que no quedan suscripciones al desconectar |
| Notificaciones públicas | Sin `bidderId` ni `winnerId` (D5): un `LotUpdate` tampoco puede llevarlos |
| `Lot` y existencia | Para rechazar suscripciones a lotes que no existen hay que consultar la proyección |
| Pérdida de conexión del oyente | D5 emite `publishResync()` al reconectar: E3 debe convertirlo en un mensaje para los clientes |

---

## 2 · Diseño técnico

### 2.1 Decisiones y por qué

| Decisión | Elección | Por qué |
|---|---|---|
| Transporte | **SSE** (GraphQL sobre SSE de Yoga) | Cero dependencias nuevas, funciona detrás de cualquier proxy HTTP y admite cabeceras. WebSocket queda como evolución |
| Tipo de retorno | `union LotUpdate = LotPublishedUpdate \| BidPlacedUpdate \| LotExtendedUpdate \| LotClosedUpdate \| ResyncRequired` | Cumple `LotUpdate!` de la spec y cada variante lleva solo sus campos |
| `ResyncRequired` | Variante que se emite cuando el canal se reconectó | El cliente sabe que pudo perder mensajes y vuelve a consultar `lot(id)` |
| Alcance | Por `(tenantId, lotId)` | Un tenant jamás ve lotes de otro (A01) |
| Existencia del lote | Al suscribirse se comprueba en la proyección (mismo tenant); si no existe, error `NOT_FOUND` | Evita suscripciones a identificadores arbitrarios (agotamiento de recursos) y no revela lotes ajenos |
| Cola por suscriptor | Acotada (50): si se desborda se descarta lo pendiente y se emite `ResyncRequired` | Un cliente lento no consume memoria sin límite ni frena a los demás |
| Límite por tenant | 500 suscripciones simultáneas (configurable); al superarlo, error claro | Frena el agotamiento de conexiones (A04) |
| Limpieza | Al cerrarse el flujo (desconexión) se cancela la suscripción del bus | Sin fugas; probado con un contador |
| Orden | El de llegada al bus, que es el de cada lote (ADR-0001) | Cumple lo prometido por la arquitectura |
| Mantenimiento | Latidos (*keep-alive*) del transporte para que balanceadores y proxies no corten conexiones inactivas | Conexiones largas en Azure Container Apps |

### 2.2 Esquema

```graphql
type Subscription { lotUpdated(lotId: ID!): LotUpdate! }

union LotUpdate = LotPublishedUpdate | BidPlacedUpdate | LotExtendedUpdate | LotClosedUpdate | ResyncRequired

interface LotUpdateBase { eventId: ID!  occurredAt: DateTime!  lotId: ID! }
type LotPublishedUpdate implements LotUpdateBase { …  auctionId: ID!  startingPrice: Money!  closesAt: DateTime! }
type BidPlacedUpdate    implements LotUpdateBase { …  amount: Money!  placedAt: DateTime! }
type LotExtendedUpdate  implements LotUpdateBase { …  newClosesAt: DateTime! }
type LotClosedUpdate    implements LotUpdateBase { …  finalAmount: Money  hasWinner: Boolean! }
type ResyncRequired { message: String! }
```

### 2.3 Flujo

```
notifier ─ NOTIFY ─▶ PostgreSQL ─ LISTEN ─▶ startNotificationListener ─▶ InMemoryNotificationBus
                                                                              │ subscribe(tenant, lot)
cliente ──(SSE, X-Tenant-Id)──▶ Subscription.lotUpdated ──▶ iterador asíncrono acotado ──▶ eventos SSE
```

---

## 3 · Cambios por archivo/módulo

| Archivo/módulo | Cambio |
|---|---|
| `apps/graphql/src/schema.graphql` | `Subscription`, la unión y sus tipos |
| `apps/graphql/src/subscriptions/lot-updated.ts` | Resolver `subscribe`/`resolve`, iterador acotado, límite por tenant, comprobación de existencia |
| `apps/graphql/src/subscriptions/iterator.ts` | `busIterator(bus, tenantId, lotId, { maxQueue })` con limpieza al cerrar |
| `apps/graphql/src/server.ts`, `main.ts` | Arranque de `startNotificationListener` y del bus; parada ordenada |
| `apps/graphql/src/config.ts` | `GQL_MAX_SUBSCRIPTIONS_PER_TENANT`, `GQL_SUBSCRIPTION_QUEUE` |
| `packages/notifier/src/bus.ts` | `subscriptionCount()` para observabilidad y pruebas |
| `apps/graphql/package.json` | Dependencias `@bidstream/notifier`, `@bidstream/testing` (dev) |
| `README.md`, `CLAUDE.md` | Cómo suscribirse con `curl` y los límites |

---

## 4 · Plan de tests

Integración con PostgreSQL y el servidor en proceso; el cliente SSE lee el flujo con `fetch` y `Accept: text/event-stream`.

| Caso | Nivel | Cubre |
|---|---|---|
| Suscribirse y publicar una notificación (`publishNotification` en una transacción) → el cliente recibe el `LotUpdate` correcto con la variante y los campos esperados | integración | Camino feliz |
| Cada uno de los 4 tipos llega como su variante de la unión (`... on BidPlacedUpdate`, etc.) | integración | Unión |
| Varias notificaciones del mismo lote llegan **en orden** | integración | Orden |
| Dos clientes suscritos al mismo lote reciben ambos; un cliente de **otro tenant** no recibe nada | integración | Aislamiento |
| Suscripción a un lote inexistente o de otro tenant → `NOT_FOUND` y **sin** suscripción en el bus | integración | Existencia |
| Al cancelar la petición el contador de suscriptores del bus vuelve a 0 | integración | Sin fugas |
| Un cliente que no lee: al desbordarse la cola recibe `ResyncRequired` y no crece la memoria; otro cliente sigue recibiendo | integración | Cola acotada |
| Cortar la conexión del oyente (`pg_terminate_backend`) → los suscritos reciben `ResyncRequired` y siguen recibiendo después | integración | Reconexión (D5) |
| Superar el límite de suscripciones del tenant → error y no se crean más; al liberar una, se puede volver a suscribir | integración | Límite |
| Una subscription demasiado profunda o compleja se rechaza (E2) sin crear suscripción | integración | Límites de E2 |
| Sin cabecera de tenant → `UNAUTHENTICATED` | integración | Tenant |
| **Flujo completo:** `POST /v1/auctions` y `…/lots` (API) → relay → Kafka → `projector` y `notifier` → GraphQL: la consulta `lot(id)` muestra el lote y una subscription abierta recibe las pujas y el cierre, y el estado final de la consulta coincide con `foldLot` | integración (todo real) | De punta a punta |

**Deliberadamente sin test:** miles de suscriptores simultáneos y carga; clientes WebSocket.

---

## 5 · Definition of Done

- [ ] SDD en `docs/sdd/E3/SDD.md`, Estado = Aprobado
- [ ] `lotUpdated` entrega los 4 tipos y `ResyncRequired`, en orden y por tenant
- [ ] Sin fugas al desconectar; cola acotada; límite por tenant
- [ ] Flujo completo API → … → GraphQL probado
- [ ] Tests del §4 en verde; `npm run check` y `npm run test:integration` en verde
- [ ] README muestra cómo suscribirse
- [ ] PR con CI verde y fusionado

---

## 6 · Riesgos

| Riesgo | Gravedad | Mitigación |
|---|---|---|
| Pérdida de notificaciones mientras el oyente está desconectado | Media | `ResyncRequired` y consulta del estado real (D5 §2.4); es *best-effort* por diseño |
| Clientes lentos o maliciosos acumulan memoria | Alta | Cola acotada por suscriptor y límite por tenant |
| SSE con HTTP/1.1 limita las conexiones por dominio en navegadores | Baja | Con HTTP/2 desaparece el límite; el cliente puede multiplexar varias subscriptions en un flujo |
| Fugas de suscripciones por desconexiones mal gestionadas | Media | Limpieza en el cierre del iterador y prueba con contador |
| El tenant por cabecera permite elegir tenant | Alta (si llegara a producción) | Prohibido en producción por configuración (E1/C2); se sustituye en F1 |
| Revelar identidades por la vía de las subscriptions | Alta | El contrato de D5 no las contiene; la unión tampoco |

---

## 7 · Preguntas abiertas

1. **SSE** (propuesta) o WebSocket con `graphql-ws`. SSE no añade dependencias y sirve las cabeceras del tenant; WebSocket es más habitual en clientes existentes. ¿De acuerdo con SSE y WebSocket como evolución?
2. **`LotUpdate` como unión con `ResyncRequired`** (propuesta) o un objeto único con campos opcionales. La unión es más precisa; el objeto único es más simple de consumir. ¿De acuerdo?
3. **Comprobar que el lote existe al suscribirse** (propuesta) a costa de una lectura por suscripción.
4. **Límites:** 500 suscripciones por tenant y cola de 50 por suscriptor. ¿De acuerdo?
5. **Prueba de flujo completo** incluida en este ticket (propuesta), ya que es el cierre natural de los seis procesos del núcleo.
