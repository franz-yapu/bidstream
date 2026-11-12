#!/bin/sh
# Verifica el entorno local (casos de docs/sdd/0.2/SDD.md §4). Requiere `make up` previo.
set -u
KB=/opt/kafka/bin
DC="docker compose"
PORT="${KAFKA_PORT:-9092}"
PGU="${POSTGRES_USER:-bidstream}"
PGDB="${POSTGRES_DB:-bidstream}"
FAIL=0
ok()   { echo "  ok   - $1"; }
fail() { echo "  FAIL - $1"; FAIL=1; }
check() { if eval "$2" >/dev/null 2>&1; then ok "$1"; else fail "$1"; fi; }
kt() { $DC exec -T kafka "$KB/kafka-topics.sh" --bootstrap-server localhost:9092 "$@"; }

echo "== servicios"
check "kafka healthy"    "$DC ps kafka --format '{{.Health}}' | grep -q healthy"
check "postgres healthy" "$DC ps postgres --format '{{.Health}}' | grep -q healthy"

echo "== topics (spec §4)"
t() { kt --describe --topic "$1" | head -1; }
check "commands.bid: 6 particiones, 7 d"  "t bidstream.commands.bid   | grep -q 'PartitionCount: 6' && t bidstream.commands.bid   | grep -q 'retention.ms=604800000'"
check "events.lot: 6 particiones, ilimitada, sin compactar" "t bidstream.events.lot | grep -q 'PartitionCount: 6' && t bidstream.events.lot | grep -q 'retention.ms=-1' && t bidstream.events.lot | grep -q 'cleanup.policy=delete'"
check "events.lot.dlq: 1 partición, 30 d" "t bidstream.events.lot.dlq | grep -q 'PartitionCount: 1' && t bidstream.events.lot.dlq | grep -q 'retention.ms=2592000000'"

echo "== listeners"
check "puerto del host (localhost:$PORT) accesible" "bash -c 'exec 3<>/dev/tcp/127.0.0.1/$PORT'"
check "listener interno kafka:19092 desde otro contenedor" \
  "docker run --rm --network bidstream_default apache/kafka:4.3.2 $KB/kafka-broker-api-versions.sh --bootstrap-server kafka:19092"

echo "== orden por clave (ADR-0001)"
kt --create --if-not-exists --topic bidstream.verify --partitions 6 --replication-factor 1 >/dev/null 2>&1
printf 'lotA:1\nlotB:1\nlotA:2\nlotB:2\nlotA:3\nlotB:3\nlotC:1\nlotC:2\n' | \
  $DC exec -T kafka "$KB/kafka-console-producer.sh" --bootstrap-server localhost:9092 --topic bidstream.verify \
  --property parse.key=true --property key.separator=: >/dev/null 2>&1
OUT=$($DC exec -T kafka "$KB/kafka-console-consumer.sh" --bootstrap-server localhost:9092 --topic bidstream.verify \
  --from-beginning --timeout-ms 8000 --property print.key=true --property print.partition=true 2>/dev/null)
for k in lotA lotB lotC; do
  N=$(echo "$OUT" | grep "	$k	" | sed 's/^Partition:\([0-9]*\).*/\1/' | sort -u | wc -l)
  [ "$N" -eq 1 ] && ok "clave $k siempre en una partición" || fail "clave $k repartida en $N particiones"
done
kt --delete --topic bidstream.verify >/dev/null 2>&1

echo "== auto-creación desactivada"
RES=$(echo x | $DC exec -T kafka "$KB/kafka-console-producer.sh" --bootstrap-server localhost:9092 \
   --topic bidstream.no-existe --producer-property max.block.ms=5000 2>&1)
if echo "$RES" | grep -q UNKNOWN_TOPIC_OR_PARTITION && ! kt --list | grep -q 'bidstream.no-existe'; then
  ok "producir a un topic inexistente falla y no lo crea"
else fail "el topic inexistente se creó o no falló"; fi

echo "== postgres"
check "psql conecta" "$DC exec -T postgres psql -U $PGU -d $PGDB -c 'select 1'"

echo
[ "$FAIL" -eq 0 ] && echo "TODO OK" || { echo "HAY FALLOS"; exit 1; }
