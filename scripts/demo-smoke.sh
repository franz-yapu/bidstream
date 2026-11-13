#!/usr/bin/env bash
# Comprueba el sistema levantado por `make demo`: una subasta entra por la API REST y aparece por
# GraphQL después de recorrer outbox → relay → Kafka → projector → PostgreSQL.
set -euo pipefail

API="http://localhost:${API_PORT:-3000}"
GQL="http://localhost:${GRAPHQL_PORT:-4000}/graphql"
TENANT="11111111-1111-4111-8111-111111111111"

created="$(curl -fsS -X POST "$API/v1/auctions" \
  -H 'content-type: application/json' -H "x-tenant-id: $TENANT" \
  -d '{"title":"Subasta de prueba","opensAt":"2030-01-01T10:00:00.000Z","closesAt":"2030-01-01T20:00:00.000Z"}')"
id="$(printf '%s' "$created" | sed -n 's/.*"auctionId":"\([^"]*\)".*/\1/p')"
[ -n "$id" ] || { echo "✗ la API no devolvió auctionId: $created" >&2; exit 1; }
echo "API: subasta $id aceptada (201)"

out=""
for _ in $(seq 1 60); do
  out="$(curl -fsS -X POST "$GQL" -H 'content-type: application/json' -H "x-tenant-id: $TENANT" \
    -d "{\"query\":\"{ auction(id: \\\"$id\\\") { id title status } }\"}" || true)"
  if [[ "$out" == *"\"id\":\"$id\""* ]]; then
    echo "GraphQL: $out"
    echo "✓ el flujo completo funciona"
    exit 0
  fi
  sleep 1
done
echo "✗ la subasta no apareció en GraphQL: $out" >&2
exit 1
