#!/usr/bin/env bash
# Demostración del reproceso (H5, spec §5): genera un historial, borra la proyección, vuelve a
# `earliest` y comprueba que se reconstruye idéntica. Usa su propia base de datos, topic y grupo:
# no toca el entorno de desarrollo. Requiere `make up`. Guion: docs/demo/GUION.md
#
#   scripts/demo-reprocess.sh [--pause SEGUNDOS] [--subastas N] [--lotes N] [--pujas N]
set -euo pipefail
cd "$(dirname "$0")/.."

PAUSE=0 AUCTIONS=2 LOTS=10 BIDS=20
while [ $# -gt 0 ]; do
  case "$1" in
    --pause) PAUSE="$2"; shift 2 ;;
    --subastas) AUCTIONS="$2"; shift 2 ;;
    --lotes) LOTS="$2"; shift 2 ;;
    --pujas) BIDS="$2"; shift 2 ;;
    *) echo "opción desconocida: $1" >&2; exit 2 ;;
  esac
done

SUFFIX="$(date +%s)"
export DATABASE_URL="${DEMO_DATABASE_URL:-postgresql://bidstream:bidstream@localhost:5432/bidstream_demo_$SUFFIX}"
export KAFKA_BROKERS="${KAFKA_BROKERS:-localhost:9092}"
export KAFKA_LOG_LEVEL="${KAFKA_LOG_LEVEL:-error}" # sin el ruido del cliente: se ve solo la demostración
export PROJECTOR_GROUP_ID="projector-demo-$SUFFIX"
export PROJECTOR_TOPIC="bidstream.demo.events.$SUFFIX"
DB_NAME="${DATABASE_URL##*/}"
FINGERPRINT="$(mktemp)"
COMPOSE="docker compose"

step() { echo; echo "━━ $* ━━"; [ "$PAUSE" = 0 ] || sleep "$PAUSE"; }
cleanup() {
  rm -f "$FINGERPRINT"
  $COMPOSE exec -T kafka /opt/kafka/bin/kafka-topics.sh --bootstrap-server localhost:9092 \
    --delete --topic "$PROJECTOR_TOPIC" >/dev/null 2>&1 || true
  $COMPOSE exec -T postgres sh -c "psql -U \"\$POSTGRES_USER\" -d postgres -c 'DROP DATABASE IF EXISTS \"$DB_NAME\"'" >/dev/null 2>&1 || true
}
trap cleanup EXIT

step "Preparando un entorno propio de la demo ($DB_NAME, $PROJECTOR_TOPIC)"
$COMPOSE exec -T postgres sh -c "psql -U \"\$POSTGRES_USER\" -d postgres -c 'CREATE DATABASE \"$DB_NAME\"'" >/dev/null
npm run --silent db:migrate -w @bidstream/db >/dev/null
$COMPOSE exec -T kafka /opt/kafka/bin/kafka-topics.sh --bootstrap-server localhost:9092 \
  --create --topic "$PROJECTOR_TOPIC" --partitions 3 --replication-factor 1 >/dev/null

step "1/3 Cargando el historial: API → outbox → relay → Kafka → projector → PostgreSQL"
node --import tsx apps/projector/src/demo/load.ts "$FINGERPRINT" "$AUCTIONS" "$LOTS" "$BIDS"

step "2/3 Reproceso: borrar la proyección, volver a earliest y reconstruir desde el log"
node --import tsx apps/projector/src/reprocess-cli.ts --yes

step "3/3 Verificación: ¿la proyección reconstruida es idéntica?"
node --import tsx apps/projector/src/demo/verify.ts "$FINGERPRINT"
