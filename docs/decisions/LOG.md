# Log de decisiones

Append-only. Una entrada por respuesta de stakeholder, resolución de
discrepancia, o decisión de alcance que no queda cubierta por un ADR. Nunca se
edita una entrada pasada — se reemplaza con una nueva que referencia el ID
viejo.

Formato:

```
## DEC-001 — <título corto>
**Fecha:** YYYY-MM-DD · **Fuente:** <quién/dónde> · **Estado:** activa | reemplazada por DEC-XXX

<qué se decidió, en lenguaje llano>
```

## DEC-001 — Metodología: SDD con skills y MCP en Claude Code
**Fecha:** 2026-11-12 · **Fuente:** usuario · **Estado:** activa

El proyecto vive en `~/Documentos/bidstream`. Se trabaja con IA (Claude Code)
usando skills del kit de planificación (prd-to-tickets, write-sdd, task-brief…)
y MCPs, y con SDD (Spec-Driven Development): cada ticket tiene su SDD en
`docs/sdd/<ID>/SDD.md` antes de codear. La spec base es `docs/product/bidstream_spec.md`.

## DEC-002 — Tracker ClickUp y carpeta de Drive
**Fecha:** 2026-11-12 · **Fuente:** usuario · **Estado:** activa

Tickets en ClickUp, lista bidstream `901115726262` en FRANZ's Space (igual que SISET). MCP de Google Drive conectado; carpeta de documentos en Drive: `bidstream` (id 1hZw2PqnTcYj8eV-8ju7VfH12MQZ61GgA).

## DEC-003 — ADR-0001 aceptado y SDD 0.1 en borrador
**Fecha:** 2026-11-12 · **Fuente:** usuario (pidió empezar 0.1 y 0.4) · **Estado:** activa

ADR-0001 (clave de partición `lotId`) escrito y aceptado; cierra el ticket 0.4. SDD de 0.1 en `docs/sdd/0.1/SDD.md`, Estado = Borrador, a la espera de aprobación. Pendientes: (a) npm vs pnpm, (b) `contracts` separado o dentro de `domain` (decidir en A2), (c) crear el remoto de GitHub para PR y CI.

## DEC-004 — SDD 0.1 aprobado e implementado; npm
**Fecha:** 2026-11-12 · **Fuente:** usuario · **Estado:** activa

Gestor de paquetes: **npm** (resuelve la pregunta 1 del SDD 0.1). SDD 0.1 aprobado e implementado (commit `dfc409a`). Pendiente: crear el remoto de GitHub y abrir PR (hace falta para 0.3); `npm audit` moderado en dependencia de desarrollo (minimatch vía ESLint 10) → F6.

## DEC-005 — SDD borrador de 0.2 y A2; preguntas abiertas
**Fecha:** 2026-11-12 · **Fuente:** Claude, a petición del usuario · **Estado:** activa (pendiente de respuesta)

SDD en borrador: `docs/sdd/0.2/SDD.md` y `docs/sdd/A2/SDD.md`. Pendientes de decisión: (A2 #1) clave/topic de `AuctionOpened` y `AuctionClosed`, (A2 #2) `meta` opcional en el sobre, (A2 #3) `LotClosed` anulable sin pujas, (A2 #4) valores de `BidRejected.reason`, (0.2 #1) UI de Kafka opcional. Remoto de GitHub aún sin crear.

## DEC-006 — SDD 0.2 y A2 aprobados con las propuestas de Claude
**Fecha:** 2026-11-12 · **Fuente:** usuario · **Estado:** activa

Aprobados `docs/sdd/0.2` y `docs/sdd/A2` con las propuestas: (A2 #1) `AuctionOpened`/`AuctionClosed` van al mismo topic `events.lot` con clave `auctionId` (sin orden garantizado frente a los `LotClosed`); (A2 #2) `meta` opcional reservado en el sobre; (A2 #3) `LotClosed` con `winnerId` y `finalAmount` anulables; (A2 #4) `BidRejected.reason`: `BID_TOO_LOW`, `LOT_CLOSED`, `LOT_NOT_OPEN`, `LOT_NOT_FOUND`, `DUPLICATE_BID` (se revisa con Q2); (0.2 #1) sin UI de Kafka por ahora. Imagen Kafka fijada: `apache/kafka:4.3.2`.

## DEC-007 — 0.2 y A2 implementados
**Fecha:** 2026-11-12 · **Fuente:** Claude · **Estado:** activa

0.2 implementado (commit `dce8afb`, `make verify` en verde) y A2 implementado (contrato de eventos con Zod, 55 tests). Pendiente: remoto de GitHub y PR; ClickUp sin cambio de estado.

## DEC-008 — Repo en GitHub y SDD borrador de 0.3, A1 y A3
**Fecha:** 2026-11-12 · **Fuente:** usuario · **Estado:** activa (pendiente de respuesta)

Remoto `git@github.com:franz-yapu/bidstream.git` (público) conectado y `main` subido (sin secretos: `.env` y `.clickup.json` ignorados). SDD en borrador: 0.3 (CI; pendiente decidir protección de `main`), A3 (puertos; pendiente si hace falta `UnitOfWork`) y A1 (dominio; pendiente: primera puja `>= startingPrice`, extensión anti-sniping desde `closesAt`, `AuctionClosed` solo sin lotes abiertos, un postor puede subir su propia puja).

## DEC-010 — Ola 1 completa
**Fecha:** 2026-11-12 · **Fuente:** Claude · **Estado:** activa

Ola 1 terminada: 0.1, 0.2, 0.3, 0.4, A1, A2, A3 (19 h). CI verde, `main` protegida (PR + check `check`), 106 tests. ClickUp: los 7 tickets en `completadas`. Nota: 0.1, 0.2, 0.4 y A2 se subieron directo a `main` antes de activar la protección; A1, A3 y 0.3 fueron por PR. Siguiente: Ola 2 (SDD + tickets).

## DEC-011 — Tickets de la Ola 2 creados
**Fecha:** 2026-11-12 · **Fuente:** usuario ("ola 2") · **Estado:** activa

22 tickets de la Ola 2 creados en la lista bidstream de ClickUp (B1, B2, C1, C2, D1–D7, E1–E3, F4, F6, G1, G2, H2, H5, I1, I2; 83 h), asignados al usuario. Cuerpos en `docs/planning/2026-11-12-tickets-ola2/`. Quedan sin ticket las tareas de la Ola 3 (bloqueadas por Q1–Q5). Siguiente: SDD por ticket antes de codear, empezando por B1, C1 y D2.

## DEC-012 — SDD borrador de B1, C1 y D2
**Fecha:** 2026-11-12 · **Fuente:** usuario (pidió los SDD), Claude · **Estado:** activa (pendiente de respuesta)

SDD en borrador: `docs/sdd/B1`, `C1` y `D2`. Hallazgos sobre la spec §6: (1) `ProcessedEvent` con `eventId @id` más `@@unique([eventId, consumer])` impide que dos consumidores registren el mismo evento; se corrige con clave primaria compuesta; (2) el índice único parcial "dos lotes adjudicados" es redundante con la clave primaria de `Lot`; se propone `Bid.awarded` + índice único parcial por lote. Decisiones propuestas: Prisma 7.10.1 en `packages/db`; Fastify 5 + Zod + `problem+json` en `apps/api`; `@confluentinc/kafka-javascript` en `packages/kafka` (`kafkajs` sin mantenimiento desde 2023). Preguntas: ver §7 de cada SDD.

## DEC-013 — SDD de B1, C1 y D2 aprobados con las propuestas; D2 implementado
**Fecha:** 2026-11-12 · **Fuente:** usuario · **Estado:** activa

Aprobados con las propuestas de Claude: (B1) `Bid.awarded` + índice único parcial, `ProcessedEvent` con clave compuesta, cliente Prisma generado en `postinstall` sin versionar, `snake_case`; (C1) Fastify, `problem+json`, `/v1/docs` también en producción, GraphQL en `apps/graphql`; (D2) `@confluentinc/kafka-javascript`. D2 implementado. **Hallazgo:** esa librería no compila en Node 26 (sin binario precompilado, la compilación falla) y funciona con el binario precompilado en Node 22; el proyecto usa Node 22 y no debe subirse a 26 sin repetir el spike. `consumer.stop()` no está implementado.

## DEC-014 — B1 implementado
**Fecha:** 2026-11-12 · **Fuente:** Claude · **Estado:** activa

B1 implementado: `@bidstream/db` (Prisma 7.10.1), migración `0001_init`, 12 pruebas de integración. Correcciones a la spec §6 vigentes: `ProcessedEvent` con clave primaria `(event_id, consumer)`; `Bid.awarded` con índice único parcial por lote en lugar de un índice redundante sobre `Lot`; `Bid.id` = `eventId` del `BidPlaced`. Aviso para D4/E1: en consultas con `amount::text`, calificar la columna en el `ORDER BY`.

## DEC-015 — C1 implementado
**Fecha:** 2026-11-12 · **Fuente:** Claude · **Estado:** activa

C1 implementado: `apps/api` (Fastify 5 + Zod), `/v1/health`, `/v1/docs`, errores `problem+json` con URN, `x-request-id` validado. Arranque: `npm run dev:api` (puerto 3000 por defecto). Las rutas de C2/C3 se añaden como plugins bajo `/v1` en `buildApp`.

## DEC-016 — B1, C1 y D2 completados
**Fecha:** 2026-11-12 · **Fuente:** Claude · **Estado:** activa

B1, C1 y D2 fusionados (PR #8, #9, #10) y en `completadas` en ClickUp. Estado: 10 de 39 tareas, 32 h de 152. 134 tests unitarios y 16 de integración. Siguiente en la Ola 2 (dependencias ya cumplidas): B2 (repositorios Prisma y outbox), D3 (consumidor base), G1 (utilidades de integración), F4, F6, H2 después. Camino crítico: B2 → C2 → D1 → D4.

## DEC-017 — SDD borrador de G1, B2 y D3
**Fecha:** 2026-11-12 · **Fuente:** usuario ("vamos las tareas"), Claude · **Estado:** activa (pendiente de respuesta)

SDD en borrador: `docs/sdd/G1`, `B2`, `D3`. Propuestas: G1 contra `make up` (sin testcontainers) con bases y topics desechables, paquete `@bidstream/testing` y job `integration` en la CI (no requerido al principio); B2 con `OutboxMessage.id = eventId`, `withTransaction` en `@bidstream/db` y repositorios de solo lectura filtrados por tenant; D3 con 4 intentos (200 ms, factor 2, jitter), idempotencia en la misma transacción que el handler, DLQ con el error adjunto, paquete `@bidstream/consumer`. Riesgo a decidir (D3 §7 #2): ¿DLQ y seguir, o pausar la partición ante un fallo persistente del `projector`?

## DEC-018 — SDD de G1, B2 y D3 aprobados con las propuestas; G1 implementado
**Fecha:** 2026-11-12 · **Fuente:** usuario · **Estado:** activa

Aprobados con las propuestas de Claude: (G1) `make up`, job `integration` no obligatorio al principio, logs solo en el job; (B2) `OutboxMessage.id = eventId`, `withTransaction` en `@bidstream/db`, consultas de pendientes del relay en el mismo repositorio; (D3) 4 intentos totales (200 ms, factor 2, jitter), paquete `@bidstream/consumer`, gancho de logger ahora y métricas en H4; ante fallo persistente del `projector`, DLQ y seguir (como pide la spec), mitigado con D7 y G2. G1 implementado: `@bidstream/testing` y job `integration`. **Pendiente de decidir más adelante:** hacer `integration` check requerido de `main` tras una semana estable.

## DEC-019 — B2 implementado
**Fecha:** 2026-11-12 · **Fuente:** Claude · **Estado:** activa

B2 implementado: `PrismaLotRepository`, `PrismaAuctionRepository`, `PrismaOutbox` y `withTransaction` en `@bidstream/db`. Uso: `withTransaction(prisma, async ({ lots, outbox }) => { ... outbox.enqueue(events, TOPICS.eventsLot) })` (el topic lo pasa la app; `db` no depende de `kafka`). Atomicidad lectura + outbox verificada; la carrera entre pujas sigue ligada a Q2.

## DEC-020 — D3 implementado
**Fecha:** 2026-11-12 · **Fuente:** Claude · **Estado:** activa

D3 implementado: `@bidstream/consumer` con `createEventConsumer({ kafka, prisma, consumerName, handler, ... })` para `projector`, `notifier` y `auditor`. Idempotencia por `(eventId, consumer)` en la misma transacción que el handler; 4 intentos con backoff y jitter; DLQ con `dlqMessageSchema` (lo leerá D7); `onOutcome` para métricas. Riesgo aceptado y vigente: un evento en DLQ no detiene a los siguientes del mismo lote.

## DEC-021 — G1, B2 y D3 completados
**Fecha:** 2026-11-12 · **Fuente:** Claude · **Estado:** activa

G1, B2 y D3 fusionados (PR #13, #15, #16) y en `completadas` en ClickUp. Estado: 13 de 39 tareas, 45 h de 152. 153 pruebas unitarias y 47 de integración; la CI corre ambos conjuntos (job `integration` no requerido por ahora). Siguiente en la Ola 2: C2 (comandos de subastas y lotes), D1 (relay de outbox), D4/D5/D6 (consumidores), E1 (GraphQL), F4, F6, H2. Camino crítico: C2 → D1 → D4.

## DEC-022 — SDD borrador de C2, D1 y D4
**Fecha:** 2026-11-12 · **Fuente:** usuario (pidió los SDD), Claude · **Estado:** activa (pendiente de respuesta)

SDD en borrador: `docs/sdd/C2`, `D1` y `D4`. Hallazgos al cruzar la spec con el código: (1) D1: varios relays con `SKIP LOCKED` romperían el orden por lote; propuesta un relay activo con bloqueo asesor y standby. (2) D1/C3: `created_at` es el inicio de la transacción, no el *commit*; los comandos de un mismo lote deben serializarse al escribir (`SELECT … FOR UPDATE` sobre el lote) para que el orden del outbox sea el de decisión; es un requisito para C3 y Q2. (3) D4: `AuctionOpened` (clave `auctionId`) y `LotPublished` (clave `lotId`) van a particiones distintas sin orden entre sí; en un reproceso la clave foránea `lot.auction_id` fallaría; propuesta eliminarla (migración 0002) y validar la subasta en C2. (4) D4: reiniciar la proyección exige borrar también `processed_event` del `projector`. (5) C2: la proyección es eventualmente consistente (404 con `Retry-After` si la subasta aún no se proyectó) y el tenant provisional por cabecera queda prohibido en producción; mientras F1 siga bloqueado por Q4, la API no puede ejecutarse en producción. Preguntas: §7 de cada SDD.

## DEC-023 — SDD de C2, D1 y D4 aprobados con las propuestas; C2 implementado
**Fecha:** 2026-11-12 · **Fuente:** usuario ("si aceptas todo") · **Estado:** activa

Aprobados con todas las propuestas de Claude: (C2) tenant por cabecera solo fuera de producción, 404 con `Retry-After`, `Location` sin `GET`, reglas numéricas, sin idempotencia en C2; (D1) un relay activo con bloqueo asesor y standby, lote de 100 y sondeo de 200 ms, limpieza del outbox en un ticket posterior, y los comandos de un mismo lote deben serializarse al escribir (requisito para C3/Q2); (D4) eliminar `lot_auction_id_fkey` (migración 0002), `LotClosed` estricto, `BidRejected` sin efecto y `resetProjection` solo como función. C2 implementado: `POST /v1/auctions` y `POST /v1/auctions/:id/lots`. **Consecuencia vigente:** la API no arranca con `NODE_ENV=production` hasta que F1 aporte autenticación (Q4); hay que decidirlo antes de desplegar en Azure (H1).

## DEC-024 — D1 implementado
**Fecha:** 2026-11-12 · **Fuente:** Claude · **Estado:** activa

D1 implementado: `apps/relay` (`@bidstream/relay`) publica el outbox en Kafka en orden y al menos una vez, con un solo relay activo (bloqueo asesor de sesión) y standby. Arranque: `npm run dev:relay`. **Requisito vigente para C3/Q2:** el orden de publicación es el de `(created_at, id)`, y `created_at` es el inicio de la transacción; los comandos de un mismo lote deben serializarse al escribir (`SELECT … FOR UPDATE` sobre el lote) para que ese orden sea el de decisión.

## DEC-025 — D4 implementado: primer flujo completo
**Fecha:** 2026-11-12 · **Fuente:** Claude · **Estado:** activa

D4 implementado: `apps/projector` y `applyEventToProjection`/`resetProjection` en `@bidstream/db`; migración 0002 (sin FK lote → subasta). Con C2, D1 y D4 funciona el primer flujo completo API → outbox → relay → Kafka → projector → PostgreSQL, comprobado con pruebas de integración y con los tres procesos reales. Arranque local: `make up && make migrate`, y en tres terminales `npm run dev:api`, `npm run dev:relay` y `npm run dev:projector`. **Para reprocesar (G2):** `resetProjection` borra también `processed_event` del `projector`; sin eso todos los eventos se ignoran como duplicados.

## DEC-026 — C2, D1 y D4 completados
**Fecha:** 2026-11-12 · **Fuente:** Claude · **Estado:** activa

C2, D1 y D4 fusionados (PR #19, #20, #21) y en `completadas` en ClickUp. Estado: 16 de 39 tareas, 60 h de 152. 159 pruebas unitarias y 104 de integración; la CI corre ambos conjuntos. **Primer flujo completo de punta a punta funcionando.** Quedan en la Ola 2: D5 (notifier), D6 (auditor), D7 (reproceso del DLQ), E1/E2/E3 (GraphQL), F4 (logs con correlación), F6 (auditoría de dependencias), H2 (Dockerfiles), G2 (prueba de reproceso), H5 (vídeo), I1/I2 (README y ADRs). **Antes de la Ola 3:** decidir Q2 (autoridad de la puja) y Q4 (autenticación), porque la API no arranca en producción sin F1.

## DEC-027 — SDD borrador de G2, D5 y D6
**Fecha:** 2026-11-12 · **Fuente:** usuario (pidió los SDD), Claude · **Estado:** activa (pendiente de respuesta)

SDD en borrador: `docs/sdd/G2`, `D5` y `D6`. Hallazgos al cruzar la spec con el código y las librerías: (1) G2: `@confluentinc/kafka-javascript` no implementa `setOffsets`/`resetOffsets`; para «reposicionar a `earliest`» se usa `deleteGroups` sobre un grupo vacío, con el orden `resetProjection` → `deleteGroup` y el comando idempotente. (2) D5: un consumidor por réplica del servidor GraphQL con el mismo grupo repartiría los eventos entre réplicas, y un grupo por instancia chocaría con el límite de grupos de Azure Event Hubs (a verificar en H1); se propone un único grupo `notifier` que difunde con `LISTEN/NOTIFY` de PostgreSQL, dentro de la transacción de D3, con notificaciones derivadas solo del evento y sin identidad de postor. (3) D6: `audit_log` append-only con disparadores y, en producción, un rol de base de datos de solo `INSERT`/`SELECT`; sin cadena de hashes porque exigiría un orden global. Preguntas: §7 de cada SDD.

## DEC-028 — SDD de G2, D5 y D6 aprobados con las propuestas; D6 implementado
**Fecha:** 2026-11-12 · **Fuente:** usuario · **Estado:** activa

Aprobados con las propuestas de Claude: (G2) reposicionar con `deleteGroups` sobre un grupo vacío (el cliente no implementa `setOffsets`), comando en `apps/projector` con `--yes`, generador de historiales en `@bidstream/testing` y solo la prueba de ~150 eventos en la CI; (D5) un único grupo `notifier` que difunde con `LISTEN/NOTIFY` dentro de la transacción de D3, notificaciones sin `bidderId` ni `winnerId`, `BidRejected` sin notificación pública, aviso de resincronización al reconectar y paquete `@bidstream/notifier` más `apps/notifier`; (D6) disparadores más rol de solo escritura, todos los eventos, sin cadena de hashes y consulta por SQL. D6 implementado: `audit_log` (migración 0003) y `apps/auditor`. **Pendiente para H1:** el rol de base de datos de solo `INSERT`/`SELECT` sobre `audit_log`.

## DEC-029 — G2 implementado
**Fecha:** 2026-11-12 · **Fuente:** Claude · **Estado:** activa

G2 implementado: reproceso de la proyección desde el log. `npm run reprocess -w @bidstream/projector -- --yes` borra la proyección, reposiciona el grupo `projector` a `earliest` (borrando el grupo vacío con `deleteGroups`, porque el cliente no implementa `setOffsets`) y reconstruye. La prueba demuestra que reconstruir con dos consumidores en paralelo, o con uno, deja exactamente el mismo estado que la línea base y que el estado que calcula el dominio. Utilidades nuevas: `createKafkaAdmin` (estado de grupos y lag, base de H4) y `generateHistory` (base de H5). **Lección operativa:** los procesos de demostración deben arrancarse con `node --import tsx` o terminarse junto con su hijo; `kill` sobre el envoltorio `tsx` deja el proceso `node` vivo y ocupa el grupo.

## DEC-030 — D5 implementado
**Fecha:** 2026-11-12 · **Fuente:** Claude · **Estado:** activa

D5 implementado: `@bidstream/notifier` (contrato, `NOTIFY`, bus, oyente) y `apps/notifier`. Un único grupo `notifier` difunde con `LISTEN/NOTIFY` dentro de la transacción de D3; las réplicas del servidor GraphQL escuchan el canal `lot_updates`. Notificaciones públicas sin identidad de postor. Entrega best-effort con aviso de resincronización. Arranque local: `npm run dev:notifier`. **Pendiente para H1:** verificar `LISTEN` contra la base de datos de Azure y los límites de grupos de Event Hubs. **Siguiente natural:** E1/E3 (GraphQL) consumen este bus.

## DEC-031 — D6, G2 y D5 completados
**Fecha:** 2026-11-12 · **Fuente:** Claude · **Estado:** activa

D6, G2 y D5 fusionados (PR #24, #25, #26) y en `completadas` en ClickUp. Estado: 19 de 39 tareas, 69 h de 152. 186 pruebas unitarias y 143 de integración. Los **seis consumidores/procesos del núcleo** están hechos: API, relay, projector, auditor, notifier y la herramienta de reproceso. Quedan en la Ola 2: D7 (reproceso del DLQ), E1/E2/E3 (GraphQL), F4 (logs con correlación), F6 (auditoría de dependencias), H2 (Dockerfiles), H5 (vídeo del reproceso), I1/I2 (README y ADRs). **Pendientes de la sesión:** terminar procesos de demostración que se dejaron vivos (ver nota abajo) y ejecutar el reproceso de extremo a extremo con procesos reales (H5).

## DEC-032 — SDD borrador de E1, E2 y E3
**Fecha:** 2026-11-12 · **Fuente:** usuario (pidió los SDD), Claude · **Estado:** activa (pendiente de respuesta)

SDD en borrador: `docs/sdd/E1`, `E2` y `E3`. Hallazgos: (1) la spec solo da las firmas de `Query` y `Subscription`; los tipos `Auction`, `Lot`, `Bid`, `BidConnection` y `LotUpdate` hay que diseñarlos, y la proyección guarda la identidad de postores y ganadores que D5 decidió no difundir: se propone no exponerla en ninguna lectura hasta F1. (2) E2: `@escape.tech/graphql-armor` no se actualiza desde diciembre de 2025 y su coste no multiplica por el tamaño de página; se propone reglas propias de profundidad y alias más `graphql-query-complexity` con un estimador que multiplica por `first` (valores: profundidad 7, complejidad 1 000, 15 alias, 2 000 tokens, `first` ≤ 100, 100 KB). (3) E3: SSE de Yoga como transporte (sin dependencias nuevas; admite cabeceras), `LotUpdate` como unión con `ResyncRequired`, cola acotada y límite de suscripciones por tenant; requiere `subscriptionCount()` en el bus de D5. Propuesta de versión: `graphql` 16.x salvo que un *spike* demuestre compatibilidad con 17.1.0. Preguntas: §7 de cada SDD.

## DEC-033 — SDD de E1, E2 y E3 aprobados con las propuestas; E1 implementado
**Fecha:** 2026-11-12 · **Fuente:** usuario («probados con tus propuestas», entendido como aprobados) · **Estado:** activa

Aprobados con las propuestas de Claude: (E1) Yoga schema-first sin identidad de postores, listas acotadas, `nextMinimumBid`, `graphql` 16.x y tenant provisional prohibido en producción; (E2) reglas propias de profundidad y alias más `graphql-query-complexity` con estimador por `first`, valores 7/1 000/15/2 000/100 KB/100, introspección desactivada en producción, `first` fuera de rango rechazado y consultas persistidas como evolución; (E3) SSE de Yoga, `LotUpdate` como unión con `ResyncRequired`, comprobación de existencia del lote, cola de 50 y 500 suscripciones por tenant, y la prueba de flujo completo dentro del ticket. E1 implementado: `apps/graphql` (`npm run dev:graphql`, puerto 4000). Nota: `Lot.auction` es nulo-able por la consistencia eventual.

## DEC-034 — E2 implementado
**Fecha:** 2026-11-12 · **Fuente:** Claude · **Estado:** activa

E2 implementado: límites de profundidad (7), complejidad (1 000, con coste por `first`), alias (15), tokens (2 000) y cuerpo (100 KB), *batching* desactivado e introspección configurable. Los rechazos ocurren antes de ejecutar resolvers. **Nota para clientes:** para recibir 400 en errores de validación hay que enviar `Accept: application/graphql-response+json`; con `application/json` Yoga responde 200 con los errores en el cuerpo. **Mejora pendiente:** cortar en streaming los cuerpos sin `content-length`.

## DEC-035 — E3 implementado: el núcleo funciona de punta a punta
**Fecha:** 2026-11-12 · **Fuente:** Claude · **Estado:** activa

E3 implementado: `Subscription.lotUpdated` por SSE con cola acotada, cupo por tenant, comprobación de existencia y aviso `ResyncRequired`. **Con E3 los seis procesos del núcleo funcionan juntos**, demostrado con una prueba de flujo completo con todo real (API → relay → Kafka → projector y notifier → PostgreSQL → GraphQL consulta y subscription). `npm run dev:graphql` arranca consultas y subscriptions (puerto 4000). Para recibir errores previos al flujo con su código HTTP, los clientes deben aceptar `application/graphql-response+json`. **Pendiente para H1:** `LISTEN` y SSE de larga duración en Azure.

## DEC-036 — E1, E2 y E3 completados: el núcleo funciona de punta a punta
**Fecha:** 2026-11-12 · **Fuente:** Claude · **Estado:** activa

E1, E2 y E3 fusionados (PR #29, #30, #31) y en `completadas` en ClickUp. Estado: 22 de 39 tareas, 82 h de 152. 238 pruebas unitarias y 190 de integración. **El núcleo completo funciona de punta a punta**: API REST → outbox → relay → Kafka → projector, notifier y auditor → PostgreSQL → GraphQL (consultas y subscriptions), con el reproceso desde el log. Quedan en la Ola 2: D7 (reproceso del DLQ), F4 (logs con correlación), F6 (auditoría de dependencias), H2 (Dockerfiles), H5 (vídeo del reproceso), I1 (README) e I2 (ADRs). La **Ola 3** (50 h) sigue bloqueada por decisiones: Q2 (autoridad de la puja), Q4 (autenticación/usuarios), Q5 (firma de eventos), Q3 (cierre de lotes) y Q1 (suscripción Azure).

## DEC-037 — SDD borrador de D7, F6 e I2
**Fecha:** 2026-11-13 · **Fuente:** usuario («si a todo»), Claude · **Estado:** activa (pendiente de respuesta)

SDD en borrador: `docs/sdd/D7`, `F6` e `I2`. Hallazgos: (1) D7: el DLQ de D3 no conserva las cabeceras del mensaje original, así que un evento que vuelve a fallar tras reprocesarse haría un bucle infinito; se propone un campo opcional `reprocessCount` en el mensaje DLQ y un tope de 3; republicar añade el evento al final de su partición, de modo que el consumidor que lo rechazó lo ve después de los posteriores del mismo lote (limitación documentada; para integridad de la proyección, el reproceso completo de G2). Protección provisional con `X-Admin-Key`, rutas inexistentes sin clave. (2) F6: `npm audit` da 10 avisos moderados, todos de desarrollo por `minimatch` 10.2.6 (afectado <11.0.1), 0 en producción; existe la 11.0.8; se propone política «cualquier aviso en producción o alto/crítico en todo» y un `overrides` si ESLint lo soporta. (3) I2: más allá de los 3 ADRs del ticket, 6 decisiones ya implementadas (sin FK entre agregados, un relay, idempotencia y DLQ, `LISTEN/NOTIFY`, reproceso, tenant provisional) merecen ADR; ADR-0003 (`202`) documenta una decisión aún sin implementar (C3, Q2). Preguntas: §7 de cada SDD.

## DEC-038 — SDD de D7, F6 e I2 aprobados con las propuestas; F6 implementado
**Fecha:** 2026-11-13 · **Fuente:** usuario · **Estado:** activa

Aprobados con las propuestas de Claude: (D7) clave de servicio `X-Admin-Key` con rutas inexistentes sin clave, dos modos (pendientes por offset y selectivo por `eventId`), tope de 3 reprocesos con `reprocessCount` en el DLQ, importación diferida de Kafka en la API y los `poison` se quedan en el DLQ; (F6) política de auditoría, `overrides` de `minimatch`, flujo `security` no requerido al principio, mayores ignoradas y `dependency-review` como evolución; (I2) los 3 ADRs del ticket más 6 de decisiones implementadas, ADR-0003 con estado Aceptada y una nota, ADR del tenant provisional y pruebas de documentación. F6 implementado: `npm audit` baja de 10 avisos moderados a 0 con `overrides: { minimatch: ^11.0.8 }`. **Pendiente:** exigir `security` como check de `main` tras una semana estable.

## DEC-039 — D7 implementado: reproceso del DLQ por HTTP
**Fecha:** 2026-11-13 · **Fuente:** Claude · **Estado:** activa

`GET /v1/admin/dlq` y `POST /v1/admin/dlq/reprocess` con `X-Admin-Key` (rutas inexistentes sin `ADMIN_API_KEY`), modos pendientes y selectivo, tope de 3 reprocesos, 409 si hay otro reproceso en marcha. Limitación documentada: el evento reprocesado llega al final de su partición. Sigue siendo provisional hasta F1 (Q4).

## DEC-040 — I2 implementado: nueve ADR con evidencia verificable
**Fecha:** 2026-11-13 · **Fuente:** Claude · **Estado:** activa

ADR 0002–0010 (outbox, `202` en la puja, GraphQL solo lecturas, proyección sin FK, un relay, idempotencia y DLQ, `LISTEN/NOTIFY`, reproceso desde el log, tenant provisional), con alternativas y «Verificación» comprobada por pruebas. ADR-0003 está aceptado pero sin implementar (C3, Q2).
