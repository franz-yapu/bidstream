import { GraphQLError, type ASTVisitor, type ValidationContext } from 'graphql';

/**
 * Regla de validación: como mucho `max` alias en todo el documento. Frena el *alias overloading*
 * (pedir la misma consulta cara muchas veces con alias distintos en una sola petición).
 */
export function aliasLimitRule(max: number): (context: ValidationContext) => ASTVisitor {
  return (context) => {
    let count = 0;
    return {
      Field(node) {
        if (node.alias !== undefined) count += 1;
      },
      Document: {
        leave(node) {
          if (count > max) {
            context.reportError(
              new GraphQLError(
                `La consulta usa ${String(count)} alias; el máximo es ${String(max)}.`,
                {
                  nodes: [node],
                  extensions: { code: 'TOO_MANY_ALIASES', limit: max, actual: count },
                },
              ),
            );
          }
        },
      },
    };
  };
}
