# syntax=docker/dockerfile:1
#
# Imagen estática del front (J1): se construye con Vite y la sirve nginx sin privilegios en :8080.
# Contexto: la raíz del repositorio (`docker build -f apps/web/Dockerfile .`), porque instala el
# workspace con el `package-lock.json` raíz. La configuración (URL de la API y de GraphQL) llega por
# variables de entorno al ARRANCAR, no al compilar: la misma imagen sirve en cualquier entorno.
ARG NODE_IMAGE=node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee
ARG NGINX_IMAGE=nginxinc/nginx-unprivileged@sha256:f5116ed4606f3eb015dd4a8e28cb9b351476dc0ad4bc6e9f93b19cec130cdf03

# 1. Compila la SPA.
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages ./packages
COPY apps ./apps
RUN npm ci --ignore-scripts --workspace apps/web --include-workspace-root \
 && npm run build -w @bidstream/web

# 2. Servidor estático (usuario nginx sin privilegios, sin shell de aplicación).
FROM ${NGINX_IMAGE} AS runtime
COPY --from=build --chown=root:root /app/apps/web/dist /usr/share/nginx/html
COPY --chown=root:root apps/web/docker/default.conf /etc/nginx/conf.d/default.conf
COPY --chown=root:root apps/web/docker/server.conf.template /etc/bidstream/server.conf.template
COPY --chown=root:root apps/web/docker/40-bidstream-config.sh /docker-entrypoint.d/40-bidstream-config.sh
# `config.js` lo escribe el arranque (usuario nginx): solo ese archivo es escribible
COPY --chown=101:101 apps/web/public/config.js /usr/share/nginx/html/config.js
ENV API_URL=http://localhost:3000 \
    GRAPHQL_URL=http://localhost:4000/graphql \
    DEFAULT_TENANT_ID=
EXPOSE 8080
