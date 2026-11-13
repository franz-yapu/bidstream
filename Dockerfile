# syntax=docker/dockerfile:1
#
# Una imagen por proceso: `docker build --build-arg APP=<api|relay|projector|auditor|notifier|graphql|decider|closer> .`
# Multi-etapa, usuario no root y sin secretos: toda la configuración llega por variables de entorno
# en tiempo de ejecución (docs/sdd/H2/SDD.md). Base fijada por digest (Dependabot la actualiza).
# glibc (bookworm), no Alpine: @confluentinc/kafka-javascript es un binario nativo.
ARG NODE_IMAGE=node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee

# 1. Compila todo el monorepo (necesita las dependencias de desarrollo).
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
RUN npm ci --ignore-scripts \
 && npm run db:generate -w @bidstream/db \
 && npm run build \
 # solo se queda lo compilado: sin fuentes, pruebas ni artefactos de TypeScript
 && find packages apps -type d -name src -prune -exec rm -rf {} + \
 && find packages apps -name '*.tsbuildinfo' -delete

# 2. Dependencias de producción de ese proceso (y solo de él).
FROM ${NODE_IMAGE} AS prod-deps
ARG APP
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages ./packages
COPY apps ./apps
# --ignore-scripts por política (F6); el único binario nativo se reconstruye de forma explícita.
RUN npm ci --omit=dev --ignore-scripts --workspace apps/${APP} --include-workspace-root \
 && npm rebuild @confluentinc/kafka-javascript \
 # `@prisma/client` arrastra la CLI de Prisma y su estudio (no se usan en ejecución: el cliente ya
 # está generado y compilado); se quitan junto a TypeScript, que solo ellos traen
 && rm -rf node_modules/prisma node_modules/@prisma/studio-core node_modules/@prisma/dev \
    node_modules/typescript node_modules/@electric-sql node_modules/react node_modules/react-dom

# 3. Imagen final: solo node_modules de producción y lo compilado.
FROM ${NODE_IMAGE} AS runtime
ARG APP
ENV NODE_ENV=production \
    APP=${APP}
WORKDIR /app
COPY --from=prod-deps --chown=root:root /app/node_modules ./node_modules
COPY --from=build --chown=root:root /app/package.json ./package.json
COPY --from=build --chown=root:root /app/packages ./packages
COPY --from=build --chown=root:root /app/apps/${APP} ./apps/${APP}
USER node
CMD ["sh", "-c", "exec node apps/${APP}/dist/main.js"]
