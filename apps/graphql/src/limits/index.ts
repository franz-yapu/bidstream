import {
  GraphQLError,
  NoSchemaIntrospectionCustomRule,
  parse,
  type DocumentNode,
  type GraphQLSchema,
  type ParseOptions,
  type Source,
} from 'graphql';
import type { Plugin } from 'graphql-yoga';
import { aliasLimitRule } from './aliases.js';
import { documentComplexity } from './complexity.js';
import { depthLimitRule } from './depth.js';

export interface Limits {
  readonly maxDepth: number;
  readonly maxComplexity: number;
  readonly maxAliases: number;
  readonly maxTokens: number;
  readonly maxBodyBytes: number;
  readonly introspection: boolean;
}

const tooComplex = (actual: number, max: number): GraphQLError =>
  new GraphQLError(
    `La consulta tiene complejidad ${String(actual)}; el máximo es ${String(max)}.`,
    {
      extensions: { code: 'QUERY_TOO_COMPLEX', limit: max, actual, http: { status: 400 } },
    },
  );

/**
 * Límites de abuso de una API GraphQL (spec §7): profundidad, complejidad, alias, tamaño del
 * documento y del cuerpo, e introspección. Se aplican **antes de ejecutar ningún resolver** y por
 * igual a consultas y subscriptions, porque ambas son documentos GraphQL.
 */
export function useLimits(limits: Limits, schema: GraphQLSchema): Plugin {
  return {
    // Cuerpo demasiado grande: se rechaza sin leerlo ni analizarlo.
    onRequest(payload) {
      const { request, fetchAPI } = payload;
      const length = Number(request.headers.get('content-length') ?? '0');
      if (Number.isFinite(length) && length > limits.maxBodyBytes) {
        payload.endResponse(
          new fetchAPI.Response(
            JSON.stringify({
              errors: [
                {
                  message: `El cuerpo supera el máximo de ${String(limits.maxBodyBytes)} bytes.`,
                  extensions: { code: 'QUERY_TOO_LARGE', limit: limits.maxBodyBytes },
                },
              ],
            }),
            { status: 413, headers: { 'content-type': 'application/json' } },
          ),
        );
      }
    },

    // Documento con demasiados tokens: el analizador se detiene al superar el límite.
    onParse({ setParseFn }) {
      setParseFn((source: string | Source, options?: ParseOptions) => {
        try {
          return parse(source, { ...options, maxTokens: limits.maxTokens });
        } catch (error) {
          if (error instanceof GraphQLError && /tokens/i.test(error.message)) {
            throw new GraphQLError(
              `El documento supera el máximo de ${String(limits.maxTokens)} tokens.`,
              {
                extensions: {
                  code: 'QUERY_TOO_LARGE',
                  limit: limits.maxTokens,
                  http: { status: 400 },
                },
              },
            );
          }
          throw error;
        }
      });
    },

    onValidate({ addValidationRule }) {
      addValidationRule(depthLimitRule(limits.maxDepth));
      addValidationRule(aliasLimitRule(limits.maxAliases));
      if (!limits.introspection) addValidationRule(NoSchemaIntrospectionCustomRule);
    },

    // La complejidad depende de las variables (`first: $n`), así que se calcula con la petición.
    onExecute({ args, setResultAndStopExecution }) {
      const actual = complexityOf(args, schema);
      if (actual > limits.maxComplexity) {
        setResultAndStopExecution({ errors: [tooComplex(actual, limits.maxComplexity)] });
      }
    },
    onSubscribe({ args, setResultAndStopExecution }) {
      const actual = complexityOf(args, schema);
      if (actual > limits.maxComplexity) {
        setResultAndStopExecution({ errors: [tooComplex(actual, limits.maxComplexity)] });
      }
    },
  };
}

/** Los argumentos de los hooks de envelop vienen tipados como `any`: aquí se acotan una sola vez. */
function complexityOf(args: unknown, schema: GraphQLSchema): number {
  const { document, variableValues, operationName } = args as {
    document: DocumentNode;
    variableValues?: Record<string, unknown> | null;
    operationName?: string | null;
  };
  return documentComplexity(schema, document, variableValues, operationName);
}

export { depthLimitRule, aliasLimitRule, documentComplexity };
