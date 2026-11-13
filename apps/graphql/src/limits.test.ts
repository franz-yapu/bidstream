import { parse, validate } from 'graphql';
import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';
import { aliasLimitRule } from './limits/aliases.js';
import { documentComplexity } from './limits/complexity.js';
import { depthLimitRule } from './limits/depth.js';
import { schema } from './server.js';

const codes = (errors: readonly { extensions: Record<string, unknown> }[]): unknown[] =>
  errors.map((e) => e.extensions['code']);
const check = (
  query: string,
  rule: ReturnType<typeof depthLimitRule>,
): readonly { message: string; extensions: Record<string, unknown> }[] =>
  validate(schema, parse(query), [rule]);

// auction → lots → auction → lots …: cada par suma dos niveles.
const nest = (levels: number): string => {
  let inner = 'id';
  for (let i = 0; i < levels; i++)
    inner = i % 2 === 0 ? `lots { ${inner} }` : `auction { ${inner} }`;
  return `{ auction(id: "x") { ${inner} } }`;
};

describe('profundidad', () => {
  it('acepta exactamente el máximo (7) y rechaza uno más (8) con QUERY_TOO_DEEP', () => {
    // la profundidad cuenta también el campo hoja: auction + 5 niveles + `id` = 7
    expect(check(nest(5), depthLimitRule(7))).toHaveLength(0);
    const errors = check(nest(6), depthLimitRule(7));
    expect(codes(errors)).toEqual(['QUERY_TOO_DEEP']);
    expect(errors[0]?.message).toMatch(/profundidad 8.*máximo es 7/);
    expect(errors[0]?.extensions).toMatchObject({ limit: 7, actual: 8 });
  });

  it('cuenta la profundidad a través de fragmentos en línea y con nombre', () => {
    const named = `
      query { auction(id: "x") { ...A } }
      fragment A on Auction { lots { ...B } }
      fragment B on Lot { auction { lots { auction { id } } } }`;
    // auction → lots → auction → lots → auction → id: profundidad 6
    expect(codes(check(named, depthLimitRule(5)))).toEqual(['QUERY_TOO_DEEP']);
    expect(check(named, depthLimitRule(6))).toHaveLength(0);
    const inline = `{ auction(id: "x") { ... on Auction { lots { ... on Lot { auction { lots { id } } } } } } }`;
    expect(codes(check(inline, depthLimitRule(4)))).toEqual(['QUERY_TOO_DEEP']);
    expect(check(inline, depthLimitRule(5))).toHaveLength(0);
  });

  it('un fragmento recursivo no cuelga el validador', () => {
    const cyclic = `{ auction(id: "x") { ...A } } fragment A on Auction { lots { auction { ...A } } }`;
    const started = Date.now();
    expect(() => check(cyclic, depthLimitRule(7))).not.toThrow();
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('fragmentos que se referencian en cadena no provocan coste exponencial', () => {
    const fragments = Array.from({ length: 40 }, (_, i) =>
      i === 39
        ? `fragment F39 on Auction { id }`
        : `fragment F${String(i)} on Auction { lots { auction { ...F${String(i + 1)} ...F${String(i + 1)} } } }`,
    ).join('\n');
    const started = Date.now();
    check(`{ auction(id: "x") { ...F0 } } ${fragments}`, depthLimitRule(7));
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('la introspección no cuenta (su consulta estándar es profunda)', () => {
    const introspection = `{ __schema { types { fields { type { ofType { ofType { ofType { name } } } } } } } }`;
    expect(check(introspection, depthLimitRule(3))).toHaveLength(0);
  });
});

describe('alias', () => {
  const aliased = (n: number): string =>
    `{ ${Array.from({ length: n }, (_, i) => `a${String(i)}: auction(id: "x") { id }`).join(' ')} }`;

  it('acepta 15 alias y rechaza 16 con TOO_MANY_ALIASES', () => {
    expect(check(aliased(15), aliasLimitRule(15))).toHaveLength(0);
    const errors = check(aliased(16), aliasLimitRule(15));
    expect(codes(errors)).toEqual(['TOO_MANY_ALIASES']);
    expect(errors[0]?.extensions).toMatchObject({ limit: 15, actual: 16 });
  });

  it('los campos sin alias no cuentan', () => {
    const plain = `{ ${Array.from({ length: 50 }, () => 'auction(id: "x") { id }').join(' ')} }`;
    expect(check(plain, aliasLimitRule(15))).toHaveLength(0);
  });
});

describe('complejidad (consciente de first)', () => {
  const cost = (query: string, variables?: Record<string, unknown>): number =>
    documentComplexity(schema, parse(query), variables, undefined);

  it('la consulta legítima de referencia cuesta 42', () => {
    expect(
      cost(
        `{ lot(id: "x") { auction { lots(first: 10) { title } } bids(first: 10) { edges { node { amount } } } } }`,
      ),
    ).toBe(42);
  });

  it('una lista de 100 con otra de 100 anidada cuesta 30 100 y con first: 1 solo 4', () => {
    const query = (n: number): string =>
      `{ activeLots(auctionId: "x", first: ${String(n)}) { bids(first: ${String(n)}) { edges { node { id } } } } }`;
    expect(cost(query(100))).toBe(30_100);
    expect(cost(query(1))).toBe(4);
  });

  it('el coste depende de first aunque llegue como variable', () => {
    const query = `query($n: Int) { activeLots(auctionId: "x", first: $n) { id } }`;
    expect(cost(query, { n: 100 })).toBe(100);
    expect(cost(query, { n: 3 })).toBe(3);
  });

  it('un first negativo no puede restar coste a otro campo', () => {
    const query = `{ a: activeLots(auctionId: "x", first: 100) { id } b: activeLots(auctionId: "x", first: -100) { id } }`;
    expect(cost(query)).toBe(100);
  });

  it('sin first se usa el valor por defecto del esquema (50)', () => {
    expect(cost(`{ auction(id: "x") { lots { id } } }`)).toBe(51);
  });

  it('los escalares y enumerados no cuestan', () => {
    expect(cost(`{ lot(id: "x") { id title status currentPrice } }`)).toBe(1);
  });
});

describe('configuración de los límites', () => {
  const base = { DATABASE_URL: 'postgresql://u:p@localhost:5432/d' };

  it('valores por defecto', () => {
    expect(loadConfig(base)).toMatchObject({
      GQL_MAX_DEPTH: 7,
      GQL_MAX_COMPLEXITY: 1_000,
      GQL_MAX_ALIASES: 15,
      GQL_MAX_TOKENS: 2_000,
      GQL_MAX_BODY_BYTES: 102_400,
      GQL_MAX_PAGE_SIZE: 100,
      GQL_INTROSPECTION: true,
    });
  });

  it('se leen del entorno', () => {
    expect(
      loadConfig({
        ...base,
        GQL_MAX_DEPTH: '5',
        GQL_MAX_COMPLEXITY: '500',
        GQL_MAX_ALIASES: '3',
        GQL_INTROSPECTION: 'false',
      }),
    ).toMatchObject({
      GQL_MAX_DEPTH: 5,
      GQL_MAX_COMPLEXITY: 500,
      GQL_MAX_ALIASES: 3,
      GQL_INTROSPECTION: false,
    });
  });

  it.each([
    { GQL_MAX_DEPTH: '0' },
    { GQL_MAX_COMPLEXITY: 'mucha' },
    { GQL_MAX_ALIASES: '-1' },
    { GQL_MAX_TOKENS: '10' },
    { GQL_MAX_BODY_BYTES: '5' },
    { GQL_INTROSPECTION: 'quizá' },
  ])('un valor inválido falla al arrancar: %j', (env) => {
    expect(() => loadConfig({ ...base, ...env })).toThrow();
  });
});
