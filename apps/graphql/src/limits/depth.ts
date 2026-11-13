import {
  GraphQLError,
  Kind,
  type ASTVisitor,
  type FragmentDefinitionNode,
  type SelectionSetNode,
  type ValidationContext,
} from 'graphql';

/**
 * Profundidad de un conjunto de selecciones: los campos suman un nivel, y los fragmentos (en línea y
 * con nombre) no suman ninguno. Los campos de introspección (`__schema`, `__type`) no cuentan: su
 * consulta estándar es profunda y está controlada por la política de introspección.
 */
function depthOf(
  selectionSet: SelectionSetNode,
  fragments: ReadonlyMap<string, FragmentDefinitionNode>,
  memo: Map<string, number>,
  path: Set<string>,
): number {
  let deepest = 0;
  for (const selection of selectionSet.selections) {
    if (selection.kind === Kind.FIELD) {
      if (selection.name.value.startsWith('__')) continue;
      const below = selection.selectionSet
        ? depthOf(selection.selectionSet, fragments, memo, path)
        : 0;
      deepest = Math.max(deepest, 1 + below);
    } else if (selection.kind === Kind.INLINE_FRAGMENT) {
      deepest = Math.max(deepest, depthOf(selection.selectionSet, fragments, memo, path));
    } else {
      const name = selection.name.value;
      const fragment = fragments.get(name);
      // Un ciclo de fragmentos lo rechaza la validación estándar; aquí solo se evita colgarse.
      if (fragment === undefined || path.has(name)) continue;
      const known = memo.get(name);
      if (known !== undefined) {
        deepest = Math.max(deepest, known);
        continue;
      }
      path.add(name);
      const depth = depthOf(fragment.selectionSet, fragments, memo, path);
      path.delete(name);
      memo.set(name, depth); // memoizar evita el coste exponencial con fragmentos que se referencian
      deepest = Math.max(deepest, depth);
    }
  }
  return deepest;
}

/** Regla de validación: ninguna operación puede superar `max` niveles de profundidad. */
export function depthLimitRule(max: number): (context: ValidationContext) => ASTVisitor {
  return (context) => {
    const fragments = new Map<string, FragmentDefinitionNode>();
    for (const definition of context.getDocument().definitions) {
      if (definition.kind === Kind.FRAGMENT_DEFINITION)
        fragments.set(definition.name.value, definition);
    }
    const memo = new Map<string, number>();
    return {
      OperationDefinition(node) {
        const depth = depthOf(node.selectionSet, fragments, memo, new Set());
        if (depth > max) {
          context.reportError(
            new GraphQLError(
              `La consulta tiene profundidad ${String(depth)}; el máximo es ${String(max)}.`,
              {
                nodes: [node],
                extensions: { code: 'QUERY_TOO_DEEP', limit: max, actual: depth },
              },
            ),
          );
        }
      },
    };
  };
}

export { depthOf };
