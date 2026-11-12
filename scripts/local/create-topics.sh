#!/bin/sh
# Crea los topics de la spec §4 de forma idempotente. Lo ejecuta el servicio kafka-init.
set -eu
KT=/opt/kafka/bin/kafka-topics.sh
BS="${BOOTSTRAP_SERVER:-kafka:19092}"

create() { # nombre particiones retention.ms
  "$KT" --bootstrap-server "$BS" --create --if-not-exists \
    --topic "$1" --partitions "$2" --replication-factor 1 \
    --config "retention.ms=$3" --config cleanup.policy=delete
}

create bidstream.commands.bid    6 604800000    # 7 días
create bidstream.events.lot      6 -1           # ilimitada, sin compactar: fuente de verdad
create bidstream.events.lot.dlq  1 2592000000   # 30 días

echo "topics listos"
