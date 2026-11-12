# bidstream — Backlog: Epics & Tasks

**Fecha:** 2026-11-12 · **Fuente:** docs/product/PRD.md (+ scope.md, business-rules.md, bidstream_spec.md) · **Repo:** 5ff0e4d (sin código todavía)

**Stack detectado:** ninguno (greenfield). Stack objetivo según la spec: Node.js + TypeScript, Kafka (KRaft local / Event Hubs), PostgreSQL + Prisma, GraphQL, Bicep.

**Unidad de tamaño:** horas de trabajo estimadas (h); ningún ticket supera 8 h.

**Leyenda de Tier:**
- 🟢 nativo/config
- 🟡 net-new, validado (la spec lo describe)
- 🔴 net-new, sin diseñar (la spec tiene un hueco)
- 🛑 bloqueado — se nombra el bloqueo en cada tarea

---

## Epic 0 Entorno

| ID | Tarea | Tier | h | Depende de | Notas |
|---|---|---|---:|---|---|
| 0.1 | Monorepo Node/TypeScript estricto (workspaces: packages/domain, apps/*), lint, format, commitlint | 🟢 | 3 | — |  |
| 0.2 | docker-compose con Kafka KRaft + PostgreSQL, creación de topics y `make up` | 🟡 | 3 | — | Topics: commands.bid, events.lot (retención ilimitada), events.lot.dlq |
| 0.3 | CI base en GitHub Actions: typecheck, lint, test, build | 🟢 | 2 | 0.1 |  |
| 0.4 | ADR-0001: clave de partición `lotId` y su intercambio (orden/throughput vs rebalanceo) | 🟡 | 1 | — | Primer ADR; el texto lo pide la spec |

---

## Epic A Dominio

| ID | Tarea | Tier | h | Depende de | Notas |
|---|---|---|---:|---|---|
| A1 | Agregado Lot/Auction con las 5 reglas de negocio como funciones puras + tests | 🟡 | 5 | 0.1 | Sin dependencias de infraestructura |
| A2 | Contrato de eventos (7 tipos) con Zod, UUID v7, `version`, `tenantId` | 🟡 | 3 | 0.1 |  |
| A3 | Puertos hexagonales: repositorios, EventPublisher, Clock | 🟡 | 2 | A1, A2 |  |

---

## Epic B Datos

| ID | Tarea | Tier | h | Depende de | Notas |
|---|---|---|---:|---|---|
| B1 | Esquema Prisma (§6), migración inicial, índice único parcial de adjudicación (SQL) | 🟡 | 5 | 0.2 | Dinero Decimal(12,2); índice compuesto del desempate |
| B2 | Repositorios Prisma de proyección y outbox | 🟡 | 3 | B1, A3 |  |

---

## Epic C API comandos

| ID | Tarea | Tier | h | Depende de | Notas |
|---|---|---|---:|---|---|
| C1 | Servidor REST /v1: Zod en el borde, manejo de errores, OpenAPI en /v1/docs, health básico | 🟡 | 5 | 0.1 |  |
| C2 | POST /v1/auctions y /v1/auctions/:id/lots (201 + Location) escribiendo outbox | 🟡 | 5 | B2, C1, A2 | AuctionOpened, LotPublished |
| C3 | POST /v1/lots/:id/bids: 202 Accepted, validación y outbox (BidPlaced/BidRejected) | 🔴 | 8 | C2, A1 | La spec valida contra la proyección (eventualmente consistente) pero define también el topic commands.bid **Bloqueo:** Q2: dónde se decide la puja (autoridad) |
| C4 | Cabecera `Idempotency-Key` obligatoria en la puja | 🟡 | 3 | C3 | **Bloqueo:** Cascada de Q2 |

---

## Epic D Kafka

| ID | Tarea | Tier | h | Depende de | Notas |
|---|---|---|---:|---|---|
| D1 | Relay de outbox → Kafka (polling con FOR UPDATE SKIP LOCKED, `publishedAt`) | 🟡 | 5 | B2, D2 |  |
| D2 | Cliente Kafka compartido: config local y Event Hubs (SASL) sin cambiar código | 🟡 | 3 | 0.2 |  |
| D3 | Consumidor base: idempotencia por `eventId`, 3 reintentos con backoff, DLQ con error | 🟡 | 5 | D2, B1 |  |
| D4 | Consumidor `projector`: proyección de lote y ranking en PostgreSQL | 🟡 | 5 | D3, A2 |  |
| D5 | Consumidor `notifier`: publica a las subscriptions de GraphQL | 🟡 | 3 | D3 |  |
| D6 | Consumidor `auditor`: bitácora append-only | 🟡 | 3 | D3 |  |
| D7 | Endpoint administrativo para reprocesar el DLQ | 🟡 | 3 | D3, C1 | Requiere rol admin (F1) para producción |
| D8 | Cierre de lotes: quién emite `LotClosed`/`AuctionClosed` y `LotExtended` al llegar `closesAt` | 🔴 | 5 | D1, A1 | La spec define los eventos pero no el disparador **Bloqueo:** Q3: mecanismo de cierre (scheduler) no definido |

---

## Epic E GraphQL

| ID | Tarea | Tier | h | Depende de | Notas |
|---|---|---|---:|---|---|
| E1 | Servidor GraphQL de lectura: auction, lot, lotBids (cursor), activeLots | 🟡 | 5 | B1, C1 |  |
| E2 | Límites de profundidad y complejidad de consulta | 🟡 | 3 | E1 |  |
| E3 | Subscription `lotUpdated` alimentada por `notifier` | 🟡 | 5 | E1, D5 |  |

---

## Epic F Seguridad

| ID | Tarea | Tier | h | Depende de | Notas |
|---|---|---|---:|---|---|
| F1 | Auth: JWT corto + refresh revocable, Argon2, bloqueo por intentos, RBAC | 🔴 | 8 | C1, B1 | El esquema no tiene tabla de usuarios ni credenciales **Bloqueo:** Q4: modelo de usuarios/postores no está en el esquema |
| F2 | Límite de pujas por postor y minuto, cabeceras de seguridad, CORS con lista blanca | 🟡 | 3 | C3 | **Bloqueo:** Cascada de Q2 |
| F3 | Firma de eventos y verificación en el consumidor | 🔴 | 5 | A2, D3 | **Bloqueo:** Q5: algoritmo y gestión de clave de firma |
| F4 | Logs estructurados con id de correlación | 🟡 | 3 | C1 |  |
| F5 | SECURITY.md con el mapeo OWASP Top 10 | 🟡 | 2 | F1, F2, F3, F4, F6 | **Bloqueo:** Cascada de Q2/Q4/Q5 |
| F6 | `npm audit` en CI y actualizaciones automáticas de dependencias | 🟢 | 1 | 0.3 |  |

---

## Epic G Calidad

| ID | Tarea | Tier | h | Depende de | Notas |
|---|---|---|---:|---|---|
| G1 | Pruebas de integración con PostgreSQL y Kafka reales (testcontainers) | 🟡 | 5 | 0.2, B1 |  |
| G2 | Prueba de reproceso: N eventos, borrar proyección, reconstruir, estado idéntico | 🟡 | 3 | D4, G1 |  |

---

## Epic H Azure

| ID | Tarea | Tier | h | Depende de | Notas |
|---|---|---|---:|---|---|
| H1 | Bicep: Event Hubs, ACR, PostgreSQL Flexible, Key Vault, Container Apps | 🛑 | 8 | 0.2 | **Bloqueo:** Q1: suscripción Azure y presupuesto |
| H2 | Dockerfiles de API, relay y consumidores | 🟢 | 3 | C1, D1, D4 |  |
| H3 | Despliegue de imágenes a Container Apps (pipeline) | 🛑 | 3 | H1, H2 | **Bloqueo:** Cascada de Q1 |
| H4 | Métricas de consumer lag en Grafana | 🟡 | 5 | H3 | **Bloqueo:** Cascada de Q1 |
| H5 | Grabar el video del reproceso | 🟡 | 2 | G2 | Entregable del README |

---

## Epic I Docs

| ID | Tarea | Tier | h | Depende de | Notas |
|---|---|---|---:|---|---|
| I1 | README (§12) con comparación contra la versión de WebSockets | 🟡 | 5 | G2 | Se completa al final de cada fase |
| I2 | ADRs: outbox, 202 en la puja, GraphQL solo lecturas | 🟡 | 3 | A1 |  |

---

## Preguntas abiertas

1. **Suscripción Azure: ¿hay cuenta, créditos y presupuesto para levantar Event Hubs + PostgreSQL Flexible?** `Q1` — desbloquea 8 h directo + 8 h en cascada (H1).
2. **Autoridad de la puja: ¿quién decide si una puja es válida? La spec valida contra la proyección (eventualmente consistente, puede dejar pasar dos pujas del mismo monto) y a la vez define el topic `commands.bid` particionado por lotId, que sí daría orden estricto. Elegir entre (a) API valida contra proyección y publica el evento, (b) API publica el comando y un decisor consume `commands.bid` y emite BidPlaced/BidRejected.** `Q2` — desbloquea 8 h directo + 8 h en cascada (C3).
4. **Usuarios y postores: el esquema no tiene tabla de usuarios ni credenciales. ¿Se agrega un modelo propio (User/Bidder con Argon2) o se asume un IdP externo?** `Q4` — desbloquea 8 h directo + 2 h en cascada (F1).
5. **Firma de eventos: ¿algoritmo (HMAC o Ed25519) y dónde vive la clave en local y en Key Vault?** `Q5` — desbloquea 5 h directo + 2 h en cascada (F3).
3. **Cierre de lotes: ¿qué proceso emite `LotClosed`/`LotExtended` al llegar `closesAt` (scheduler en el relay, job propio, timer en el decisor)?** `Q3` — desbloquea 5 h directo + 0 h en cascada (D8).
