/** Estado de un lote o una subasta: «En proceso» (verde, con punto vivo) o «Terminado/a» (gris). */
export function StatusBadge({
  status,
  upcoming = false,
  feminine = false,
}: {
  status: 'OPEN' | 'CLOSED';
  /** Subasta abierta cuya hora de inicio aún no llegó. */
  upcoming?: boolean;
  /** «Terminada» (subasta) en vez de «Terminado» (lote). */
  feminine?: boolean;
}) {
  if (status === 'CLOSED') {
    return (
      <span className="badge bg-sand-deep text-ink">{feminine ? 'Terminada' : 'Terminado'}</span>
    );
  }
  if (upcoming) {
    return <span className="badge bg-forest-tint text-forest">Próximamente</span>;
  }
  return (
    <span className="badge bg-forest text-paper">
      <span className="live-dot" aria-hidden="true" />
      En proceso
    </span>
  );
}
