# Guía de desarrollo

Comandos, procesos y operación del día a día. Para qué es el proyecto y por qué está hecho así, ver el
[README](../README.md); las decisiones de diseño, en [`docs/adr/`](adr/README.md).

## Desarrollo

```bash
nvm use        # Node 22 (obligatorio: el cliente de Kafka no compila en Node 26)
npm ci
npm run check  # typecheck + lint + formato + tests + build
```

## Entorno local

```bash
make up      # Kafka (KRaft) + PostgreSQL + topics
make migrate # aplica las migraciones de PostgreSQL
make verify  # comprobaciones del entorno
make down    # detener (conserva datos); make reset borra los datos
```

Puertos configurables en `.env` (ver `.env.example`): Kafka `9092`, PostgreSQL `5432`.

## API

```bash
npm run dev:api   # http://localhost:3000/v1/health · documentación en /v1/docs
```

Crear una subasta (el tenant por cabecera es provisional, solo fuera de producción):

```bash
curl -i -X POST localhost:3000/v1/auctions -H 'x-tenant-id: 11111111-1111-4111-8111-111111111111' \
  -H 'content-type: application/json' \
  -d '{"title":"Arte","opensAt":"2030-01-01T10:00:00.000Z","closesAt":"2030-01-02T10:00:00.000Z"}'
```

El `201` significa «comando aceptado»: el evento queda en el outbox y el estado visible llega cuando el relay y el `projector` lo procesan.

## Pruebas

```bash
npm run check             # build + typecheck + lint + formato + pruebas unitarias
make up && npm run test:integration   # pruebas contra PostgreSQL y Kafka reales
```

La CI corre ambos conjuntos: el job `check` y el job `integration` (levanta el entorno con `make up`).

## Relay del outbox

```bash
npm run dev:relay   # publica en Kafka lo que la API dejó en el outbox
```

Solo un relay está activo a la vez (bloqueo asesor de PostgreSQL) para conservar el orden por lote; los demás quedan en espera y toman el relevo si el líder cae. Es al menos una vez: los consumidores son idempotentes.

## Flujo completo en local

```bash
make up && make migrate
npm run dev:api        # terminal 1: comandos HTTP
npm run dev:relay      # terminal 2: outbox → Kafka
npm run dev:projector  # terminal 3: Kafka → proyección en PostgreSQL
npm run dev:auditor    # opcional: Kafka → bitácora append-only (audit_log)
npm run dev:notifier   # opcional: Kafka → NOTIFY para las subscriptions de GraphQL
```

Los comandos devuelven `201` al aceptarse; el estado aparece en la proyección cuando el relay y el `projector` procesan el evento (un `POST …/lots` inmediato tras crear la subasta puede dar `404` con `Retry-After`).

## Imágenes de contenedor

```bash
make images                                              # las ocho, etiquetadas bidstream-<app>:test
docker build --build-arg APP=relay -t bidstream-relay .  # o una sola
docker run --rm -e DATABASE_URL=… -e KAFKA_BROKERS=… bidstream-relay
```

Toda la configuración llega por variables de entorno en tiempo de ejecución; las imágenes no llevan secretos ni código fuente y corren como usuario no root. `scripts/docker-smoke.sh` (en la CI, un job por proceso) comprueba su contenido y que arrancan contra Kafka y PostgreSQL.

## Reproceso: reconstruir la proyección desde el log

El log de Kafka es la fuente de verdad; la proyección se puede borrar y reconstruir. Es lo que una cola no permite.

```bash
# detén el projector y ejecuta:
npm run reprocess -w @bidstream/projector -- --yes
```

Borra `bid`, `lot` y `auction`, reposiciona el grupo `projector` a `earliest` y reconstruye mostrando el progreso. La prueba `reprocess.int.test.ts` demuestra que el estado final es idéntico, con uno o con varios consumidores en paralelo. Mientras reconstruye, las lecturas devuelven un estado parcial.

### Demostración (con huella del estado)

```bash
make up && make demo-reprocess
```

Genera un historial por la API real, borra la proyección, vuelve a `earliest` y comprueba que la proyección reconstruida es **idéntica** (SHA-256 del estado antes y después). Usa su propia base de datos, topic y grupo, y los limpia al terminar. Guion para grabar el vídeo: [`docs/demo/GUION.md`](demo/GUION.md).

## Reproceso del DLQ (administración)

Un evento que agota sus 4 intentos va al DLQ. La API expone, **solo al rol `ADMIN`** (token de acceso; ver [ADR-0013](adr/0013-autenticacion-propia-y-rbac.md)):

```bash
TOKEN=…   # POST /v1/auth/login como administrador
curl -H "Authorization: Bearer $TOKEN" localhost:3000/v1/admin/dlq                      # lista sin consumir
curl -X POST -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
     -d '{"limit": 10}' localhost:3000/v1/admin/dlq/reprocess                          # pendientes
curl -X POST -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
     -d '{"eventIds": ["<uuid>"]}' localhost:3000/v1/admin/dlq/reprocess               # selectivo
```

Solo se republican los `retries-exhausted` (los `poison` se quedan), con un máximo de 3 reprocesos por evento. **Advertencia de orden:** el evento reprocesado llega al final de su partición, después de los posteriores; si la integridad de la proyección importa, usa el reproceso completo de arriba. Un SELLER o un BIDDER reciben `403` y sin token, `401`. El log registra el `actor` (el administrador del token).

## API de lectura (GraphQL)

```bash
npm run dev:graphql   # http://localhost:4000/graphql · /health
```

Solo lecturas sobre la proyección (`auction`, `lot`, `lotBids`, `activeLots`), con paginación por cursor sobre el ranking de pujas. El importe va como cadena decimal (`Money`) y las fechas en ISO-8601 UTC. **No expone la identidad de postores ni de ganadores**, solo `hasWinner` y `finalAmount`. El tenant provisional va en la cabecera `X-Tenant-Id` (no arranca en producción hasta F1).

```bash
curl -s localhost:4000/graphql -H 'content-type: application/json' -H 'x-tenant-id: 11111111-1111-4111-8111-111111111111' \
  -d '{"query":"{ lot(id: \"<id>\") { title currentPrice nextMinimumBid bids(first: 5) { edges { node { amount rank } } } } }"}'
```

### Límites de la API GraphQL

Una API GraphQL sin límites es una denegación de servicio esperando a ocurrir: una sola consulta puede pedir listas anidadas que multipliquen el trabajo. Por eso hay tres límites obligatorios, más algunos de apoyo; todo se comprueba **antes de ejecutar ningún resolver** y es configurable por entorno.

| Límite                                 |  Valor | Variable             |
| -------------------------------------- | -----: | -------------------- |
| Profundidad máxima                     |      7 | `GQL_MAX_DEPTH`      |
| Complejidad máxima (coste por `first`) |  1 000 | `GQL_MAX_COMPLEXITY` |
| Paginación por cursor, `first` máximo  |    100 | `GQL_MAX_PAGE_SIZE`  |
| Alias por documento                    |     15 | `GQL_MAX_ALIASES`    |
| Tokens por documento                   |  2 000 | `GQL_MAX_TOKENS`     |
| Tamaño del cuerpo                      | 100 KB | `GQL_MAX_BODY_BYTES` |

El coste de una lista es `first × (1 + coste de sus hijos)`: `activeLots(first: 100) { bids(first: 100) { … } }` cuesta 30 100 y se rechaza; con `first: 10` en ambas, 310, y pasa. Los errores llevan un código estable (`QUERY_TOO_DEEP`, `QUERY_TOO_COMPLEX`, `TOO_MANY_ALIASES`, `QUERY_TOO_LARGE`, `BAD_USER_INPUT`). Los clientes deben enviar `Accept: application/graphql-response+json` para recibir un 400 en los errores de validación.

### Subscriptions en tiempo real

`Subscription.lotUpdated(lotId)` entrega, por SSE, las actualizaciones públicas de un lote (`LotPublishedUpdate`, `BidPlacedUpdate`, `LotExtendedUpdate`, `LotClosedUpdate`) y un `ResyncRequired` cuando pudieron perderse mensajes (reconexión del canal o cliente lento): en ese caso, vuelve a consultar `lot(id)`. Nunca incluye quién pujó.

```bash
curl -N localhost:4000/graphql -H 'content-type: application/json' -H 'accept: text/event-stream, application/graphql-response+json' \
  -H 'x-tenant-id: 11111111-1111-4111-8111-111111111111' \
  -d '{"query":"subscription { lotUpdated(lotId: \"<id>\") { __typename ... on BidPlacedUpdate { amount } ... on LotClosedUpdate { finalAmount } } }"}'
```

Límites: 500 suscripciones simultáneas por tenant y una cola de 50 por suscriptor (`GQL_MAX_SUBSCRIPTIONS_PER_TENANT`, `GQL_SUBSCRIPTION_QUEUE`). El camino es: el `notifier` hace `NOTIFY` en PostgreSQL → cada réplica GraphQL escucha el canal → su suscripción.

## Seguridad de dependencias

`npm run audit:prod` y `npm run audit:high` aplican en local la misma política que la CI (`.github/workflows/security.yml`): **falla ante cualquier aviso en dependencias de producción y ante uno alto o crítico en cualquiera**; los demás se informan. Se ejecuta en cada PR, en `main` y cada lunes (los avisos aparecen sin que cambie el código). Dependabot propone las actualizaciones cada semana, agrupadas, y todas las acciones de GitHub están fijadas por SHA (una prueba lo exige). `npm audit` no lo ve todo: es una capa, no la única.
