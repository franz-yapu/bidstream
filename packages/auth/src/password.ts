import argon2 from 'argon2';

/** Parámetros de Argon2id recomendados por OWASP (19 MiB, 2 iteraciones, 1 hilo). */
const OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export const hashPassword = (password: string): Promise<string> => argon2.hash(password, OPTIONS);

/** `true` solo si la contraseña corresponde al hash; un hash malformado es `false`, no una excepción. */
export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

let dummy: Promise<string> | undefined;

/**
 * Verifica contra un hash falso para que «usuario inexistente» y «contraseña incorrecta» cuesten lo
 * mismo (sin enumeración de usuarios por tiempo de respuesta).
 */
export async function verifyAgainstDummy(password: string): Promise<void> {
  dummy ??= hashPassword('contraseña-falsa-para-igualar-tiempos');
  await verifyPassword(await dummy, password);
}

/** Problemas de una contraseña según la política; vacío si es aceptable. */
export function passwordProblems(password: string, email: string): string[] {
  const problems: string[] = [];
  if (password.length < PASSWORD_MIN_LENGTH) {
    problems.push(`debe tener al menos ${String(PASSWORD_MIN_LENGTH)} caracteres`);
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    problems.push(`debe tener como máximo ${String(PASSWORD_MAX_LENGTH)} caracteres`);
  }
  if (/^(.)\1+$/.test(password)) problems.push('no puede ser un solo carácter repetido');
  const local = email.split('@')[0]?.toLowerCase() ?? '';
  if (local.length >= 4 && password.toLowerCase().includes(local)) {
    problems.push('no puede contener el nombre de su correo');
  }
  return problems;
}
