#!/bin/sh
# Genera, al arrancar, la configuración de ejecución del front a partir de variables de entorno:
#  - /usr/share/nginx/html/config.js  (URL de la API, de GraphQL y tenant por defecto)
#  - /tmp/bidstream-server.conf       (servidor nginx con la CSP restringida a esas URL)
# Los valores se validan: una URL o un UUID mal formados abortan el arranque, nunca se inyectan.
set -eu

fail() { echo "bidstream-web: $*" >&2; exit 1; }
url_re='^https?://[A-Za-z0-9.-]+(:[0-9]+)?(/[A-Za-z0-9._~/-]*)?$'
echo "$API_URL" | grep -Eq "$url_re" || fail "API_URL no es una URL http(s) válida"
echo "$GRAPHQL_URL" | grep -Eq "$url_re" || fail "GRAPHQL_URL no es una URL http(s) válida"
if [ -n "${DEFAULT_TENANT_ID:-}" ]; then
  echo "$DEFAULT_TENANT_ID" | grep -Eq '^[0-9a-fA-F-]{36}$' || fail "DEFAULT_TENANT_ID no es un UUID"
fi

origin() { echo "$1" | sed -E 's#^(https?://[^/]+).*#\1#'; }
CONNECT_SRC="$(origin "$API_URL") $(origin "$GRAPHQL_URL")"

cat > /usr/share/nginx/html/config.js <<JS
window.__BIDSTREAM_CONFIG__ = {
  apiUrl: "$API_URL",
  graphqlUrl: "$GRAPHQL_URL",
  defaultTenantId: "${DEFAULT_TENANT_ID:-}",
};
JS

sed "s#__CONNECT_SRC__#$CONNECT_SRC#g" /etc/bidstream/server.conf.template > /tmp/bidstream-server.conf
echo "bidstream-web: configuración generada (API $(origin "$API_URL"), GraphQL $(origin "$GRAPHQL_URL"))"
