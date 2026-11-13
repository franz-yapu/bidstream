# SDD — D7 · Endpoint administrativo para reprocesar el DLQ

- **Ticket:** ClickUp **D7** (`868mvty0q`, https://app.clickup.com/t/868mvty0q).
- **Autor:** generado con Claude (Entregable 1).
- **Estado:** Aprobado (2026-11-13)
- **Versión:** 1.0 · **Fecha:** 2026-11-13
- **Fuentes de verdad citadas:**
  1. `docs/product/bidstream_spec.md` §5 ("Reintentos y DLQ… al cuarto fallo el evento va al dead-letter topic con el error adjunto y un endpoint administrativo permite reprocesarlo"), §4 (`bidstream.events.lot.dlq`: 1 partición, 30 días), §8 A01/A09
  2. `docs/sdd/D3/SDD.md` §2.4 y §6 (formato del mensaje DLQ y su riesgo: un evento en DLQ no detiene a los siguientes del mismo lote), `docs/sdd/G2/SDD.md` (la reconstrucción completa es el camino sólido para la proyección)
  3. `docs/sdd/D2/SDD.md` (consumidor con commit manual), `docs/sdd/C1/SDD.md` y `C2/SDD.md` (API, `problem+json`, `buildApp`, tenant provisional)
  4. `docs/decisions/LOG.md` — Q4 (sin autenticación: la API no arranca en producción hasta F1)

---

## 0 · Preguntas que el ticket pidió cerrar

| # | Pregunta del ticket | Respuesta |
|---|---|---|
| 1 | ¿Cómo se protege hasta que exista F1 (roles)? | Con una **clave de servicio** (`X-Admin-Key` frente a `ADMIN_API_KEY`); sin la variable, las rutas **no existen** (§2.2) |

---

## 1 · Alcance

### Entra

- `GET /v1/admin/dlq`: ver qué hay en el DLQ (sin consumirlo).
- `POST /v1/admin/dlq/reprocess`: republicar en el topic original los eventos fallidos, en modo **pendientes** (por defecto) o **selectivo** (por `eventId`).
- Lógica reutilizable `peekDlq` y `reprocessDlq` en `@bidstream/consumer`.
- Protección con clave de servicio, un único reproceso a la vez y límite por llamada.
- **Guardia contra bucles:** un contador de reprocesos que viaja en el DLQ.
- Pruebas de integración con Kafka y PostgreSQL reales, incluido el ciclo completo (fallo → DLQ → reproceso → procesado).

### No entra (a propósito)

- Roles y permisos de usuario → F1 (Q4): esta clave de servicio es provisional.
- Reproceso de la proyección completa → G2 (`npm run reprocess`).
- Reparar eventos «veneno» (JSON o contrato inválidos): no se arreglan reintentando.
- Interfaz gráfica; alertas sobre el tamaño del DLQ (H4).

### Premisas verificadas (heredadas de `task-brief`)

| Premisa del ticket | Qué hay de verdad |
|---|---|
| "Lee el DLQ y republica al topic original con su clave" | El mensaje DLQ (D3) trae `original` (valor sin tocar), `key`, `consumer`, `attempts`, `reason`, `source` y el error. Es suficiente para republicar |
| "Responde con cuántos reprocesó" | Hace falta además saber qué se saltó y por qué |
| Riesgo de bucle | **El DLQ no conserva las cabeceras del mensaje original**: si se republica un evento que vuelve a fallar, el nuevo mensaje DLQ no sabe que ya se reprocesó. Un fallo permanente haría un bucle infinito |
| Orden | Republicar añade el evento **al final** de su partición: el consumidor que lo había rechazado lo verá **después** de los posteriores del mismo lote (D3 §6). Para un fallo transitorio (p. ej. la base caída) suele ser inocuo; no es un sustituto del reproceso completo |
| Quién reprocesa | Republicar en `bidstream.events.lot` lo reciben **todos** los grupos (`projector`, `notifier`, `auditor`); los que ya lo procesaron lo ignoran como duplicado (`ProcessedEvent`) y el que falló lo procesa ahora |
| La API | No depende hoy de Kafka (solo de `TOPICS`); el cliente nativo es pesado |
| `describeGroup`/lag | `createKafkaAdmin` (G2) ya permite saber si un grupo tiene miembros y cuántos mensajes pendientes tiene |

---

## 2 · Diseño técnico

### 2.1 Dos modos

| Modo | Llamada | Qué hace |
|---|---|---|
| **Pendientes** (por defecto) | `POST /v1/admin/dlq/reprocess {}` o `{ "limit": 100 }` | Lee del DLQ desde el offset confirmado del grupo `dlq-reprocessor`, republica hasta `limit` mensajes y confirma el offset tras cada uno. Lo que vuelva a fallar entra al final del DLQ como mensaje nuevo, de modo que vuelve a quedar pendiente |
| **Selectivo** | `{ "eventIds": ["…"] }` | Recorre el DLQ desde el principio con un grupo efímero y republica solo esos eventos, **sin tocar** el offset del grupo de pendientes |

`GET /v1/admin/dlq?limit=50` lista (sin consumir) con un grupo efímero desde el principio: `eventId`, `type`, `consumer`, `reason`, `attempts`, `reprocessCount`, error, origen y `failedAt`; y los pendientes del grupo `dlq-reprocessor` (lag).

### 2.2 Protección (provisional hasta F1)

- Cabecera `X-Admin-Key` comparada con `ADMIN_API_KEY` en tiempo constante (`timingSafeEqual`); la clave exige al menos 32 caracteres.
- **Si `ADMIN_API_KEY` no está definida, las rutas no se registran** (404): una instalación sin clave no expone nada.
- Clave incorrecta o ausente → 401 `problem+json`, sin pistas.
- Una operación de administración cruza tenants (el DLQ mezcla eventos de todos): la clave es de **operador de la plataforma**, no de un cliente. F1 la sustituirá por el rol `admin`.
- Cada reproceso se registra en el log con `requestId`, modo, cantidad y `eventId` afectados (OWASP A09).

### 2.3 Qué se republica y qué no

Solo mensajes con `reason = retries-exhausted`, cuyo `original` pasa `parseEvent` y cuyo `reprocessCount < 3`. Se republican **`original` sin tocar**, con la **misma clave** y las cabeceras `eventId`, `type`, `version` y `x-reprocess-count = reprocessCount + 1`. Se saltan y se cuentan aparte:

| Motivo | Por qué |
|---|---|
| `poison` | JSON o contrato inválidos: reintentar nunca los arregla; se quedan en el DLQ para inspección |
| `too-many-attempts` | `reprocessCount >= 3`: guardia contra el bucle de un fallo permanente |
| `not-selected` | En modo selectivo, los que no están en `eventIds` |

### 2.4 Guardia contra bucles

Se añade a `dlqMessageSchema` (D3) un campo **opcional** `reprocessCount` (por defecto 0, compatible con los mensajes ya existentes). `buildDlqMessage` lo rellena con la cabecera `x-reprocess-count` del mensaje que falló. Así el contador sobrevive al ciclo fallo → DLQ → reproceso → fallo.

### 2.5 Decisiones y por qué

| Decisión | Elección | Por qué |
|---|---|---|
| Ubicación de la lógica | `@bidstream/consumer` (`peekDlq`, `reprocessDlq`) | Allí vive el formato del DLQ; la API solo traduce HTTP |
| Kafka en la API | **Importación diferida** (`await import(…)`) dentro del manejador | La API sigue siendo ligera y no carga el binario nativo si el administrador no se usa |
| Pendientes por offset de un grupo | Grupo `dlq-reprocessor` con commit tras republicar | Es el estado natural de Kafka; sobrevive a reinicios y no necesita tabla propia |
| Selectivo sin offsets | Grupo efímero (id aleatorio), sin commit | No altera lo pendiente y no deja grupos persistentes |
| Un reproceso a la vez | Si `dlq-reprocessor` tiene miembros → 409 | Evita republicar dos veces la misma tanda |
| Límite | `limit` por defecto 100, máximo 1 000 | Acota el trabajo y el tiempo de la petición |
| Republicar al final, no «en su sitio» | Inherente a Kafka | Se documenta como limitación (§6); G2 es el camino para la integridad de la proyección |
| Sin borrar del DLQ | Los mensajes caducan a los 30 días | El log es inmutable; el estado de «ya reprocesado» lo da el offset |

---

## 3 · Cambios por archivo/módulo

| Archivo/módulo | Cambio |
|---|---|
| `packages/consumer/src/dlq.ts` | `reprocessCount` opcional en el esquema y en `buildDlqMessage` |
| `packages/consumer/src/processor.ts` | Pasar `x-reprocess-count` del mensaje al DLQ |
| `packages/consumer/src/dlq-admin.ts` | `peekDlq`, `reprocessDlq`, `MAX_REPROCESS`, errores tipados |
| `packages/consumer/src/index.ts` | Exporta lo anterior |
| `apps/api/src/routes/admin.ts` | `GET /v1/admin/dlq` y `POST /v1/admin/dlq/reprocess` con esquemas Zod y OpenAPI |
| `apps/api/src/admin-auth.ts` | Comprobación de `X-Admin-Key` en tiempo constante |
| `apps/api/src/config.ts`, `app.ts`, `main.ts` | `ADMIN_API_KEY` opcional (≥ 32 caracteres) y registro condicional de las rutas; configuración de Kafka |
| `apps/api/package.json` | Dependencia `@bidstream/consumer` (importación diferida) |
| `.env.example`, `README.md`, `CLAUDE.md` | Variable, ejemplo con `curl` y la advertencia sobre el orden |

---

## 4 · Plan de tests

Integración con Kafka y PostgreSQL reales y la API con `app.inject()`.

| Caso | Nivel | Cubre |
|---|---|---|
| `dlqMessageSchema` acepta mensajes sin `reprocessCount` (antiguos) y con él; `buildDlqMessage` lo rellena desde la cabecera | unit | Compatibilidad |
| Sin `ADMIN_API_KEY` las rutas no existen (404); con ella, sin cabecera o con otra clave → 401; la clave correcta → 200; claves de longitud distinta no revientan la comparación | integración | Protección |
| `ADMIN_API_KEY` de menos de 32 caracteres → la configuración falla al arrancar | unit | Fortaleza |
| `GET` lista los mensajes del DLQ con sus campos y sin consumirlos (dos llamadas seguidas dan lo mismo) | integración | Vista sin efecto |
| Modo pendientes: republica los `retries-exhausted` con el valor original, la misma clave y las cabeceras (`eventId`, `type`, `version`, `x-reprocess-count = 1`) en el topic original | integración | Reproceso |
| Los `poison` no se republican y se cuentan como saltados | integración | Veneno |
| Un mensaje con `reprocessCount = 3` se salta (`too-many-attempts`) | integración | Guardia contra bucles |
| `limit` se respeta y una segunda llamada continúa donde terminó la primera (offset confirmado) sin repetir | integración | Pendientes |
| Modo selectivo: solo republica los `eventIds` pedidos y **no** altera lo pendiente del grupo | integración | Selectivo |
| Con otro reproceso en marcha (grupo con miembros) → 409 | integración | Exclusión |
| **Ciclo completo:** un handler que falla (p. ej. la base «caída») lleva el evento al DLQ → se corrige el fallo → `reprocess` → el consumidor lo procesa y queda aplicado una sola vez; los demás grupos lo ignoran como duplicado | integración (todo real) | De punta a punta |
| **Fallo permanente:** el evento falla, se reprocesa, vuelve a fallar con `reprocessCount = 1`… y tras 3 reprocesos se detiene | integración | Sin bucle infinito |
| La respuesta indica examinados, republicados, saltados por motivo y pendientes restantes | integración | Resultado |
| El log del reproceso incluye `requestId`, cantidad y `eventId`, y no incluye el contenido de los eventos | integración | OWASP A09 |

**Deliberadamente sin test:** DLQ con millones de mensajes; sustitución por roles (F1).

---

## 5 · Definition of Done

- [ ] SDD en `docs/sdd/D7/SDD.md`, Estado = Aprobado
- [ ] `GET` y `POST` protegidos por clave de servicio; sin clave configurada no existen
- [ ] Reproceso de pendientes y selectivo, con guardia contra bucles
- [ ] Ciclo completo fallo → DLQ → reproceso → procesado probado, y el fallo permanente se detiene
- [ ] Limitación de orden documentada en README
- [ ] Tests del §4 en verde; `npm run check` y `npm run test:integration` en verde
- [ ] PR con CI verde y fusionado

---

## 6 · Riesgos

| Riesgo | Gravedad | Mitigación |
|---|---|---|
| **Orden:** el evento reprocesado llega después de los posteriores del mismo lote y el estado del `projector` puede quedar incoherente | Alta | Documentado; es para fallos transitorios. Para integridad de la proyección, `npm run reprocess` (G2) reconstruye en orden desde el log |
| La clave de servicio es el único control hasta F1 | Alta | Mínimo de 32 caracteres, comparación en tiempo constante, rutas inexistentes sin clave, y la API no arranca en producción hasta F1 de todos modos |
| Un administrador republica por error eventos que no debía | Media | Solo `retries-exhausted`; selectivo por `eventId`; registro de cada operación |
| Bucle por un fallo permanente | Media | `reprocessCount` y tope de 3 reprocesos |
| Cargar el cliente nativo de Kafka en la API | Baja | Importación diferida |
| El DLQ de 1 partición limita el rendimiento del reproceso | Baja | Es volumen de excepciones, no de tráfico |

---

## 7 · Preguntas abiertas

1. **Clave de servicio** `X-Admin-Key` hasta que F1 aporte roles (propuesta). ¿De acuerdo, con las rutas inexistentes si no hay clave?
2. **Dos modos** (pendientes por offset y selectivo por `eventId`). ¿O prefieres solo uno?
3. **Tope de 3 reprocesos** por evento y `limit` máximo de 1 000. ¿De acuerdo?
4. **Importación diferida de Kafka** en la API (propuesta) frente a un `apps/admin` separado. ¿De acuerdo?
5. **Los `poison` se quedan en el DLQ** sin opción de republicarlos. ¿De acuerdo?
