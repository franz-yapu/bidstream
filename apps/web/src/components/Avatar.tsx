/** Iniciales del nombre público sobre un fondo de la paleta (según el nombre, siempre el mismo). */
const TONES = [
  'bg-forest-tint text-forest',
  'bg-sand text-ink',
  'bg-forest text-paper',
  'bg-sand-deep text-ink',
] as const;

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? [words[0], words[words.length - 1]] : [words[0] ?? '?'];
  return letters
    .map((w) => Array.from(w ?? '?')[0] ?? '?')
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function toneFor(name: string): string {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 997;
  return TONES[hash % TONES.length] ?? TONES[0];
}

export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size }}
      className={`inline-flex shrink-0 items-center justify-center rounded-full text-[13px] font-semibold ${toneFor(name)}`}
    >
      {initials(name)}
    </span>
  );
}
