#!/usr/bin/env bash
# Comprueba el sistema levantado por `make demo`: una subasta, un lote y una puja entran por la API
# REST (la puja la decide el consumidor decisor) y aparecen por GraphQL.
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

gql() { # consulta GraphQL → cuerpo de la respuesta
  curl -fsS -X POST "$GQL" -H 'content-type: application/json' -H "x-tenant-id: $TENANT" \
    -d "{\"query\":\"$1\"}" || true
}
wait_for() { # descripción, consulta, texto esperado
  local out=""
  for _ in $(seq 1 60); do
    out="$(gql "$2")"
    if [[ "$out" == *"$3"* ]]; then echo "GraphQL: $out"; return 0; fi
    sleep 1
  done
  echo "✗ $1: $out" >&2
  exit 1
}

wait_for "la subasta no apareció en GraphQL" "{ auction(id: \\\"$id\\\") { id title status } }" "\"id\":\"$id\""

# un lote en la subasta, y una puja que decide el consumidor decisor
lot="$(curl -fsS -X POST "$API/v1/auctions/$id/lots" \
  -H 'content-type: application/json' -H "x-tenant-id: $TENANT" \
  -d '{"title":"Lote de prueba","startingPrice":"100.00","minIncrement":"5.00","currency":"USD","closesAt":"2030-01-01T18:00:00.000Z"}')"
lot_id="$(printf '%s' "$lot" | sed -n 's/.*"lotId":"\([^"]*\)".*/\1/p')"
[ -n "$lot_id" ] || { echo "✗ la API no devolvió lotId: $lot" >&2; exit 1; }
echo "API: lote $lot_id aceptado (201)"
wait_for "el lote no apareció en GraphQL" "{ lot(id: \\\"$lot_id\\\") { id status } }" "\"id\":\"$lot_id\""

bidder="22222222-2222-4222-8222-222222222222"
bid="$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$API/v1/lots/$lot_id/bids" \
  -H 'content-type: application/json' -H "x-tenant-id: $TENANT" -H "x-bidder-id: $bidder" -H "idempotency-key: demo-$(date +%s)-$RANDOM" \
  -d '{"amount":"100.00"}')"
[ "$bid" = 202 ] || { echo "✗ la puja no devolvió 202 sino $bid" >&2; exit 1; }
echo "API: puja aceptada (202)"
wait_for "la puja no llegó a la proyección" "{ lot(id: \\\"$lot_id\\\") { currentPrice } }" "\"currentPrice\":\"100.00\""

echo "✓ el flujo completo funciona: REST → comando → decisor → evento → proyección → GraphQL"
