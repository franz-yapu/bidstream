# SDD — D6 · Consumidor `auditor`: bitácora append-only

- **Ticket:** ClickUp **D6** (`868mvty0k`, https://app.clickup.com/t/868mvty0k).
- **Autor:** generado con Claude (Entregable 1).
- **Estado:** Borrador
- **Versión:** 1.0 · **Fecha:** 2026-11-12
- **Fuentes de verdad citadas:**
  1. `docs/product/bidstream_spec.md` §4 (grupo `auditor`: "escribe la bitácora append-only"), §8 A09 ("logs estructurados con id de correlación, bitácora append-only, alertas"), A08 (integridad de datos)
  2. `docs/sdd/D3/SDD.md` (idempotencia por `(eventId, consumer)`, reintentos, DLQ), `docs/sdd/B1/SDD.md` (migraciones, índices parciales a mano)
  3. `docs/sdd/A2/SDD.md` (contrato de eventos, `meta` reservado), `docs/do-not-touch.md` (log de eventos como fuente de verdad)

---

## 0 · Preguntas que el ticket pidió cerrar

| # | Pregunta del ticket | Respuesta |
|---|---|---|
| 1 | ¿Cómo se refuerza "append-only"? | Disparadores (*triggers*) que rechazan `UPDATE`, `DELETE` y `TRUNCATE`, más un rol de base de datos solo con `INSERT`/`SELECT` en producción (§2.3) |

---

## 1 · Alcance

### Entra

- Tabla `audit_log` (modelo Prisma + migración `0003` con los disparadores en SQL).
- `recordAuditEntry(tx, event, source)` en `@bidstream/db`.
- Proceso `apps/auditor`: compone `createEventConsumer` con el grupo `auditor`.
- Pruebas de integración con PostgreSQL y Kafka reales.

### No entra (a propósito)

- API o pantalla para consultar la bitácora (la lectura es por SQL; un endpoint administrativo llega con F1 y roles).
- Cadena de *hashes* para evidenciar manipulación (ver §2.4 y §7 #3).
- Firma de eventos (F3, bloqueada por Q5) y alertas (H4).
- Particionado o retención de la tabla: el crecimiento se documenta y se atiende después.
- La bitácora de **acceso HTTP** (autenticación, administración): es de F1/F4; esta es la bitácora de **eventos de dominio**.

### Premisas verificadas (heredadas de `task-brief`)

| Premisa del ticket | Qué hay de verdad |
|---|---|
| "Tabla append-only" | No existe ninguna tabla de bitácora; `ProcessedEvent` registra solo `(event_id, consumer, handled_at)` y no guarda el contenido |
| "Todo lo ocurrido" | El `auditor` debe registrar **los siete tipos**, incluido `BidRejected`: es el único consumidor que conserva los rechazos (el `projector` los ignora, D4 §7 #3) |
| Reforzar con permisos | En desarrollo hay un solo usuario (`bidstream`, propietario de todo) y un propietario siempre puede quitar un disparador; la garantía fuerte solo existe con un rol separado en producción (H1) |
| Idempotencia | D3 ya garantiza una ejecución por `(eventId, auditor)` en la misma transacción; una restricción única sobre `event_id` es una segunda barrera |
| Datos disponibles | Cada mensaje trae `topic`, `partition`, `offset`, clave y valor original: se pueden guardar para trazar hasta el log |

---

## 2 · Diseño técnico

### 2.1 Tabla `audit_log`

| Columna | Tipo | Contenido |
|---|---|---|
| `event_id` | `uuid` PK | `eventId` del evento (UUID v7): una fila por evento, idempotente |
| `type` | `text` | `AuctionOpened`, `BidRejected`… |
| `tenant_id` | `uuid` | Tenant del evento |
| `key` | `text` | Clave de partición (`lotId`/`auctionId`) |
| `occurred_at` | `timestamptz(3)` | Cuándo ocurrió (del evento) |
| `payload` | `jsonb` | El evento completo, **sin tocar** |
| `source_topic`, `source_partition`, `source_offset` | `text`, `int`, `bigint` | De dónde se leyó (trazabilidad hasta el log) |
| `recorded_at` | `timestamptz(3)` default `now()` | Cuándo lo registró el `auditor` |

Índices: `(tenant_id, occurred_at)` para consultar por tenant y tiempo, y `(key, occurred_at)` para reconstruir la historia de un lote o subasta.

### 2.2 Qué se registra

**Todos** los eventos de `bidstream.events.lot`, sin filtrar y sin transformar: la bitácora es el registro fiel de lo ocurrido, incluidos los rechazos. Eventos inválidos no llegan aquí: D3 los desvía al DLQ y quedan registrados allí.

### 2.3 Append-only en tres capas

| Capa | Qué hace | Alcance |
|---|---|---|
| Aplicación | Solo existe `recordAuditEntry` (INSERT); no hay ninguna función de actualización ni borrado | Siempre |
| Base de datos: disparadores | `BEFORE UPDATE OR DELETE` por fila y `BEFORE TRUNCATE` por sentencia lanzan una excepción | Siempre (migración); detiene errores y usos accidentales |
| Base de datos: permisos | En producción, el rol de la aplicación tiene solo `INSERT, SELECT` sobre `audit_log` | H1 (despliegue); es lo que impide a un atacante con las credenciales de la aplicación borrar rastros |

Los disparadores no protegen frente al propietario de la tabla (puede quitarlos); por eso la tercera capa es la que da garantía real, y se deja documentada para H1.

### 2.4 Integridad frente a manipulación

No se implementa una cadena de *hashes* (cada fila con el hash de la anterior): exigiría un orden global de escritura y serializar a los tres grupos, que contradice el paralelismo por partición. La integridad del **contenido** se cubre con la firma de eventos (F3) y la del **registro** con la inmutabilidad de §2.3. Si se quisiera detección de manipulación, el mecanismo adecuado sería periodicamente anclar un *hash* por tramo (no por fila); queda como evolución (§7 #3).

### 2.5 Decisiones y por qué

| Decisión | Elección | Por qué |
|---|---|---|
| Clave primaria | `event_id` | Una fila por evento; reintentos y reprocesos no duplican |
| Reutilizar D3 | `createEventConsumer`, grupo `auditor` | Reintentos, DLQ e idempotencia; el registro y el `ProcessedEvent` van en la misma transacción |
| `payload` sin transformar | `jsonb` del evento tal cual | Fidelidad probatoria; permite reconstruir cualquier vista |
| Metadatos de origen | `topic`, `partition`, `offset` | Trazar cada fila hasta su posición exacta en el log |
| Disparadores en la migración | SQL a mano, como los índices parciales de B1 | Prisma no los expresa; quedan versionados junto al esquema |
| Sin borrado ni retención en V1 | Ninguna | Es una bitácora; la política de retención y el particionado se deciden con datos reales |

---

## 3 · Cambios por archivo/módulo

| Archivo/módulo | Cambio |
|---|---|
| `packages/db/prisma/schema.prisma` | Modelo `AuditLog` (`@@map("audit_log")`) |
| `packages/db/prisma/migrations/0003_audit_log/migration.sql` | Tabla, índices y disparadores |
| `packages/db/src/audit/record.ts` | `recordAuditEntry(tx, event, source)` |
| `packages/db/src/index.ts` | Reexporta |
| `apps/auditor/**` | Nuevo `@bidstream/auditor`: `main.ts`, `config.ts`, `createAuditor` |
| `tsconfig.json` (raíz), `package.json` | Referencias y `dev:auditor` |
| `docs/sdd/B1/SDD.md` | Nota de la nueva tabla y migración (revisión 1.2) |
| `.env.example`, `README.md`, `CLAUDE.md` | Variables y cómo arrancarlo; nota de permisos para H1 |

---

## 4 · Plan de tests

| Caso | Nivel | Cubre |
|---|---|---|
| `recordAuditEntry` guarda para cada uno de los 7 tipos: `event_id`, `type`, `tenant_id`, `key = partitionKey`, `occurred_at`, `payload` igual al evento y origen (`topic`, `partition`, `offset`) | integración (PostgreSQL) | Contenido |
| `UPDATE` sobre una fila falla con la excepción del disparador y la fila no cambia | integración | Append-only |
| `DELETE` falla; `TRUNCATE` falla; el recuento no cambia | integración | Append-only |
| `INSERT` de un `event_id` repetido falla por clave primaria | integración | Idempotencia en la base |
| La migración `0003` se aplica desde cero y `migrate status` queda al día | integración | Migración |
| Las consultas por `(tenant_id, occurred_at)` y por `(key, occurred_at)` usan sus índices (`EXPLAIN`) | integración | Índices |
| Extremo a extremo: eventos publicados en Kafka → `auditor` → una fila por evento, **incluido `BidRejected`**, con el mismo evento en `payload` | integración (Kafka + PostgreSQL) | Registro completo |
| El `auditor` y el `projector` consumen el mismo topic de forma independiente: ambos procesan todo | integración | Grupos independientes (spec §4) |
| Un evento entregado dos veces deja una sola fila | integración | Idempotencia de D3 |
| Si el handler falla, no queda fila (transacción revertida) y el reintento escribe una sola vez | integración | Atomicidad |
| El historial de un lote, leído de la bitácora por `key`, reproduce en orden los eventos que se publicaron | integración | Trazabilidad |

**Deliberadamente sin test:** los permisos a nivel de rol (se aplican en H1 y se verifican allí); rendimiento con millones de filas.

---

## 5 · Definition of Done

- [ ] SDD en `docs/sdd/D6/SDD.md`, Estado = Aprobado
- [ ] `audit_log` con migración, índices y disparadores; `UPDATE`/`DELETE`/`TRUNCATE` rechazados
- [ ] El `auditor` registra los 7 tipos, sin duplicados ni transformación
- [ ] Rol de base de datos de solo escritura documentado para H1
- [ ] Tests del §4 en verde; `npm run check` y `npm run test:integration` en verde
- [ ] PR con CI verde y fusionado

---

## 6 · Riesgos

| Riesgo | Gravedad | Mitigación |
|---|---|---|
| Los disparadores no protegen frente al propietario de la tabla | Media | Capa 3: rol de aplicación con solo `INSERT`/`SELECT` en producción (H1); documentado |
| Crecimiento ilimitado de la tabla | Media | Es el propósito de una bitácora; particionado mensual y archivado cuando haga falta |
| La reconstrucción (G2) recorre el log, no la bitácora: no hay que confundir ambas | Baja | Documentado: el log de Kafka es la fuente de verdad; la bitácora es un registro auditable en SQL |
| Una fila de bitácora puede perderse si el `auditor` cae sin reprocesar | Baja | Al menos una vez con idempotencia (D3): al volver, retoma desde el último offset confirmado |
| Datos personales en la bitácora (`payload`) | Media | Los eventos actuales no contienen datos personales (solo UUID); si cambia, se revisa con el contrato (cambio de versión) |

---

## 7 · Preguntas abiertas

1. **Append-only:** ¿disparadores + rol de solo escritura en producción (propuesta)? Sin el rol, un atacante con las credenciales de la aplicación podría borrar la bitácora.
2. **Qué se guarda:** todos los eventos sin filtrar y con su origen en el log (propuesta). ¿De acuerdo en que `BidRejected` se registre aquí aunque el `projector` lo ignore?
3. **Evidencia de manipulación:** ¿basta la inmutabilidad (propuesta) o quieres además anclar un *hash* por tramo periódicamente? Es una evolución posterior, no un requisito de V1.
4. **Acceso de lectura:** por SQL en V1; ¿un endpoint administrativo se deja para después de F1 (propuesta)?
