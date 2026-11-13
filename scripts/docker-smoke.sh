#!/usr/bin/env bash
# Prueba de humo de las imágenes (H2): no root, sin fuentes ni secretos, falla claro sin configuración
# y arranca de verdad contra Kafka y PostgreSQL (`make up`). Uso: scripts/docker-smoke.sh [app…]
set -euo pipefail

APPS=("$@")
[ ${#APPS[@]} -gt 0 ] || APPS=(api relay projector auditor notifier graphql decider closer)
DB="${SMOKE_DATABASE_URL:-postgresql://bidstream:bidstream@localhost:5432/bidstream}"
BROKERS="${SMOKE_KAFKA_BROKERS:-localhost:9092}"
fail() { echo "✗ $*" >&2; exit 1; }

# Los procesos usan los grupos de consumidores reales (`projector`, `notifier`…): contra un clúster
# con datos, consumirían y confirmarían sus offsets. Solo en CI o en un entorno desechable.
if [ "${CI:-}" != true ] && [ "${SMOKE_DISPOSABLE:-}" != 1 ]; then
  fail "usa un entorno desechable (make reset) y SMOKE_DISPOSABLE=1; la CI lo cumple"
fi

for app in "${APPS[@]}"; do
  image="bidstream-$app:test"
  echo "== $app"

  [ "$(docker run --rm --entrypoint id "$image" -u)" != "0" ] || fail "$app corre como root"
  docker run --rm --entrypoint sh "$image" -c '
    test -z "$(find / -xdev \( -name ".env" -o -name ".env.*" \) 2>/dev/null)" || exit 10
    test -z "$(find /app/packages /app/apps -type d -name src 2>/dev/null)" || exit 11
    test ! -e /app/node_modules/vitest || exit 12
    test ! -e /app/node_modules/eslint || exit 13
    test ! -e /app/node_modules/typescript || exit 14' || fail "$app: contenido indebido en la imagen (código $?)"

  # sin configuración debe fallar con un mensaje que nombre la variable que falta
  out="$(docker run --rm "$image" 2>&1 || true)"
  [[ "$out" == *DATABASE_URL* ]] || fail "$app sin DATABASE_URL no dio un error claro"

  # con configuración debe arrancar
  name="smoke-$app-$$"
  port=$((13000 + RANDOM % 1000))
  case "$app" in
    api) extra=(-e PORT="$port" -e NODE_ENV=development) ;;  # en producción no arranca hasta F1 (Q4)
    graphql) extra=(-e GRAPHQL_PORT="$port" -e NODE_ENV=development) ;;
    *) extra=() ;;
  esac
  docker run -d --rm --name "$name" --network host \
    -e DATABASE_URL="$DB" -e KAFKA_BROKERS="$BROKERS" "${extra[@]}" "$image" >/dev/null
  ok=0
  for _ in $(seq 1 40); do
    if [ "$app" = api ] || [ "$app" = graphql ]; then
      path=/health; [ "$app" = api ] && path=/v1/health
      curl -fsS "http://localhost:$port$path" >/dev/null 2>&1 && ok=1 && break
    else
      [[ "$(docker logs "$name" 2>&1)" == *iniciado* ]] && ok=1 && break
    fi
    docker inspect "$name" >/dev/null 2>&1 || break
    sleep 1
  done
  logs="$(docker logs "$name" 2>&1 || true)"
  docker stop -t 5 "$name" >/dev/null 2>&1 || true
  [ "$ok" = 1 ] || { echo "$logs" | tail -20; fail "$app no arrancó"; }
  [[ "$logs" != *"$DB"* ]] || fail "$app registró la cadena de conexión"
  echo "✓ $app"
done
