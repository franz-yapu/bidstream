import { GraphQLError } from 'graphql';

/** Entrada inválida del cliente (códigos estables; nunca detalles internos). */
export function badInput(message: string): GraphQLError {
  return new GraphQLError(message, {
    extensions: { code: 'BAD_USER_INPUT', http: { status: 400 } },
  });
}

export function unauthenticated(message: string): GraphQLError {
  return new GraphQLError(message, {
    extensions: { code: 'UNAUTHENTICATED', http: { status: 401 } },
  });
}
