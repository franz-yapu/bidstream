# SDD — E1 · Servidor GraphQL de lectura

- **Ticket:** ClickUp **E1** (`868mvty0w`, https://app.clickup.com/t/868mvty0w).
- **Autor:** generado con Claude (Entregable 1).
- **Estado:** Implementado (2026-11-12) — aprobado el mismo día
- **Versión:** 1.0 · **Fecha:** 2026-11-12
- **Fuentes de verdad citadas:**
  1. `docs/product/bidstream_spec.md` §7 (esquema GraphQL: `auction`, `lot`, `lotBids(first, after)`, `activeLots`; "GraphQL solo para lecturas"; paginación por cursor), §6 (índice del ranking de pujas), §8 A01/A03/A05
  2. `docs/sdd/B1/SDD.md` y `docs/sdd/D4/SDD.md` (proyección: `auction`, `lot`, `bid`; sin clave foránea lote → subasta), `docs/sdd/B2/SDD.md` (repositorios de lectura filtrados por tenant)
  3. `docs/sdd/C1/SDD.md` §7 #4 ("el servidor GraphQL irá en un `apps/graphql` aparte"), `docs/sdd/C2/SDD.md` §2.2 (tenant provisional por cabecera, prohibido en producción)
  4. `docs/sdd/D5/SDD.md` §2.2 (las notificaciones no revelan la identidad del postor), `docs/sdd/A1/SDD.md` (`minimumBid`)

---

## 0 · Preguntas que el ticket pidió cerrar

| # | Pregunta del ticket | Respuesta |
|---|---|---|
| 1 | ¿Qué librería (Yoga o Apollo) y si va en el mismo proceso que la API REST? | **GraphQL Yoga**, en un **proceso aparte** (`apps/graphql`) (§2.1) |

---

## 1 · Alcance

### Entra

- Workspace `apps/graphql` (`@bidstream/graphql`): servidor GraphQL de **solo lectura** sobre la proyección de PostgreSQL.
- Esquema (SDL) de la spec §7: `Query.auction`, `lot`, `lotBids` con paginación por cursor y `activeLots`; tipos `Auction`, `Lot`, `Bid`, `BidConnection`.
- Escalares `Money` (cadena decimal) y `DateTime` (ISO-8601 UTC).
- Aislamiento por tenant en cada consulta, con el tenant provisional por cabecera (prohibido en producción).
- Carga por lotes (`DataLoader`) para evitar el problema N+1.
- `GET /health` básico, errores sin detalles internos en producción y configuración validada.
- Pruebas de integración contra PostgreSQL real.

### No entra (a propósito)

- Límites de profundidad, complejidad y alias → E2 (aquí solo topes de paginación).
- La `Subscription` y su transporte → E3.
- Escrituras: GraphQL no tiene mutaciones (ADR "GraphQL solo para lecturas").
- Autenticación y propiedad de recursos → F1 (Q4); identidad de postores (ver §2.3).

### Premisas verificadas (heredadas de `task-brief`)

| Premisa del ticket | Qué hay de verdad |
|---|---|
| "Esquema SDL según la spec §7" | La spec da solo las firmas de `Query` y `Subscription`; **no define** los tipos `Auction`, `Lot`, `Bid`, `BidConnection` ni `LotUpdate`: hay que diseñarlos |
| Datos | La proyección tiene `auction`, `lot` (con `current_price`, `current_bidder`, `winner_id`) y `bid` (con `bidder_id`, `awarded`). El índice `(lot_id, amount DESC, placed_at, id)` sirve la paginación del ranking |
| Librería | `graphql-yoga` 6.1.0 (actualizada hoy; exige Node ≥ 22.15, cumplido con 22.23), `graphql` 16.x y 17.1.0 disponibles; `@graphql-tools/schema` 11.0.9; `dataloader` 2.2.3 |
| Tenant | No hay autenticación (F1/Q4): la API REST usa `X-Tenant-Id` fuera de producción; las lecturas necesitan lo mismo |
| Identidad de postores | La base guarda `bidder_id`, `current_bidder` y `winner_id`; D5 decidió **no** difundirlos en las notificaciones públicas |
| `apps/*` importan los paquetes desde `dist/` | Hay que recompilar tras tocar un paquete antes de probar la app |

---

## 2 · Diseño técnico

### 2.1 Decisiones y por qué

| Decisión | Elección | Por qué |
|---|---|---|
| Servidor | **GraphQL Yoga** 6 sobre `node:http` | Mantenida (actualizada hoy), subscriptions por SSE incluidas (E3), sin atarse a Apollo; Fastify añadiría una capa sin aportar a un servidor de un solo endpoint |
| Proceso | `apps/graphql` aparte de `apps/api` | Lecturas y comandos escalan por separado (aprobado en C1 §7 #4); el `projector` es quien alimenta lo que este proceso lee |
| Esquema | **Schema-first**: un archivo `schema.graphql` con `makeExecutableSchema` | La spec da el SDL; un esquema legible en el repositorio es parte del valor del proyecto. Tipos de resolvers escritos a mano (sin generación de código) |
| Versión de `graphql` | **16.x** salvo que un *spike* demuestre compatibilidad con 17.1.0 de todo el ecosistema | Máxima compatibilidad con Yoga, `@graphql-tools` y la librería de complejidad de E2 |
| Acceso a datos | Prisma sobre la proyección, en `apps/graphql/src/data/` | Solo lecturas; filtra siempre por `tenantId` |
| Dinero y fechas | Escalares `Money` (string `^\d+\.\d{2}$`) y `DateTime` (ISO-8601 UTC) | Business-rule #6: nunca flotantes; el cliente recibe exactamente lo que guarda la base |
| Paginación | Cursor **opaco** (base64url de `{ amount, placedAt, id }`) con *keyset* sobre `(amount DESC, placedAt, id)`; `first` por defecto 20, máximo 100 | Estable ante inserciones, usa el índice del ranking y no hace `OFFSET`; el cursor se valida estrictamente |
| N+1 | `DataLoader` por petición para `Lot.auction` y `Auction.lots` | Una consulta anidada no dispara una consulta por elemento |
| Errores | Códigos estables (`BAD_USER_INPUT`, `NOT_FOUND`, `UNAUTHENTICATED`); en producción los errores internos se enmascaran | OWASP A05: nada interno al cliente |
| Tenant | Cabecera `X-Tenant-Id` provisional; la configuración **impide** arrancar con `NODE_ENV=production` (como la API) | Misma decisión y misma salida que C2 |

### 2.2 Esquema

```graphql
scalar Money      # "105.50"
scalar DateTime   # ISO-8601 UTC

type Query {
  auction(id: ID!): Auction
  lot(id: ID!): Lot
  lotBids(lotId: ID!, first: Int = 20, after: String): BidConnection!
  activeLots(auctionId: ID!, first: Int = 50): [Lot!]!
}

type Auction { id: ID!  title: String!  opensAt: DateTime!  closesAt: DateTime!  status: AuctionStatus!
               lots(first: Int = 50): [Lot!]! }
type Lot     { id: ID!  auction: Auction!  title: String!  startingPrice: Money!  minIncrement: Money!
               currency: String!  closesAt: DateTime!  currentPrice: Money  status: LotStatus!
               hasWinner: Boolean!  finalAmount: Money
               nextMinimumBid: Money!
               bids(first: Int = 20, after: String): BidConnection! }
type Bid     { id: ID!  amount: Money!  placedAt: DateTime!  rank: Int!  awarded: Boolean! }
type BidConnection { edges: [BidEdge!]!  pageInfo: PageInfo! }
type BidEdge   { cursor: String!  node: Bid! }
type PageInfo  { hasNextPage: Boolean!  endCursor: String }
enum AuctionStatus { OPEN CLOSED }   enum LotStatus { OPEN CLOSED }
```

`Lot.nextMinimumBid` aplica `minimumBid` del dominio (primera puja `>= startingPrice`, siguientes `>= precio actual + incremento`), de modo que el cliente no reimplementa la regla. `Bid.rank` es la posición en el ranking (1 = la mejor).

### 2.3 Privacidad: sin identidad de postores

Ningún tipo expone `bidderId`, `currentBidder` ni `winnerId`: una subasta pública no revela quién puja y, sin autenticación (F1), no hay forma de decidir quién puede verlo. Se expone `hasWinner` y `finalAmount`. Cuando exista F1 se podrán añadir campos protegidos (p. ej. «mis pujas»).

### 2.4 Tenant y aislamiento

Todas las lecturas filtran por `tenantId`: un lote o subasta de otro tenant es indistinguible de uno inexistente (`null`). `lotBids` de un lote ajeno devuelve una conexión vacía (no revela existencia).

---

## 3 · Cambios por archivo/módulo

| Archivo/módulo | Cambio |
|---|---|
| `apps/graphql/package.json`, `tsconfig*.json` | Nuevo `@bidstream/graphql`: `graphql-yoga`, `graphql`, `@graphql-tools/schema`, `dataloader`, `@bidstream/db`, `@bidstream/domain`, `zod` |
| `apps/graphql/src/schema.graphql` | El esquema de §2.2 |
| `apps/graphql/src/schema.ts` | `makeExecutableSchema`, escalares y carga del SDL |
| `apps/graphql/src/resolvers/*.ts` | `query.ts`, `auction.ts`, `lot.ts`, `bid.ts` |
| `apps/graphql/src/data/*.ts` | Lecturas con Prisma y *keyset*; cursor (`cursor.ts`) |
| `apps/graphql/src/loaders.ts` | `DataLoader` por petición |
| `apps/graphql/src/tenant.ts`, `config.ts` | Tenant provisional y configuración |
| `apps/graphql/src/server.ts`, `main.ts`, `index.ts` | `buildServer(deps)` (sin escuchar) y arranque con `/health` |
| `tsconfig.json` (raíz), `package.json` | Referencia y `dev:graphql` |
| `.env.example`, `README.md`, `CLAUDE.md` | Variables, ejemplo de consulta con `curl` |

---

## 4 · Plan de tests

Integración con PostgreSQL real (base desechable) y el servidor en proceso (`fetch` sobre un puerto libre o `yoga.fetch`).

| Caso | Nivel | Cubre |
|---|---|---|
| `lot(id)` devuelve todos los campos con dinero como cadena, fechas ISO y `nextMinimumBid` (sin pujas = precio de salida; con pujas = vigente + incremento) | integración | Esquema y regla |
| `lot`/`auction` de otro tenant o inexistente → `null`; sin cabecera de tenant → `UNAUTHENTICATED` | integración | Aislamiento |
| `activeLots(auctionId)` devuelve solo lotes abiertos, ordenados por cierre, y respeta `first` | integración | Consulta |
| `lotBids` pagina el ranking (mayor monto, luego la más antigua, luego `id`): recorrer todas las páginas reproduce `compareBids` del dominio y no repite ni omite ninguna | integración | Cursor y orden |
| Dos pujas con el **mismo monto** quedan ordenadas por antigüedad y el cursor no las confunde | integración | Desempate |
| `first` mayor que 100 o menor que 1 → `BAD_USER_INPUT`; cursor inválido o manipulado → `BAD_USER_INPUT` | integración | Entrada |
| `lotBids` de un lote de otro tenant → conexión vacía | integración | Aislamiento |
| Consulta anidada (`activeLots { auction { lots { … } } }`) ejecuta un número acotado de consultas SQL (sin N+1) | integración | `DataLoader` |
| Ninguna consulta puede obtener `bidderId`, `currentBidder` ni `winnerId` (el esquema no los tiene) | integración | Privacidad |
| Un error interno no filtra detalles al cliente con `NODE_ENV=production` simulado | integración | OWASP A05 |
| `GET /health` responde 200; la configuración falla con `production` y tenant por cabecera | unit | Salud y seguridad |
| El estado leído de un lote coincide con `foldLot` del historial que lo originó (con `generateHistory`) | integración | Coherencia con el dominio |

**Deliberadamente sin test:** límites de profundidad/complejidad (E2) y subscriptions (E3).

---

## 5 · Definition of Done

- [x] SDD en `docs/sdd/E1/SDD.md`, Estado = Aprobado
- [x] Las cuatro consultas de la spec funcionan sobre la proyección, con cursor y sin N+1
- [x] Sin identidad de postores en ningún tipo; aislamiento por tenant
- [x] Tests del §4 en verde; `npm run check` y `npm run test:integration` en verde
- [x] `schema.graphql` documentado en el README
- [x] PR con CI verde y fusionado

---

## 6 · Riesgos

| Riesgo | Gravedad | Mitigación |
|---|---|---|
| Las lecturas reflejan un estado obsoleto si el `projector` va por detrás (consistencia eventual) | Media | Inherente a la arquitectura; documentado; el reproceso (G2) muestra estado parcial mientras reconstruye |
| `graphql` 17 y el resto del ecosistema no encajan | Baja | Se fija la 16.x; un *spike* decide si se sube |
| Cursor manipulado para provocar consultas costosas | Media | Validación estricta con Zod y consulta *keyset* indexada; el tope de `first` limita el trabajo |
| Un cliente pide listas enormes anidadas | Alta | Topes de paginación aquí y límites de complejidad en E2 |
| El tenant por cabecera permite elegir tenant | Alta (si llegara a producción) | Prohibido por configuración en producción (como C2); se sustituye en F1 |
| Se omite la identidad de postores y limita la utilidad | Baja | Decisión consciente de privacidad; ampliable con F1 |

---

## 7 · Preguntas abiertas

1. **Yoga sobre `node:http`** (propuesta) y **schema-first** con tipos de resolvers a mano. ¿O prefieres code-first (Pothos), con tipos generados pero un esquema menos legible?
2. **Sin identidad de postores** en las lecturas (`bidderId`, `winnerId`), coherente con D5. ¿De acuerdo? Alternativa: un alias anónimo estable por lote («Postor 3»).
3. **Listas acotadas:** `Auction.lots` y `activeLots` con `first` (defecto 50, máximo 100) en vez de listas sin límite como sugiere el SDL de la spec. ¿De acuerdo?
4. **Campo calculado `Lot.nextMinimumBid`** que reutiliza la regla del dominio. ¿Lo incluimos (propuesta)?
5. **Versión de `graphql`:** 16.x (propuesta) o intentar 17.1.0 tras un *spike*.
6. **Tenant provisional** con las mismas condiciones que C2 (prohibido en producción). ¿De acuerdo?

---

## Changelog de implementación

- **Implementado (2026-11-12)** con todas las propuestas aprobadas de §7: Yoga 6 sobre `node:http` y schema-first con resolvers tipados a mano, sin identidad de postores, listas acotadas con `first` (defecto 50/20, máximo 100), `Lot.nextMinimumBid`, `graphql` 16.15 y tenant por cabecera prohibido en producción.
- `apps/graphql`: `schema.ts` (el SDL, que documenta el esquema), `resolvers.ts`, `data.ts` (lecturas y *keyset*), `cursor.ts` (opaco, validado con Zod), `context.ts` (`DataLoader` por petición), `tenant.ts`, `server.ts` (`buildYoga` sin escuchar, y `buildHttpServer` con `/health`) y `main.ts` (arranque y apagado ordenado).
- **Desviaciones menores del diseño:**
  - `Lot.auction` es **nulo-able** (`Auction`, no `Auction!`): como no hay clave foránea y la proyección es eventualmente consistente (D4 §2.4), un lote puede existir antes que su subasta, y declararlo no nulo haría fallar la consulta entera.
  - El SDL vive en `schema.ts` como cadena en lugar de un archivo `.graphql`, porque `tsc` no copia archivos que no son TypeScript a `dist/`.
  - El puerto es `GRAPHQL_PORT` (4000), no `PORT`, para no colisionar con la API (3000) si comparten `.env`.
  - Una conexión de pujas de un lote de otro tenant o inexistente devuelve una conexión vacía (no un error) para no revelar su existencia.
- **Problema de entorno de pruebas resuelto:** bajo Vitest, `graphql` se cargaba como dos copias (ESM por Yoga y CJS por el código procesado por Vite) y `instanceof GraphQLError` fallaba, enmascarando los errores de entrada como `INTERNAL_SERVER_ERROR`. En aislamiento funcionaba. La configuración de integración procesa `graphql`, `@graphql-tools`, `@whatwg-node` y `@envelop` de forma uniforme (`server.deps.inline`).
- 33 pruebas nuevas: 12 unitarias (configuración y cursor) y 21 de integración con PostgreSQL real sobre una proyección poblada con `applyEventToProjection` desde `generateHistory`: **los 6 lotes coinciden con `foldLot`** campo a campo (precio vigente, estado, adjudicación, `nextMinimumBid`), recorrer todas las páginas reproduce el ranking de `compareBids` sin repetir ni omitir, el tamaño de página no cambia el resultado, los empates por monto y por instante se ordenan por antigüedad y `id` sin que el cursor los confunda, validación de `first`, cursores e IDs (un ID inválido no toca la base de datos), aislamiento por tenant (401 sin cabecera), `activeLots`, sin N+1 (la consulta anidada hace un número acotado de lecturas), el esquema no contiene ningún campo con identidad de postor (solo `hasWinner`), un error interno se enmascara sin trazas ni secretos, y `/health` más `/graphql` por HTTP real. Estables en tres ejecuciones seguidas.
- Comprobado a mano con el proceso real: `/health`, una consulta y un 401 sin tenant; se detiene con SIGTERM por su PID.
- **Pendiente para E2:** el esquema aún no limita profundidad ni complejidad; solo el tope de `first`. La introspección está activa.
