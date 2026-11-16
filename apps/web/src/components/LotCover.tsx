// Portada de un lote generada a partir de su id: formas planas con los colores de la paleta, siempre la
// misma para el mismo lote. No pretende ser una foto del objeto: es una marca visual para reconocerlo.
const PALETTES = [
  { ground: '#1e4a38', a: '#dce7df', b: '#143527' },
  { ground: '#e4dccb', a: '#1e4a38', b: '#d7ccb5' },
  { ground: '#17211b', a: '#e4dccb', b: '#1e4a38' },
  { ground: '#dce7df', a: '#143527', b: '#1e4a38' },
  { ground: '#d7ccb5', a: '#17211b', b: '#fbf8f2' },
] as const;

/** Hash estable (FNV-1a de 32 bits) de una cadena. */
export function hashOf(text: string): number {
  let hash = 0x811c9dc5;
  for (const char of text) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

export function LotCover({
  seed,
  className = '',
}: {
  /** Normalmente el id del lote. */
  seed: string;
  className?: string;
}) {
  const h = hashOf(seed);
  const palette = PALETTES[h % PALETTES.length] ?? PALETTES[0];
  const layout = (h >>> 4) % 4;
  const shift = ((h >>> 8) % 40) - 20;
  const size = 90 + ((h >>> 12) % 60);

  return (
    <svg
      viewBox="0 0 400 220"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      className={`block h-full w-full ${className}`}
      data-testid="lot-cover"
    >
      <rect width="400" height="220" fill={palette.ground} />
      {layout === 0 && (
        <>
          <circle cx={250 + shift} cy="110" r={size} fill={palette.a} />
          <circle cx={250 + shift} cy="110" r={size * 0.62} fill={palette.b} />
          <circle cx={250 + shift} cy="110" r={size * 0.26} fill={palette.ground} />
        </>
      )}
      {layout === 1 && (
        <>
          <rect x={70 + shift} y="30" width="70" height="190" fill={palette.a} />
          <rect x={160 + shift} y="70" width="70" height="150" fill={palette.b} />
          <rect x={250 + shift} y="110" width="70" height="110" fill={palette.a} />
        </>
      )}
      {layout === 2 && (
        <>
          <path
            d={`M0 220 L${String(180 + shift)} 40 L${String(340 + shift)} 220 Z`}
            fill={palette.a}
          />
          <path d={`M120 220 L${String(260 + shift)} 90 L400 220 Z`} fill={palette.b} />
        </>
      )}
      {layout === 3 && (
        <>
          <circle cx={120 + shift} cy="70" r={size * 0.55} fill={palette.a} />
          <rect x="190" y="90" width="170" height="130" fill={palette.b} />
          <circle cx="300" cy="90" r={size * 0.35} fill={palette.a} />
        </>
      )}
    </svg>
  );
}
