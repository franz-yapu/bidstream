import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../auth/context';
import { ErrorNote } from '../components/ErrorNote';
import { formatDateTime } from '../lib/time';

export function DlqPage() {
  const api = useApi();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['dlq'], queryFn: () => api.dlq() });
  const reprocess = useMutation({
    mutationFn: () => api.reprocessDlq(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['dlq'] }),
  });

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Cola de mensajes fallidos (DLQ)</h1>
        <button
          type="button"
          className="btn"
          disabled={reprocess.isPending || (query.data?.pending ?? 0) === 0}
          onClick={() => {
            reprocess.mutate();
          }}
        >
          {reprocess.isPending ? 'Reprocesando…' : 'Reprocesar pendientes'}
        </button>
      </div>
      <ErrorNote error={query.error ?? reprocess.error} />
      {reprocess.data !== undefined && (
        <p role="status" className="mb-3 text-sm">
          Republicados {String(reprocess.data.republished)} de {String(reprocess.data.examined)}{' '}
          examinados; quedan {String(reprocess.data.remaining)}.
        </p>
      )}
      {query.isPending && <p role="status">Cargando…</p>}
      {query.data !== undefined && (
        <>
          <p className="mb-3 text-sm opacity-80">
            {String(query.data.pending)} pendientes · {String(query.data.total)} en total
          </p>
          {query.data.entries.length === 0 ? (
            <p className="card text-center opacity-80">El DLQ está vacío.</p>
          ) : (
            <ul className="space-y-2">
              {query.data.entries.map((entry) => (
                <li
                  key={`${entry.source.topic}-${String(entry.source.partition)}-${entry.source.offset}`}
                  className="card text-sm"
                >
                  <p className="font-medium">
                    {entry.error.name}: {entry.error.message}
                  </p>
                  <p className="opacity-70">
                    {entry.reason} · {String(entry.attempts)} intentos · reprocesos{' '}
                    {String(entry.reprocessCount)} · {entry.source.topic}[
                    {String(entry.source.partition)}]@{entry.source.offset} ·{' '}
                    {formatDateTime(entry.failedAt)}
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
