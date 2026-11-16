// Los importes son cadenas decimales exactas ("105.50"), como en la API: nunca `number`.
// Las comparaciones y sumas se hacen en céntimos con BigInt (misma regla que el dominio).
const MONEY = /^\d+\.\d{2}$/;
const INPUT = /^\d{1,10}(?:[.,]\d{1,2})?$/;

export function toCents(value: string): bigint {
  if (!MONEY.test(value)) throw new TypeError(`importe inválido: ${value}`);
  return BigInt(value.replace('.', ''));
}

export function fromCents(cents: bigint): string {
  const negative = cents < 0n;
  const digits = (negative ? -cents : cents).toString().padStart(3, '0');
  return `${negative ? '-' : ''}${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

export function compareMoney(a: string, b: string): -1 | 0 | 1 {
  const x = toCents(a);
  const y = toCents(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

/**
 * Convierte lo que escribe el usuario ("105", "105,5", "105.50") en `Money`. Devuelve `null` si no es
 * un importe positivo con a lo sumo dos decimales.
 */
export function parseMoneyInput(text: string): string | null {
  const trimmed = text.trim();
  if (!INPUT.test(trimmed)) return null;
  const [whole = '0', fraction = ''] = trimmed.replace(',', '.').split('.');
  const money = `${whole}.${fraction.padEnd(2, '0')}`;
  return toCents(money) > 0n ? money : null;
}

/** «1,234.50 USD»: separador de miles sin pasar por coma flotante. */
export function formatMoney(value: string, currency: string): string {
  const [whole = '0', fraction = '00'] = value.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${grouped}.${fraction} ${currency}`;
}
