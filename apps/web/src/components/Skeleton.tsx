/** Marcador de carga con la forma de lo que viene: la página no salta cuando llegan los datos. */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden="true" />;
}

export function TicketSkeletons({ count = 3 }: { count?: number }) {
  return (
    <div role="status" aria-label="Cargando lotes" className="grid gap-4 md:grid-cols-3">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className="h-56" />
      ))}
    </div>
  );
}
