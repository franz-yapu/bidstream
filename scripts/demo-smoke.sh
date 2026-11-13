#!/usr/bin/env bash
# Comprueba el sistema levantado por `make demo`, con autenticación real (F1) y eventos firmados (F3):
# el administrador de la demo crea una subasta y un lote, un postor se registra y puja (la decide el
# consumidor decisor) y todo aparece por GraphQL con el token del postor.
set -euo pipefail

API="http://localhost:${API_PORT:-3000}"
GQL="http://localhost:${GRAPHQL_PORT:-4000}/graphql"
ENV_FILE="${AUTH_ENV_FILE:-.env.auth.private}"
fail() { echo "✗ $*" >&2; exit 1; }

[ -f "$ENV_FILE" ] || fail "falta $ENV_FILE: ejecuta make demo (genera las credenciales de la demo)"
env_value() { sed -n "s/^$1=//p" "$ENV_FILE" | head -1; }
TENANT="$(env_value BOOTSTRAP_ADMIN_TENANT_ID)"
ADMIN_EMAIL="$(env_value BOOTSTRAP_ADMIN_EMAIL)"
ADMIN_PASSWORD="$(env_value BOOTSTRAP_ADMIN_PASSWORD)"

json() { sed -n "s/.*\"$1\":\"\\([^\"]*\\)\".*/\\1/p"; }
status() { curl -sS -o /dev/null -w '%{http_code}' "$@"; }

# 0. sin token no se entra
[ "$(status -X POST "$API/v1/auctions" -H 'content-type: application/json' -d '{}')" = 401 ] \
  || fail "la API aceptó una petición sin token"
echo "API: sin token → 401"

# 1. el administrador entra
login="$(curl -fsS -X POST "$API/v1/auth/login" -H 'content-type: application/json' \
  -d "{\"tenantId\":\"$TENANT\",\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}")"
admin_token="$(printf '%s' "$login" | json accessToken)"
[ -n "$admin_token" ] || fail "el administrador no pudo entrar: $login"
echo "API: administrador autenticado"

# 2. subasta y lote (los publica el administrador)
auth_admin=(-H "authorization: Bearer $admin_token" -H 'content-type: application/json')
created="$(curl -fsS -X POST "$API/v1/auctions" "${auth_admin[@]}" \
  -d '{"title":"Subasta de prueba","opensAt":"2030-01-01T10:00:00.000Z","closesAt":"2030-01-01T20:00:00.000Z"}')"
auction_id="$(printf '%s' "$created" | json auctionId)"
[ -n "$auction_id" ] || fail "la API no devolvió auctionId: $created"
echo "API: subasta $auction_id aceptada (201)"

# 3. un postor se registra y entra
bidder_email="postor-$RANDOM@demo.local"
bidder_password="contraseña-del-postor-$RANDOM"
reg="$(status -X POST "$API/v1/auth/register" -H 'content-type: application/json' \
  -d "{\"tenantId\":\"$TENANT\",\"email\":\"$bidder_email\",\"password\":\"$bidder_password\"}")"
[ "$reg" = 201 ] || fail "el registro del postor devolvió $reg"
bidder_login="$(curl -fsS -X POST "$API/v1/auth/login" -H 'content-type: application/json' \
  -d "{\"tenantId\":\"$TENANT\",\"email\":\"$bidder_email\",\"password\":\"$bidder_password\"}")"
bidder_token="$(printf '%s' "$bidder_login" | json accessToken)"
[ -n "$bidder_token" ] || fail "el postor no pudo entrar"
echo "API: postor registrado y autenticado"

gql() { # token, consulta → cuerpo de la respuesta
  curl -fsS -X POST "$GQL" -H 'content-type: application/json' -H "authorization: Bearer $1" \
    -d "{\"query\":\"$2\"}" || true
}
wait_for() { # descripción, consulta, texto esperado
  local out=""
  for _ in $(seq 1 60); do
    out="$(gql "$bidder_token" "$2")"
    if [[ "$out" == *"$3"* ]]; then echo "GraphQL: $out"; return 0; fi
    sleep 1
  done
  fail "$1: $out"
}

# GraphQL tampoco responde sin token
[ "$(status -X POST "$GQL" -H 'content-type: application/json' -d '{"query":"{ __typename }"}')" = 401 ] \
  || fail "GraphQL respondió sin token"
echo "GraphQL: sin token → 401"

wait_for "la subasta no apareció en GraphQL" "{ auction(id: \\\"$auction_id\\\") { id title status } }" "\"id\":\"$auction_id\""

lot="$(curl -fsS -X POST "$API/v1/auctions/$auction_id/lots" "${auth_admin[@]}" \
  -d '{"title":"Lote de prueba","startingPrice":"100.00","minIncrement":"5.00","currency":"USD","closesAt":"2030-01-01T18:00:00.000Z"}')"
lot_id="$(printf '%s' "$lot" | json lotId)"
[ -n "$lot_id" ] || fail "la API no devolvió lotId: $lot"
echo "API: lote $lot_id aceptado (201)"
wait_for "el lote no apareció en GraphQL" "{ lot(id: \\\"$lot_id\\\") { id status } }" "\"id\":\"$lot_id\""

# 4. el postor puja (lo decide el consumidor decisor) y el administrador no puede pujar
[ "$(status -X POST "$API/v1/lots/$lot_id/bids" "${auth_admin[@]}" -H "idempotency-key: demo-admin-$RANDOM-$RANDOM" \
  -d '{"amount":"100.00"}')" = 403 ] || fail "un administrador pudo pujar"
bid="$(status -X POST "$API/v1/lots/$lot_id/bids" -H 'content-type: application/json' \
  -H "authorization: Bearer $bidder_token" -H "idempotency-key: demo-$(date +%s)-$RANDOM" \
  -d '{"amount":"100.00"}')"
[ "$bid" = 202 ] || fail "la puja no devolvió 202 sino $bid"
echo "API: puja aceptada (202)"
wait_for "la puja no llegó a la proyección" "{ lot(id: \\\"$lot_id\\\") { currentPrice } }" "\"currentPrice\":\"100.00\""

echo "✓ el flujo completo funciona: JWT → REST → comando → decisor → evento firmado → proyección → GraphQL"
