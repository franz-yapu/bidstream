export const DISPLAY_NAME_MIN_LENGTH = 2;
export const DISPLAY_NAME_MAX_LENGTH = 30;

// Letras, números, espacios y . _ - ' (sin HTML, sin saltos de línea ni caracteres de control).
const ALLOWED = /^[\p{L}\p{N}][\p{L}\p{N} ._'-]*$/u;

/** Normaliza lo que escribe el usuario: recorta y colapsa los espacios repetidos. */
export function normalizeDisplayName(value: string): string {
  return value.normalize('NFC').trim().replace(/\s+/g, ' ');
}

/** Motivos por los que un nombre público no es aceptable (vacío = válido). Recibe el nombre normalizado. */
export function displayNameProblems(name: string): string[] {
  const problems: string[] = [];
  const length = Array.from(name).length; // puntos de código, como `char_length` de PostgreSQL
  if (length < DISPLAY_NAME_MIN_LENGTH || length > DISPLAY_NAME_MAX_LENGTH) {
    problems.push(
      `debe tener entre ${String(DISPLAY_NAME_MIN_LENGTH)} y ${String(DISPLAY_NAME_MAX_LENGTH)} caracteres`,
    );
  }
  if (!ALLOWED.test(name)) {
    problems.push("solo letras, números, espacios y . _ - ' (debe empezar por letra o número)");
  }
  return problems;
}

/** Alias por defecto cuando no se elige nombre (usuarios creados por un administrador). */
export function defaultDisplayName(role: string, id: string): string {
  const suffix = id.replace(/-/g, '').slice(0, 4);
  return `${role === 'ADMIN' ? 'Administrador' : 'Postor'} ${suffix}`;
}
