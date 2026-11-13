# SDD — F4 · Logs estructurados con id de correlación

- **Ticket:** ClickUp **F4** (`868mvty18`, https://app.clickup.com/t/868mvty18).
- **Autor:** generado con Claude (Entregable 1).
- **Estado:** Borrador (2026-11-13) — pendiente de aprobación
- **Versión:** 0.1 · **Fecha:** 2026-11-13
- **Fuentes de verdad citadas:**
  1. `docs/product/bidstream_spec.md` §8 (A09: «logs estructurados con id de correlación, bitácora append-only, alertas»)
  2. `packages/domain/src/events/envelope.ts` (`meta.correlationId` opcional, máx. 128) y `docs/sdd/A2/SDD.md`
  3. `apps/api/src/app.ts` (ya genera/acepta `x-request-id` con `REQUEST_ID`) y `packages/consumer/src/processor.ts` (ya registra `eventId`, `consumer`)
  4. `apps/{relay,projector,auditor}/src/main.ts` (tres copias del mismo `log` con `console.log(JSON.stringify(...))`)

---

## 0 · Preguntas que el ticket pidió cerrar

| # | Pregunta del ticket | Respuesta |
|---|---|---|
| 1 | ¿Qué viaja y por dónde? | `request.id` de la API → `meta.correlationId` del evento → cabecera Kafka `correlationId` → logs de relay y consumidores |
| 2 | ¿Qué no se registra jamás? | Secretos y datos sensibles: ver §2.3 (lista de campos redactados y prueba) |

---

## 1 · Alcance

### Entra

- Paquete **`@bidstream/logging`** (sin dependencias): `createLogger({ service, level, write? })` que escribe **una línea JSON por evento** con `level`, `time`, `service`, `msg` y los campos del contexto; **redacta** claves sensibles; implementa el tipo `Logger` que ya usan relay y consumidores.
- La API pone `meta.correlationId = request.id` en **todo** evento que crea (`openAuction`, `publishLot`, y C3 cuando llegue).
- El relay publica la cabecera `correlationId` junto a `eventId`, `type`, `version` y la registra al publicar.
- Los consumidores (`processor`) incluyen `correlationId` en cada línea (procesado, duplicado, reintento, DLQ) y en el mensaje del DLQ.
- Sustituir las tres copias del `log` de `main.ts` (relay, projector, auditor) y las del notifier por `createLogger`; GraphQL registra su `requestId` con el mismo formato.

### No entra (a propósito)

- Trazas distribuidas (OpenTelemetry) y métricas (lag en Grafana): fase H.
- Alertas (A09 las nombra): dependen del despliegue (H1).
- Autenticación del actor en los logs: llega con F1 (Q4).

### Premisas verificadas (heredadas de `task-brief`)

| Premisa del ticket | Qué hay de verdad |
|---|---|
| «Id de correlación desde la petición HTTP» | La API ya tiene `request.id` y lo devuelve en `x-request-id`, pero **no lo copia al evento**: hoy `meta` no se rellena |
| «Hasta los consumidores» | `processor.ts` registra `eventId` pero no `correlationId`; el relay no registra nada por evento |
| «Logs estructurados» | La API usa pino (JSON). Relay, projector y auditor tienen su propio `console.log(JSON.stringify)` duplicado, con campos distintos (`err`→`error`) |
| «Nunca registrar secretos» | Hoy no hay filtro: una `DATABASE_URL` en un objeto de error saldría tal cual |

---

## 2 · Diseño técnico

### 2.1 Flujo

```mermaid
flowchart LR
  H[HTTP x-request-id] --> API[API: request.id]
  API -->|meta.correlationId| O[(outbox)]
  O --> R[relay: cabecera correlationId]
  R --> K[(Kafka)]
  K --> C[consumidor: log con correlationId]
  C --> D[DLQ: correlationId en el mensaje]
```

### 2.2 `@bidstream/logging`

- `Logger` = `{ info, warn, error }(fields, msg)` (compatible con el tipo ya usado por `processor` y `relay`).
- Salida: `{"level","time","service","msg",…campos}` ; `err` se serializa como `{ name, message }` (sin pila en `info/warn`; la pila solo en `error`).
- Nivel configurable (`LOG_LEVEL`, por defecto `info`).
- `child({ correlationId })` para fijar contexto.

### 2.3 Redacción

Se reemplaza por `"[REDACTED]"` el **valor** de toda clave (a cualquier profundidad) que coincida con `/pass(word)?|secret|token|authorization|api[-_]?key|x-admin-key|connection[-_]?string|credential|cookie/i`, y en cualquier **cadena** se enmascara la contraseña de una URL (`scheme://user:PASS@host`). **Los eventos completos no se registran** (ya lo hace D7: solo `eventId`s); la carga útil de un evento (`payload`) tampoco, porque lleva `bidderId`.

### 2.4 Decisiones y por qué

| Decisión | Elección | Por qué |
|---|---|---|
| Dónde vive el logger | Paquete nuevo `@bidstream/logging` | Hoy hay 4 copias; relay y consumer ya dependen de un tipo `Logger` propio |
| Cómo se propaga | `meta.correlationId` (ya en el contrato) + cabecera Kafka | No cambia `version` del evento: `meta` ya es opcional |
| Id de correlación | `request.id` de la API (acepta `x-request-id` válido) | Ya existe, validado contra inyección en logs |
| Eventos creados por consumidores/relay | Heredan el `correlationId` del evento que los causó | Mantiene la cadena |
| pino también en los workers | No: un logger mínimo propio | Sin dependencia nueva; la API sigue con pino y mismos campos |

---

## 3 · Cambios por archivo/módulo

| Archivo/módulo | Cambio |
|---|---|
| `packages/logging/` (nuevo) | `createLogger`, redacción, `child`; `tsconfig.build.json`; añadido al `tsconfig.json` raíz |
| `apps/api/src/commands/*.ts` | `buildEvent(..., { meta: { correlationId } })`; el id llega desde la ruta (`request.id`) |
| `packages/db` / `apps/relay` | El relay copia `meta.correlationId` a la cabecera y la registra |
| `packages/consumer/src/processor.ts`, `dlq.ts` | `correlationId` en logs y en `DlqMessage` (campo opcional, compatible) |
| `apps/{relay,projector,auditor,notifier}/src/main.ts` | Usar `createLogger`; eliminar la copia local |
| `apps/graphql/src/server.ts` | `requestId` en los logs con el mismo formato |
| `README.md`, `CLAUDE.md` | Sección «Logs y correlación» |

---

## 4 · Plan de tests

| Caso | Nivel | Cubre |
|---|---|---|
| Una línea por evento, JSON válido, con `level`, `time`, `service`, `msg` | unit | Formato |
| Se redactan `password`, `token`, `authorization`, `x-admin-key`, `apiKey`, `DATABASE_URL` anidados y en arrays | unit | A09 |
| Una URL con contraseña en un mensaje o en `err.message` sale enmascarada | unit | Secretos |
| `err` se serializa sin pila en `info`/`warn` | unit | Fuga de información |
| `child` conserva el contexto y no muta al padre | unit | API |
| `POST /v1/auctions` con `x-request-id: abc` → el evento del outbox lleva `meta.correlationId = "abc"` | integración | Propagación (API) |
| Sin `x-request-id` válido, el id generado se devuelve en la cabecera y coincide con el del evento | integración | Propagación |
| **Cadena completa**: petición → outbox → relay → Kafka (cabecera) → projector: el mismo `correlationId` aparece en el log del relay y en el del consumidor | integración | Extremo a extremo |
| Un evento al DLQ conserva `correlationId` | integración | Diagnóstico |
| Ningún log de la cadena contiene `DATABASE_URL`, `X-Admin-Key` ni `bidderId` | integración | OWASP A09 |

**Deliberadamente sin test:** el rendimiento del logger.

---

## 5 · Definition of Done

- [ ] SDD en `docs/sdd/F4/SDD.md`, Estado = Aprobado
- [ ] Implementación según el SDD; las cuatro copias del `log` eliminadas
- [ ] Tests del §4 en verde; `npm run check` e `integration` en verde
- [ ] PR con CI verde y fusionado

---

## 6 · Riesgos

| Riesgo | Gravedad | Mitigación |
|---|---|---|
| La redacción por nombre de clave no atrapa un secreto con nombre inocente | Media | Además enmascara URLs con contraseña; los eventos y cargas útiles no se registran; revisión en cada logger nuevo |
| Cambiar el formato de logs rompe a quien los lea | Baja | Aún no hay consumidores de logs (H1/H4 los definirán); se mantienen los campos actuales |
| `meta.correlationId` controlado por el cliente | Media | Solo se acepta si cumple `REQUEST_ID` (ya existente); se trunca a 128 |

---

## 7 · Preguntas abiertas

1. **Paquete nuevo `@bidstream/logging`** para relay, consumidores y notifier (propuesta), con la API en pino. ¿O prefieres pino en todos?
2. **Correlación por cabecera Kafka `correlationId` y `meta.correlationId`** sin cambiar `version` del evento (propuesta).
3. **Redacción por nombre de clave y URLs con contraseña** (propuesta), sin registrar jamás el `payload` de los eventos. ¿De acuerdo?
4. **Alcance:** también GraphQL (solo `requestId`) y el notifier; sin OpenTelemetry. ¿Bien?
