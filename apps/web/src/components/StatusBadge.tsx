export function StatusBadge({
  status,
  upcoming = false,
}: {
  status: 'OPEN' | 'CLOSED';
  /** Subasta abierta cuya hora de inicio aún no llegó. */
  upcoming?: boolean;
}) {
  if (status === 'CLOSED') {
    return <span className="badge bg-sand text-ink-soft">Cerrada</span>;
  }
  if (upcoming) {
    return <span className="badge bg-forest-tint text-forest">Próximamente</span>;
  }
  return (
    <span className="badge bg-forest text-paper">
      <span className="live-dot" aria-hidden="true" />
      En vivo
    </span>
  );
}
