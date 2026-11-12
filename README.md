# bidstream

[![CI](https://github.com/franz-yapu/bidstream/actions/workflows/ci.yml/badge.svg)](https://github.com/franz-yapu/bidstream/actions/workflows/ci.yml)

Motor de subastas en tiempo real orientado a eventos (Kafka, event sourcing, proyecciones, GraphQL, Azure).
Especificación: [`docs/product/bidstream_spec.md`](docs/product/bidstream_spec.md).

## Desarrollo

```bash
nvm use        # Node 22
npm ci
npm run check  # typecheck + lint + formato + tests + build
```

## Entorno local

```bash
make up      # Kafka (KRaft) + PostgreSQL + topics
make verify  # comprobaciones del entorno
make down    # detener (conserva datos); make reset borra los datos
```

Puertos configurables en `.env` (ver `.env.example`): Kafka `9092`, PostgreSQL `5432`.

El README completo llega con el ticket I1.
