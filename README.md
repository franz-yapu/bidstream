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

## Pruebas

```bash
npm run check             # build + typecheck + lint + formato + pruebas unitarias
make up && npm run test:integration   # pruebas contra PostgreSQL y Kafka reales
```

La CI corre ambos conjuntos: el job `check` y el job `integration` (levanta el entorno con `make up`).
