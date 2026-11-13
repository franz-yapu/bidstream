# bidstream — Roadmap de sprint

**Fecha:** 2026-11-12 · **Repo:** 5ff0e4d · **Backlog:** `2026-11-12 - Backlog-Epics-Tasks.md` · **Board del tracker revisado:** sí, lista bidstream `901115726262` (vacía)

## 1 · Dónde estamos

Actualizado 2026-11-12: Ola 1 completa (7 tareas, 19 h) y de la Ola 2 listas B1, B2, C1, C2, D1–D6, E1–E3, G1 y G2 (63 h).

| Estado | h | Tareas | % |
|---|---:|---:|---:|
| ✅ Listo | 82 | 22 | 54% |
| 🟡 En curso | 0 | 0 | 0% |
| ⬜ Pendiente (desbloqueado) | 20 | 7 | 13% |
| ⛔ Bloqueado por decisión/acceso | 50 | 10 | 33% |

Total: 152 h en 39 tareas.

## 2 · Prioridades — cuatro olas

### Ola 1 — llave/barata · ahora · 19 h

Repo, entorno local, CI, ADR de la clave de partición y el núcleo del dominio (reglas y contrato de eventos). Casi todo cuelga de estas tareas: 0.1 desbloquea 29 de 38 tareas y A2 desbloquea 17.

0.1 (3 h), 0.2 (3 h), 0.3 (2 h), 0.4 (1 h), A1 (5 h), A2 (3 h), A3 (2 h)

### Ola 2 — volumen · sigue · sin decisión pendiente · 83 h

Fase 1 completa (esquema, API de comandos de subastas/lotes, relay, projector, queries GraphQL) más gran parte de la Fase 2 (consumidor base con idempotencia/reintentos/DLQ, notifier, auditor, subscriptions, límites GraphQL), pruebas de integración y reproceso. Paralelizable por epic.

B1 (5 h), B2 (3 h), C1 (5 h), C2 (5 h), D1 (5 h), D2 (3 h), D3 (5 h), D4 (5 h), D5 (3 h), D6 (3 h), D7 (3 h), E1 (5 h), E2 (3 h), E3 (5 h), F4 (3 h), F6 (1 h), G1 (5 h), G2 (3 h), H2 (3 h), H5 (2 h), I1 (5 h), I2 (3 h)

### Ola 3 — esperando una decisión o acceso · 50 h

- **Q1** → H1 (+ cascada: H3, H4)
- **Q2** → C3 (+ cascada: C4, F2, F5)
- **Q4** → F1 (+ cascada: F5)
- **Q5** → F3 (+ cascada: F5)
- **Q3** → D8 (+ cascada: —)

### Ola 4 — decisiones de alcance (sin costo de build)

- **Q6** ¿Row-Level Security por tenant entra en V1? La spec lo marca como opcional.
- **Q7** Valores de negocio: tamaño de la ventana anti-sniping, N minutos de extensión, límite de pujas por minuto y dónde se configuran (env vs por subasta).

## 3 · Listado de tareas

| ID | Módulo | Tarea | Tamaño (h) | Estado | Ola | Ticket | Fuente | Depende de | Bloqueo |
|---|---|---|---:|---|---|---|---|---|---|
| 0.1 | 0 Entorno | Monorepo Node/TypeScript estricto (workspaces: packages/domain, apps/*), lint, format, commitlint | 3 | ✅ Listo | 1 | 868mvtfny | spec §1, §10 | — | — |
| 0.2 | 0 Entorno | docker-compose con Kafka KRaft + PostgreSQL, creación de topics y `make up` | 3 | ✅ Listo | 1 | 868mvtfpc | spec §4, §9 | — | — |
| 0.3 | 0 Entorno | CI base en GitHub Actions: typecheck, lint, test, build | 2 | ✅ Listo | 1 | 868mvtfpx | spec §10 | 0.1 | — |
| 0.4 | 0 Entorno | ADR-0001: clave de partición `lotId` y su intercambio (orden/throughput vs rebalanceo) | 1 | ✅ Listo | 1 | 868mvtfq3 | spec §4 | — | — |
| A1 | A Dominio | Agregado Lot/Auction con las 5 reglas de negocio como funciones puras + tests | 5 | ✅ Listo | 1 | 868mvtfqh | spec §2 | 0.1 | — |
| A2 | A Dominio | Contrato de eventos (7 tipos) con Zod, UUID v7, `version`, `tenantId` | 3 | ✅ Listo | 1 | 868mvtfqz | spec §3 | 0.1 | — |
| A3 | A Dominio | Puertos hexagonales: repositorios, EventPublisher, Clock | 2 | ✅ Listo | 1 | 868mvtfrh | spec §1 | A1, A2 | — |
| B1 | B Datos | Esquema Prisma (§6), migración inicial, índice único parcial de adjudicación (SQL) | 5 | ✅ Listo | 2 | 868mvtxz8 | spec §6 | 0.2 | — |
| B2 | B Datos | Repositorios Prisma de proyección y outbox | 3 | ✅ Listo | 2 | 868mvtxzb | spec §6 | B1, A3 | — |
| C1 | C API comandos | Servidor REST /v1: Zod en el borde, manejo de errores, OpenAPI en /v1/docs, health básico | 5 | ✅ Listo | 2 | 868mvtxzn | spec §7 | 0.1 | — |
| C2 | C API comandos | POST /v1/auctions y /v1/auctions/:id/lots (201 + Location) escribiendo outbox | 5 | ✅ Listo | 2 | 868mvtxzv | spec §7 | B2, C1, A2 | — |
| C3 | C API comandos | POST /v1/lots/:id/bids: 202 Accepted, validación y outbox (BidPlaced/BidRejected) | 8 | ⛔ Bloqueado | 3 | | spec §5, §7 | C2, A1 | Q2: dónde se decide la puja (autoridad) |
| C4 | C API comandos | Cabecera `Idempotency-Key` obligatoria en la puja | 3 | ⛔ Bloqueado | 3 | | spec §5, §7 | C3 | Cascada de Q2 |
| D1 | D Kafka | Relay de outbox → Kafka (polling con FOR UPDATE SKIP LOCKED, `publishedAt`) | 5 | ✅ Listo | 2 | 868mvtxzz | spec §5 | B2, D2 | — |
| D2 | D Kafka | Cliente Kafka compartido: config local y Event Hubs (SASL) sin cambiar código | 3 | ✅ Listo | 2 | 868mvty03 | spec §9 | 0.2 | — |
| D3 | D Kafka | Consumidor base: idempotencia por `eventId`, 3 reintentos con backoff, DLQ con error | 5 | ✅ Listo | 2 | 868mvty09 | spec §5 | D2, B1 | — |
| D4 | D Kafka | Consumidor `projector`: proyección de lote y ranking en PostgreSQL | 5 | ✅ Listo | 2 | 868mvty0d | spec §4, §5 | D3, A2 | — |
| D5 | D Kafka | Consumidor `notifier`: publica a las subscriptions de GraphQL | 3 | ✅ Listo | 2 | 868mvty0f | spec §4 | D3 | — |
| D6 | D Kafka | Consumidor `auditor`: bitácora append-only | 3 | ✅ Listo | 2 | 868mvty0k | spec §4 | D3 | — |
| D7 | D Kafka | Endpoint administrativo para reprocesar el DLQ | 3 | ✅ Listo | 2 | 868mvty0q | spec §5 | D3, C1 | — |
| D8 | D Kafka | Cierre de lotes: quién emite `LotClosed`/`AuctionClosed` y `LotExtended` al llegar `closesAt` | 5 | ⛔ Bloqueado | 3 | | spec §2, §3 | D1, A1 | Q3: mecanismo de cierre (scheduler) no definido |
| E1 | E GraphQL | Servidor GraphQL de lectura: auction, lot, lotBids (cursor), activeLots | 5 | ✅ Listo | 2 | 868mvty0w | spec §7 | B1, C1 | — |
| E2 | E GraphQL | Límites de profundidad y complejidad de consulta | 3 | ✅ Listo | 2 | 868mvty12 | spec §7 | E1 | — |
| E3 | E GraphQL | Subscription `lotUpdated` alimentada por `notifier` | 5 | ✅ Listo | 2 | 868mvty15 | spec §7 | E1, D5 | — |
| F1 | F Seguridad | Auth: JWT corto + refresh revocable, Argon2, bloqueo por intentos, RBAC | 8 | ⛔ Bloqueado | 3 | | spec §8 | C1, B1 | Q4: modelo de usuarios/postores no está en el esquema |
| F2 | F Seguridad | Límite de pujas por postor y minuto, cabeceras de seguridad, CORS con lista blanca | 3 | ⛔ Bloqueado | 3 | | spec §8 | C3 | Cascada de Q2 |
| F3 | F Seguridad | Firma de eventos y verificación en el consumidor | 5 | ⛔ Bloqueado | 3 | | spec §8 | A2, D3 | Q5: algoritmo y gestión de clave de firma |
| F4 | F Seguridad | Logs estructurados con id de correlación | 3 | ⬜ Pendiente | 2 | 868mvty18 | spec §8 | C1 | — |
| F5 | F Seguridad | SECURITY.md con el mapeo OWASP Top 10 | 2 | ⛔ Bloqueado | 3 | | spec §8 | F1, F2, F3, F4, F6 | Cascada de Q2/Q4/Q5 |
| F6 | F Seguridad | `npm audit` en CI y actualizaciones automáticas de dependencias | 1 | ✅ Listo | 2 | 868mvty1c | spec §8 | 0.3 | — |
| G1 | G Calidad | Pruebas de integración con PostgreSQL y Kafka reales (testcontainers) | 5 | ✅ Listo | 2 | 868mvty1g | spec §10 | 0.2, B1 | — |
| G2 | G Calidad | Prueba de reproceso: N eventos, borrar proyección, reconstruir, estado idéntico | 3 | ✅ Listo | 2 | 868mvty1q | spec §5, §10 | D4, G1 | — |
| H1 | H Azure | Bicep: Event Hubs, ACR, PostgreSQL Flexible, Key Vault, Container Apps | 8 | ⛔ Bloqueado | 3 | | spec §9 | 0.2 | Q1: suscripción Azure y presupuesto |
| H2 | H Azure | Dockerfiles de API, relay y consumidores | 3 | ⬜ Pendiente | 2 | 868mvty1v | spec §9 | C1, D1, D4 | — |
| H3 | H Azure | Despliegue de imágenes a Container Apps (pipeline) | 3 | ⛔ Bloqueado | 3 | | spec §9 | H1, H2 | Cascada de Q1 |
| H4 | H Azure | Métricas de consumer lag en Grafana | 5 | ⛔ Bloqueado | 3 | | spec §11 | H3 | Cascada de Q1 |
| H5 | H Azure | Grabar el video del reproceso | 2 | ⬜ Pendiente | 2 | 868mvty20 | spec §5, §12 | G2 | — |
| I1 | I Docs | README (§12) con comparación contra la versión de WebSockets | 5 | ⬜ Pendiente | 2 | 868mvty22 | spec §12 | G2 | — |
| I2 | I Docs | ADRs: outbox, 202 en la puja, GraphQL solo lecturas | 3 | ✅ Listo | 2 | 868mvty26 | spec §10 | A1 | — |

**El board del tracker no es la verdad.** Los estados de esta tabla salen del repo, no del board.

## 4 · Qué preguntar ahora

Ordenado por apalancamiento (h directo + h en cascada).

1. **Suscripción Azure: ¿hay cuenta, créditos y presupuesto para levantar Event Hubs + PostgreSQL Flexible?** `Q1` — *desbloquea 8 directo + 8 en cascada (h).*
2. **Autoridad de la puja: ¿quién decide si una puja es válida? La spec valida contra la proyección (eventualmente consistente, puede dejar pasar dos pujas del mismo monto) y a la vez define el topic `commands.bid` particionado por lotId, que sí daría orden estricto. Elegir entre (a) API valida contra proyección y publica el evento, (b) API publica el comando y un decisor consume `commands.bid` y emite BidPlaced/BidRejected.** `Q2` — *desbloquea 8 directo + 8 en cascada (h).*
3. **Usuarios y postores: el esquema no tiene tabla de usuarios ni credenciales. ¿Se agrega un modelo propio (User/Bidder con Argon2) o se asume un IdP externo?** `Q4` — *desbloquea 8 directo + 2 en cascada (h).*
4. **Firma de eventos: ¿algoritmo (HMAC o Ed25519) y dónde vive la clave en local y en Key Vault?** `Q5` — *desbloquea 5 directo + 2 en cascada (h).*
5. **Cierre de lotes: ¿qué proceso emite `LotClosed`/`LotExtended` al llegar `closesAt` (scheduler en el relay, job propio, timer en el decisor)?** `Q3` — *desbloquea 5 directo + 0 en cascada (h).*

Q2 es la más importante: define la arquitectura del núcleo (dónde se decide una puja) y no se puede dejar para el final sin retrabajo. Conviene resolverla en un ADR antes de arrancar C3, idealmente durante la Ola 2.
