/**
 * Sello de la casa: anillo con texto que gira despacio alrededor de una «b» y un punto en vivo.
 * Es decoración (aria-hidden): no añade información que el texto de la página no tenga.
 */
export function Seal({ className = '' }: { className?: string }) {
  const ring = 'SUBASTA EN VIVO · PUJA ABIERTA · CIERRE LIMPIO · SIN LETRA PEQUEÑA · ';
  return (
    <svg viewBox="0 0 520 520" aria-hidden="true" className={className} data-testid="seal">
      <defs>
        <radialGradient id="seal-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#b6d96c" stopOpacity="0.55" />
          <stop offset="70%" stopColor="#b6d96c" stopOpacity="0.12" />
          <stop offset="100%" stopColor="#b6d96c" stopOpacity="0" />
        </radialGradient>
        <path id="seal-ring" d="M260 260 m-205 0 a205 205 0 1 1 410 0 a205 205 0 1 1 -410 0" />
      </defs>
      <circle cx="260" cy="260" r="258" fill="url(#seal-glow)" />
      <g className="spin-slow">
        <text
          fontFamily="Hanken Grotesk Variable, system-ui, sans-serif"
          fontSize="19"
          fontWeight="600"
          fill="#1e4a38"
        >
          <textPath href="#seal-ring" startOffset="0" textLength="1280" lengthAdjust="spacing">
            {ring}
          </textPath>
        </text>
      </g>
      <circle
        cx="260"
        cy="260"
        r="168"
        fill="none"
        stroke="#1e4a38"
        strokeOpacity="0.35"
        strokeWidth="1.5"
        strokeDasharray="2 9"
        strokeLinecap="round"
      />
      <circle cx="260" cy="260" r="136" fill="#fbf8f2" stroke="#17211b" strokeWidth="4" />
      <circle cx="260" cy="260" r="122" fill="none" stroke="#1e4a38" strokeWidth="1.5" />
      <text
        x="260"
        y="292"
        textAnchor="middle"
        fontFamily="Fraunces Variable, Georgia, serif"
        fontSize="132"
        fontWeight="500"
        fill="#17211b"
      >
        b
      </text>
      <circle cx="318" cy="262" r="11" fill="#6f9a2f" />
    </svg>
  );
}
