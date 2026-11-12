/** Error con respuesta HTTP definida; el manejador central lo traduce a `problem+json`. */
export class ProblemError extends Error {
  constructor(
    readonly status: number,
    readonly type: string,
    readonly title: string,
    readonly detail?: string,
    readonly headers: Readonly<Record<string, string>> = {},
  ) {
    super(detail ?? title);
    this.name = 'ProblemError';
  }
}
