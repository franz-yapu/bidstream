export function StatusBadge({ status }: { status: 'OPEN' | 'CLOSED' }) {
  const open = status === 'OPEN';
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${open ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300'}`}
    >
      {open ? 'Abierta' : 'Cerrada'}
    </span>
  );
}
