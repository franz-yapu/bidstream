import { createServer, type Server } from 'node:http';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { createYoga } from 'graphql-yoga';
import type { Config } from './config.js';
import { InMemoryNotificationBus, type NotificationBus } from '@bidstream/notifier';
import { createLoaders, type GraphQLContext, type ReadDb } from './context.js';
import { useLimits } from './limits/index.js';
import { resolvers } from './resolvers.js';
import { SubscriptionRegistry } from './subscriptions/registry.js';
import { typeDefs } from './schema.js';
import { resolveTenant } from './tenant.js';

export interface ServerDeps {
  readonly config: Config;
  readonly db: ReadDb;
  /** Bus del que se alimentan las subscriptions; por defecto uno vacío (solo lecturas). */
  readonly bus?: NotificationBus;
}

/** Esquema ejecutable: el SDL de `schema.ts` y sus resolvers. */
export const schema = makeExecutableSchema({
  typeDefs,
  // Los resolvers están tipados contra el contexto; el esquema ejecutable los acepta como `unknown`.
  resolvers: resolvers as never,
});

/**
 * El servidor GraphQL (Yoga), sin escuchar: las pruebas lo invocan con `yoga.fetch(...)`. Un error
 * inesperado se enmascara siempre (el cliente solo ve «Unexpected error.»; el detalle va al log).
 */
export function buildYoga(deps: ServerDeps) {
  const { config } = deps;
  const bus = deps.bus ?? new InMemoryNotificationBus();
  const subscriptions = new SubscriptionRegistry();
  return createYoga<Record<string, never>, GraphQLContext>({
    schema,
    graphqlEndpoint: '/graphql',
    landingPage: false,
    // GraphiQL solo en desarrollo.
    graphiql: config.NODE_ENV === 'development',
    maskedErrors: { isDev: false },
    plugins: [
      useLimits(
        {
          maxDepth: config.GQL_MAX_DEPTH,
          maxComplexity: config.GQL_MAX_COMPLEXITY,
          maxAliases: config.GQL_MAX_ALIASES,
          maxTokens: config.GQL_MAX_TOKENS,
          maxBodyBytes: config.GQL_MAX_BODY_BYTES,
          introspection: config.GQL_INTROSPECTION,
        },
        schema,
      ),
    ],
    // Los lotes de consultas multiplican el coste y esquivarían el cálculo por petición.
    batching: false,
    logging:
      config.LOG_LEVEL === 'silent' ? false : config.LOG_LEVEL === 'error' ? 'error' : 'warn',
    context: ({ request }): GraphQLContext => {
      const tenantId = resolveTenant(request.headers);
      return {
        tenantId,
        db: deps.db,
        loaders: createLoaders(deps.db, tenantId),
        maxPageSize: config.GQL_MAX_PAGE_SIZE,
        bus,
        subscriptions,
        maxSubscriptionsPerTenant: config.GQL_MAX_SUBSCRIPTIONS_PER_TENANT,
        subscriptionQueue: config.GQL_SUBSCRIPTION_QUEUE,
      };
    },
  });
}

/** Servidor HTTP: `/graphql` (Yoga) y `/health`. */
export function buildHttpServer(deps: ServerDeps): Server {
  const yoga = buildYoga(deps);
  return createServer((request, response) => {
    if (request.url === '/health' && request.method === 'GET') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ status: 'ok' }));
      return;
    }
    void yoga(request, response);
  });
}
