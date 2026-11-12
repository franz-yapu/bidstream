# bidstream — especificación

**Motor de subastas en tiempo real orientado a eventos.** Kafka, event sourcing, proyecciones, GraphQL y despliegue en Azure. Para cualquier tipo de producto: arte, maquinaria, vehículos, ganado, liquidaciones.

> Implementación anterior del mismo dominio, con WebSockets y bloqueos en base de datos:
> `github.com/franz-yapu/subastas-cafe-api`. El README compara ambas.

---

## 1. Por qué existe este proyecto

Cubrir, con código público y verificable, el perfil técnico que piden las vacantes de backend orientado a eventos.

| Requisito del perfil | Dónde queda demostrado en bidstream |
| --- | --- |
| **Node.js** | API de comandos, relay de outbox y tres consumidores, todo en Node con TypeScript estricto |
| **RESTful Services** | API de comandos REST con versionado, códigos de estado correctos, idempotencia y OpenAPI |
| **Apache Kafka** | Topics con clave de partición, consumer groups, offsets, retención, reproceso desde el log y dead-letter topic |
| **PostgreSQL** | Proyecciones, índices parciales, transacciones, `Decimal` para dinero, Row-Level Security opcional por tenant |
| **Prisma ORM** | Esquema, migraciones versionadas y acceso a datos de la proyección y del outbox |
| **Clean Code** | Arquitectura hexagonal, dominio sin dependencias de infraestructura, ADRs con las decisiones |
| **Agile** | Tablero público, ADRs fechados, conventional commits, PR con CI obligatoria |
| **OWASP** | `SECURITY.md` que mapea el Top 10 contra lo implementado |
| **Microsoft Azure** | Event Hubs (endpoint Kafka), Container Apps, PostgreSQL Flexible Server, Key Vault, todo con Bicep |
| **GraphQL** | API de lectura con queries y subscriptions alimentadas desde Kafka |

**Nota de honestidad.** Un proyecto propio no equivale a años de producción. Esto te permite conversar Kafka, GraphQL y Azure desde la experiencia y no desde la teoría, y tener algo que el entrevistador puede abrir. Va en la sección de **proyectos** del CV, nunca en habilidades como si fuera experiencia profesional.

---

## 2. El dominio

Entidades: **Subasta** (`Auction`), **Lote** (`Lot`), **Puja** (`Bid`), **Postor** (`Bidder`).

Reglas de negocio:

1. Una puja es válida si supera el precio actual del lote más el incremento mínimo.
2. A igual monto gana la primera en el tiempo.
3. Si entra una puja dentro de la ventana anti-sniping, el cierre del lote se extiende N minutos.
4. Al cerrar, el lote se adjudica al mejor postor y se emite el evento de adjudicación.
5. Un lote nunca puede adjudicarse dos veces.

---

## 3. Modelo de eventos

Todos los eventos llevan: `eventId` (UUID v7), `type`, `occurredAt`, `tenantId`, `version` y el payload.

| Evento | Payload |
| --- | --- |
| `AuctionOpened` | `auctionId`, `title`, `opensAt`, `closesAt` |
| `LotPublished` | `lotId`, `auctionId`, `title`, `startingPrice`, `minIncrement`, `currency`, `closesAt` |
| `BidPlaced` | `lotId`, `bidderId`, `amount`, `placedAt` |
| `BidRejected` | `lotId`, `bidderId`, `amount`, `reason` |
| `LotExtended` | `lotId`, `newClosesAt`, `reason: "anti-sniping"` |
| `LotClosed` | `lotId`, `winnerId`, `finalAmount` |
| `AuctionClosed` | `auctionId` |

El log de eventos es la **fuente de verdad**. Todo lo demás es derivable.

---

## 4. Topics de Kafka

| Topic | Clave | Particiones | Retención | Para qué |
| --- | --- | --- | --- | --- |
| `bidstream.commands.bid` | `lotId` | 6 | 7 días | Comandos de puja entrantes |
| `bidstream.events.lot` | `lotId` | 6 | **ilimitada (compact=off)** | Log de eventos de dominio |
| `bidstream.events.lot.dlq` | `lotId` | 1 | 30 días | Eventos que fallaron tras los reintentos |

**La decisión central: la clave de partición es `lotId`.** Todas las pujas de un mismo lote caen en la misma partición y se procesan en orden estricto. Eso reemplaza al *advisory lock* de la implementación anterior: el orden ya no lo impone un bloqueo en la base, lo impone la partición.

Documenta en un ADR el intercambio: ganas orden y throughput horizontal, pierdes la posibilidad de rebalancear lotes calientes entre particiones.

### Consumer groups

| Grupo | Qué hace |
| --- | --- |
| `projector` | Construye la proyección en PostgreSQL (estado actual del lote, ranking de pujas) |
| `notifier` | Publica a las subscriptions de GraphQL |
| `auditor` | Escribe la bitácora append-only |

Tres grupos leyendo el mismo topic de forma independiente es exactamente lo que una cola no permite. Dilo en el README.

---

## 5. Arquitectura

```
Cliente
  │  POST /v1/lots/:id/bids           (REST, con Idempotency-Key)
  ▼
API de comandos  ──┐  transacción única:
                   │   1. valida contra la proyección
                   │   2. escribe en la tabla outbox
                   └─────────────────────────────────┐
                                                     ▼
                                          Relay de outbox  ──▶  Kafka
                                                                  │
            ┌─────────────────────┬───────────────────────────────┤
            ▼                     ▼                               ▼
        projector             notifier                        auditor
            │                     │                               │
            ▼                     ▼                               ▼
   Proyección PostgreSQL   GraphQL subscriptions          Bitácora append-only
            │
            ▼
      API GraphQL (lecturas)
```

**Patrón outbox.** La API nunca escribe en la base y publica en Kafka como dos operaciones separadas: eso es una escritura dual y se pierde eventos cuando una de las dos falla. Escribe la fila de outbox dentro de la misma transacción y un relay la publica después. Es el punto que más se pregunta en entrevistas de arquitectura orientada a eventos.

**Idempotencia.** Cada consumidor guarda el `eventId` procesado en una tabla con clave única. Si el evento llega dos veces, el segundo intento no hace nada. Kafka garantiza *al menos una vez*, no *exactamente una vez*.

**Reintentos y DLQ.** Tres reintentos con backoff exponencial; al cuarto fallo el evento va al dead-letter topic con el error adjunto y un endpoint administrativo permite reprocesarlo.

**Reproceso (lo que hay que grabar en video).** Borrar la proyección, reposicionar el offset del grupo `projector` a `earliest` y dejar que se reconstruya sola desde el log. Es lo único que una cola no puede hacer, y es la mejor demostración del proyecto.

---

## 6. Esquema de datos (Prisma)

```prisma
model Auction {
  id        String   @id @db.Uuid
  tenantId  String   @db.Uuid
  title     String
  opensAt   DateTime
  closesAt  DateTime
  status    AuctionStatus
  lots      Lot[]
  @@index([tenantId, status])
}

model Lot {
  id            String   @id @db.Uuid
  auctionId     String   @db.Uuid
  tenantId      String   @db.Uuid
  title         String
  startingPrice Decimal  @db.Decimal(12, 2)
  minIncrement  Decimal  @db.Decimal(12, 2)
  currency      String   @db.Char(3)
  closesAt      DateTime
  currentPrice  Decimal? @db.Decimal(12, 2)
  currentBidder String?  @db.Uuid
  status        LotStatus
  winnerId      String?  @db.Uuid
  auction       Auction  @relation(fields: [auctionId], references: [id])
  bids          Bid[]
  @@index([tenantId, status, closesAt])
}

model Bid {
  id        String   @id @db.Uuid
  lotId     String   @db.Uuid
  bidderId  String   @db.Uuid
  amount    Decimal  @db.Decimal(12, 2)
  placedAt  DateTime
  lot       Lot      @relation(fields: [lotId], references: [id])
  // desempate determinista: mayor monto, luego el más antiguo
  @@index([lotId, amount(sort: Desc), placedAt, id])
}

model ProcessedEvent {
  eventId   String   @id @db.Uuid
  consumer  String
  handledAt DateTime @default(now())
  @@unique([eventId, consumer])
}

model OutboxMessage {
  id          String    @id @db.Uuid
  topic       String
  key         String
  payload     Json
  createdAt   DateTime  @default(now())
  publishedAt DateTime?
  @@index([publishedAt, createdAt])
}
```

Detalles que hay que dejar explícitos en el README: **dinero siempre en `Decimal(12,2)`**, nunca en flotantes; **índice único parcial** que impide dos lotes adjudicados; y el índice compuesto del desempate.

---

## 7. APIs

### REST — comandos

| Método | Ruta | Notas |
| --- | --- | --- |
| `POST` | `/v1/auctions` | 201 con `Location` |
| `POST` | `/v1/auctions/:id/lots` | 201 |
| `POST` | `/v1/lots/:id/bids` | **Exige cabecera `Idempotency-Key`.** 202 Accepted: el comando se aceptó, el resultado llega por evento |
| `GET` | `/v1/health` | Health check real: base, Kafka y consumer lag |
| `GET` | `/v1/docs` | OpenAPI generado desde las rutas |

Que la puja devuelva **202 y no 201** es deliberado y es un punto de conversación: en un sistema orientado a eventos el comando se acepta, no se resuelve de inmediato.

### GraphQL — lecturas

```graphql
type Query {
  auction(id: ID!): Auction
  lot(id: ID!): Lot
  lotBids(lotId: ID!, first: Int = 20, after: String): BidConnection!
  activeLots(auctionId: ID!): [Lot!]!
}

type Subscription {
  lotUpdated(lotId: ID!): LotUpdate!   # alimentada por el consumidor `notifier`
}
```

Límites obligatorios: profundidad máxima de consulta, cálculo de complejidad y paginación por cursor. Una API GraphQL sin esos tres límites es una denegación de servicio esperando a ocurrir, y conviene decirlo en el README.

---

## 8. Seguridad — `SECURITY.md` con el mapeo OWASP

Un archivo propio que recorra el Top 10 y diga qué hiciste para cada punto:

| Punto | Qué implementar |
| --- | --- |
| A01 Control de acceso | RBAC, verificación de propiedad del recurso, denegar por defecto |
| A02 Fallos criptográficos | TLS en todo, secretos en Key Vault, contraseñas con Argon2 |
| A03 Inyección | Prisma parametrizado, validación con Zod en el borde, límites de profundidad en GraphQL |
| A04 Diseño inseguro | Límite de pujas por postor y minuto, claves de idempotencia, ventana anti-sniping |
| A05 Mala configuración | Cabeceras de seguridad, CORS con lista blanca, sin trazas de error al cliente |
| A06 Componentes vulnerables | `npm audit` en CI y actualizaciones automáticas de dependencias |
| A07 Fallos de autenticación | JWT de acceso corto y refresco revocable, bloqueo por intentos |
| A08 Integridad de datos | Firma de los eventos y verificación en el consumidor |
| A09 Fallos de registro | Logs estructurados con id de correlación, bitácora append-only, alertas |
| A10 SSRF | Sin URLs controladas por el usuario en llamadas salientes |

---

## 9. Azure

| Servicio | Para qué |
| --- | --- |
| **Azure Event Hubs** | Kafka gestionado: expone un **endpoint compatible con el protocolo Kafka**, así que el mismo código de cliente corre contra Kafka local y contra Azure |
| **Azure Container Apps** | API, relay de outbox y los tres consumidores, cada uno con su escalado |
| **Azure Database for PostgreSQL Flexible Server** | Proyección y outbox |
| **Azure Key Vault** | Cadenas de conexión y secretos |
| **Azure Container Registry** | Imágenes |
| **Bicep** | Toda la infraestructura como código |

Que el mismo cliente de Kafka funcione contra Event Hubs sin cambiar código es el argumento que convierte esto en experiencia de Azure real y no en un tutorial.

**Local:** `docker-compose` con Kafka en modo KRaft (sin Zookeeper) y PostgreSQL. Un solo `make up`.

**Cuidado con el costo.** Event Hubs y PostgreSQL gestionado cobran por hora. Levántalo, graba la demostración, documenta y apágalo. Deja el Bicep en el repo para que se pueda recrear.

---

## 10. Calidad

- Pruebas de dominio puras, sin infraestructura.
- Pruebas de integración contra **PostgreSQL y Kafka reales** en contenedores, no mocks.
- Prueba de reproceso: publicar N eventos, borrar la proyección, reconstruir y verificar que el estado final es idéntico.
- CI en GitHub Actions: typecheck, lint, pruebas, build, auditoría de dependencias.
- ADRs numerados para cada decisión: clave de partición, outbox, 202 en la puja, GraphQL solo para lecturas.

---

## 11. Entrega por fases

| Fase | Alcance | Esfuerzo |
| --- | --- | --- |
| **1** | Kafka local en KRaft, dominio, API REST de comandos, outbox, consumidor `projector`, proyección en PostgreSQL con Prisma, queries GraphQL | Un fin de semana |
| **2** | Idempotencia, reintentos, DLQ, subscriptions de GraphQL, `SECURITY.md` con OWASP, CI completa | Un fin de semana |
| **3** | Reproceso desde el log con video, despliegue en Azure con Bicep, métricas de consumer lag en Grafana | Dos o tres días |

---

## 12. Qué debe tener el README

1. Qué es, en dos líneas, y para qué tipo de producto sirve.
2. Diagrama del flujo (el de la sección 5).
3. **"Qué cambió respecto a la versión con WebSockets y bloqueos en base de datos"** — comparación con `subastas-cafe-api`: qué ganas, qué pierdes y cuándo elegirías cada una. Esta sección es la más valiosa del repositorio.
4. Las decisiones de diseño que vale la pena mirar, con el enlace a cada ADR.
5. El video del reproceso.
6. Stack y puesta en marcha en un solo comando.
