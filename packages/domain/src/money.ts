/** Dinero en centavos como `bigint`: aritmética exacta, nunca flotantes (business-rules #6). */
export type Money = bigint;

const MONEY_RE = /^(\d{1,10})(?:\.(\d{1,2}))?$/;

/** `'105.5'` → `10550n`. Acepta el string decimal del contrato (`Decimal(12,2)`). */
export function parseMoney(value: string): Money {
  const match = MONEY_RE.exec(value);
  if (match?.[1] === undefined) throw new RangeError(`monto inválido: ${value}`);
  const cents = (match[2] ?? '').padEnd(2, '0');
  return BigInt(match[1]) * 100n + BigInt(cents);
}

/** `10550n` → `'105.50'` (siempre dos decimales). */
export function formatMoney(money: Money): string {
  if (money < 0n) throw new RangeError('un monto no puede ser negativo');
  const whole = money / 100n;
  const cents = (money % 100n).toString().padStart(2, '0');
  return `${whole.toString()}.${cents}`;
}
