// Portada de un lote generada a partir de su id: formas planas con los colores de la paleta, siempre la
// misma para el mismo lote. No pretende ser una foto del objeto: es una marca visual para reconocerlo.
const PALETTES = [
  { ground: '#b6f500', a: '#d9d2be', b: '#2a1a33' },
  { ground: '#46304f', a: '#b6f500', b: '#5d4568' },
  { ground: '#1b0f22', a: '#46304f', b: '#b6f500' },
  { ground: '#d9d2be', a: '#2a1a33', b: '#b6f500' },
  { ground: '#5d4568', a: '#1b0f22', b: '#efe9d6' },
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

type Category = 'clock' | 'map' | 'vase' | 'tea' | 'frame' | 'desk' | null;

/**
 * Fotografías de dominio público (colección de acceso abierto del Metropolitan Museum of Art, CC0),
 * guardadas en `public/lots`; los créditos están en `CREDITS.md`. Varias por tipo: el lote elige una
 * según su identificador.
 */
const PHOTOS: Record<Exclude<Category, null>, readonly string[]> = {
  clock: ['clock-1', 'clock-2'],
  map: ['map-1', 'map-2'],
  vase: ['vase-1', 'vase-2', 'vase-3'],
  tea: ['tea-1', 'tea-2'],
  frame: ['frame-1', 'frame-2', 'frame-3'],
  desk: ['desk-1'],
};

/** Qué objeto representa la portada, según palabras del título; sin coincidencia, formas abstractas. */
export function categoryOf(title: string | undefined): Category {
  const t = (title ?? '').toLowerCase();
  if (/reloj|cron[oó]graf|péndulo/.test(t)) return 'clock';
  if (/mapa|cartograf|plano|carta n[aá]utica|atlas/.test(t)) return 'map';
  if (/tetera|t[eé]\b|taza|plata|cubiertos|cafetera/.test(t)) return 'tea';
  if (/jarr[oó]n|porcelana|cer[aá]mic|vajilla|vidrio|florero/.test(t)) return 'vase';
  if (/grabado|cuadro|[oó]leo|pintura|l[aá]mina|postal|fotograf|dibujo/.test(t)) return 'frame';
  if (/escritorio|mueble|nogal|silla|mesa|c[oó]moda|armario/.test(t)) return 'desk';
  return null;
}

/** El objeto, dibujado con formas planas de la paleta y centrado a la derecha del fondo. */
function Drawing({
  kind,
  a,
  ground,
}: {
  kind: Exclude<Category, null>;
  a: string;
  ground: string;
}) {
  switch (kind) {
    case 'clock':
      return (
        <g transform="translate(255 110)">
          <circle r="86" fill={a} />
          <circle r="72" fill={ground} />
          {Array.from({ length: 12 }, (_, i) => (
            <rect
              key={i}
              x="-2"
              y="-66"
              width="4"
              height={i % 3 === 0 ? 14 : 7}
              fill={a}
              transform={`rotate(${String(i * 30)})`}
            />
          ))}
          <rect x="-3" y="-46" width="6" height="50" rx="3" fill={a} transform="rotate(28)" />
          <rect x="-3" y="-34" width="6" height="38" rx="3" fill={a} transform="rotate(-62)" />
          <circle r="7" fill={a} />
        </g>
      );
    case 'map':
      return (
        <g transform="translate(150 28)">
          <path d="M0 20 L70 0 L140 20 L210 0 V160 L140 180 L70 160 L0 180 Z" fill={a} />
          <path d="M70 0 V160 M140 20 V180" stroke={ground} strokeWidth="3" fill="none" />
          <path
            d="M18 120 C50 70 90 140 125 90 S180 60 196 40"
            stroke={ground}
            strokeWidth="4"
            strokeDasharray="2 9"
            strokeLinecap="round"
            fill="none"
          />
          <circle cx="196" cy="40" r="8" fill={a} />
        </g>
      );
    case 'vase':
    case 'tea':
      return (
        <g transform="translate(255 20)">
          <path
            d="M-26 0 H26 L20 30 C70 50 76 120 42 168 Q36 180 22 180 H-22 Q-36 180 -42 168 C-76 120 -70 50 -20 30 Z"
            fill={a}
          />
          <path d="M-52 92 H52" stroke={ground} strokeWidth="6" />
          <path d="M-44 118 H44" stroke={ground} strokeWidth="3" />
          <ellipse cx="0" cy="0" rx="26" ry="6" fill={ground} />
        </g>
      );
    case 'frame':
      return (
        <g transform="translate(150 28)">
          <rect width="200" height="164" rx="4" fill={a} />
          <rect x="14" y="14" width="172" height="136" fill={ground} />
          <circle cx="140" cy="52" r="16" fill={a} />
          <path d="M14 150 L70 76 L110 124 L136 94 L186 150 Z" fill={a} />
          <path d="M14 150 L58 100 L96 150 Z" fill={a} opacity="0.55" />
        </g>
      );
    case 'desk':
      return (
        <g transform="translate(135 30)">
          <rect x="0" y="40" width="230" height="22" rx="3" fill={a} />
          <rect x="14" y="62" width="22" height="108" fill={a} />
          <rect x="194" y="62" width="22" height="108" fill={a} />
          <rect x="150" y="62" width="44" height="84" fill={a} />
          <rect x="158" y="76" width="28" height="10" fill={ground} />
          <rect x="158" y="102" width="28" height="10" fill={ground} />
          <rect x="52" y="14" width="64" height="26" rx="3" fill={a} />
        </g>
      );
  }
}

export function LotCover({
  seed,
  title,
  className = '',
}: {
  /** Normalmente el id del lote. */
  seed: string;
  /** El título del lote: si nombra un objeto conocido, la portada lo dibuja. */
  title?: string | undefined;
  className?: string;
}) {
  const h = hashOf(seed);
  const palette = PALETTES[h % PALETTES.length] ?? PALETTES[0];
  const layout = (h >>> 4) % 4;
  const shift = ((h >>> 8) % 40) - 20;
  const size = 90 + ((h >>> 12) % 60);
  const kind = categoryOf(title);
  const photos = kind === null ? undefined : PHOTOS[kind];
  const photo = photos?.[h % photos.length];
  if (photo !== undefined) {
    return (
      <img
        src={`/lots/${photo}.jpg`}
        alt=""
        width={1000}
        height={550}
        loading="lazy"
        decoding="async"
        className={`block h-full w-full object-cover ${className}`}
        data-testid="lot-cover"
      />
    );
  }

  return (
    <svg
      viewBox="0 0 400 220"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      className={`block h-full w-full ${className}`}
      data-testid="lot-cover"
    >
      <rect width="400" height="220" fill={palette.ground} />
      {kind !== null && (
        <>
          <circle cx={90 + shift} cy="150" r="120" fill={palette.b} opacity="0.55" />
          <Drawing kind={kind} a={palette.a} ground={palette.ground} />
        </>
      )}
      {kind === null && layout === 0 && (
        <>
          <circle cx={250 + shift} cy="110" r={size} fill={palette.a} />
          <circle cx={250 + shift} cy="110" r={size * 0.62} fill={palette.b} />
          <circle cx={250 + shift} cy="110" r={size * 0.26} fill={palette.ground} />
        </>
      )}
      {kind === null && layout === 1 && (
        <>
          <rect x={70 + shift} y="30" width="70" height="190" fill={palette.a} />
          <rect x={160 + shift} y="70" width="70" height="150" fill={palette.b} />
          <rect x={250 + shift} y="110" width="70" height="110" fill={palette.a} />
        </>
      )}
      {kind === null && layout === 2 && (
        <>
          <path
            d={`M0 220 L${String(180 + shift)} 40 L${String(340 + shift)} 220 Z`}
            fill={palette.a}
          />
          <path d={`M120 220 L${String(260 + shift)} 90 L400 220 Z`} fill={palette.b} />
        </>
      )}
      {kind === null && layout === 3 && (
        <>
          <circle cx={120 + shift} cy="70" r={size * 0.55} fill={palette.a} />
          <rect x="190" y="90" width="170" height="130" fill={palette.b} />
          <circle cx="300" cy="90" r={size * 0.35} fill={palette.a} />
        </>
      )}
    </svg>
  );
}
