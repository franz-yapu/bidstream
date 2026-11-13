import {
  getNamedType,
  isEnumType,
  isScalarType,
  type DocumentNode,
  type GraphQLSchema,
} from 'graphql';
import { getComplexity, type ComplexityEstimator } from 'graphql-query-complexity';

/**
 * Modelo de coste (docs/sdd/E2/SDD.md §2.3): los escalares y enumerados cuestan 0; un campo de objeto
 * cuesta `n × (1 + coste de sus hijos)`, donde `n` es el argumento `first` si existe y 1 si no. Así
 * una lista de `first` elementos con hijos anidados multiplica su coste, que es lo que provoca una
 * denegación de servicio. `first` negativo cuenta como 0: no puede restar coste a otro campo.
 */
export const paginationAwareEstimator: ComplexityEstimator = ({ field, args, childComplexity }) => {
  const named = getNamedType(field.type);
  if (isScalarType(named) || isEnumType(named)) return 0;
  const first: unknown = args['first'];
  const rows = typeof first === 'number' && Number.isFinite(first) ? Math.max(0, first) : 1;
  return rows * (1 + childComplexity);
};

export function documentComplexity(
  schema: GraphQLSchema,
  document: DocumentNode,
  variables: Record<string, unknown> | null | undefined,
  operationName: string | null | undefined,
): number {
  return getComplexity({
    estimators: [paginationAwareEstimator],
    schema,
    query: document,
    variables: variables ?? {},
    ...(operationName === null || operationName === undefined ? {} : { operationName }),
  });
}
