import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../auth/context';
import { EmptyState } from '../components/EmptyState';
import { ErrorNote } from '../components/ErrorNote';
import { formatDateTime } from '../lib/time';
import { usePageTitle } from '../lib/page-title';

export function DlqPage() {
  usePageTitle('Cola de errores');
  const api = useApi();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['dlq'], queryFn: () => api.dlq() });
  const reprocess = useMutation({
    mutationFn: () => api.reprocessDlq(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['dlq'] }),
  });

  const pending = query.data?.pending ?? 0;
  return (
    <section className="pt-6">
      <p className="text-[15px] font-medium text-forest">Administración</p>
      <div className="mt-1 mb-8 flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-5xl">Cola de errores</h1>
        <button
          type="button"
          className="btn"
          disabled={reprocess.isPending || pending === 0}
          onClick={() => {
            reprocess.mutate();
          }}
        >
          {reprocess.isPending ? 'Reprocesando…' : 'Reprocesar pendientes'}
        </button>
      </div>
      <p className="mb-8 max-w-2xl text-ink-soft">
        Mensajes que el sistema no pudo procesar. Reprocesar los devuelve a la cola para un nuevo
        intento; los que fallan siempre quedan aquí para revisarlos.
      </p>
      <ErrorNote error={query.error ?? reprocess.error} />
      {reprocess.data !== undefined && (
        <p role="status" className="mb-6 rounded-[12px] bg-forest-tint px-4 py-3 text-forest">
          Republicados {String(reprocess.data.republished)} de {String(reprocess.data.examined)}{' '}
          examinados; quedan {String(reprocess.data.remaining)}.
        </p>
      )}
      {query.isPending && <p role="status">Cargando…</p>}
      {query.data !== undefined && (
        <>
          <dl className="mb-8 grid max-w-md grid-cols-2 gap-4">
            <div className={`card ${pending > 0 ? 'bg-crimson/10' : ''}`}>
              <dt className="text-[15px] text-ink-soft">Pendientes</dt>
              <dd
                className={`display num text-5xl ${pending > 0 ? 'text-crimson' : 'text-forest'}`}
              >
                {String(pending)}
              </dd>
            </div>
            <div className="card">
              <dt className="text-[15px] text-ink-soft">En total</dt>
              <dd className="display num text-5xl">{String(query.data.total)}</dd>
            </div>
          </dl>
          {query.data.entries.length === 0 ? (
            <EmptyState title="Todo en orden">No hay mensajes fallidos que revisar.</EmptyState>
          ) : (
            <ul className="space-y-3">
              {query.data.entries.map((entry) => (
                <li
                  key={`${entry.source.topic}-${String(entry.source.partition)}-${entry.source.offset}`}
                  className="card"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`badge ${entry.reason === 'poison' ? 'bg-crimson/10 text-crimson' : 'bg-sand-deep text-ink'}`}
                    >
                      {entry.reason === 'poison' ? 'Mensaje inválido' : 'Reintentos agotados'}
                    </span>
                    <span className="text-[14px] text-ink-soft">
                      {formatDateTime(entry.failedAt)}
                    </span>
                  </div>
                  <p className="mt-3 font-medium">
                    {entry.error.name}: {entry.error.message}
                  </p>
                  <p className="mt-1 text-[14px] text-ink-soft">
                    {String(entry.attempts)} intentos · {String(entry.reprocessCount)} reprocesos ·{' '}
                    {entry.source.topic}[{String(entry.source.partition)}]@{entry.source.offset}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
