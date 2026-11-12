# bidstream

[![CI](https://github.com/franz-yapu/bidstream/actions/workflows/ci.yml/badge.svg)](https://github.com/franz-yapu/bidstream/actions/workflows/ci.yml)

Motor de subastas en tiempo real orientado a eventos (Kafka, event sourcing, proyecciones, GraphQL, Azure).
Especificación: [`docs/product/bidstream_spec.md`](docs/product/bidstream_spec.md).

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

El README completo llega con el ticket I1.

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

## Reproceso: reconstruir la proyección desde el log

El log de Kafka es la fuente de verdad; la proyección se puede borrar y reconstruir. Es lo que una cola no permite.

```bash
# detén el projector y ejecuta:
npm run reprocess -w @bidstream/projector -- --yes
```

Borra `bid`, `lot` y `auction`, reposiciona el grupo `projector` a `earliest` y reconstruye mostrando el progreso. La prueba `reprocess.int.test.ts` demuestra que el estado final es idéntico, con uno o con varios consumidores en paralelo. Mientras reconstruye, las lecturas devuelven un estado parcial.
