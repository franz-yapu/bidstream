import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router';
import { z } from 'zod';
import { useApi } from '../auth/context';
import { ErrorNote } from '../components/ErrorNote';

const schema = z
  .object({
    title: z.string().trim().min(1, 'Escribe un título').max(200, 'Máximo 200 caracteres'),
    opensAt: z.string().min(1, 'Elige cuándo abre'),
    closesAt: z.string().min(1, 'Elige cuándo cierra'),
  })
  .refine((v) => Date.parse(v.opensAt) < Date.parse(v.closesAt), {
    message: 'El cierre debe ser posterior a la apertura',
    path: ['closesAt'],
  });
type Values = z.infer<typeof schema>;

const toIso = (local: string): string => new Date(local).toISOString();

export function NewAuctionPage() {
  const api = useApi();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Values>({ resolver: zodResolver(schema) });
  const create = useMutation({
    mutationFn: (v: Values) =>
      api.createAuction({ title: v.title, opensAt: toIso(v.opensAt), closesAt: toIso(v.closesAt) }),
    onSuccess: async ({ auctionId }) => {
      await queryClient.invalidateQueries({ queryKey: ['auctions'] });
      // la proyección es eventualmente consistente: la página de la subasta espera a que aparezca
      void navigate(`/subastas/${auctionId}`);
    },
  });

  return (
    <section className="card mx-auto mt-4 max-w-lg">
      <h1 className="mb-4 text-xl font-semibold">Nueva subasta</h1>
      <form
        noValidate
        className="space-y-4"
        onSubmit={(e) => {
          void handleSubmit((v) => create.mutateAsync(v).catch(() => undefined))(e);
        }}
      >
        <div>
          <label htmlFor="title" className="label">
            Título
          </label>
          <input id="title" className="field" {...register('title')} />
          {errors.title && <p className="error">{errors.title.message}</p>}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="opensAt" className="label">
              Abre
            </label>
            <input id="opensAt" type="datetime-local" className="field" {...register('opensAt')} />
            {errors.opensAt && <p className="error">{errors.opensAt.message}</p>}
          </div>
          <div>
            <label htmlFor="closesAt" className="label">
              Cierra
            </label>
            <input
              id="closesAt"
              type="datetime-local"
              className="field"
              {...register('closesAt')}
            />
            {errors.closesAt && <p className="error">{errors.closesAt.message}</p>}
          </div>
        </div>
        <ErrorNote error={create.error} />
        <button type="submit" className="btn" disabled={create.isPending}>
          {create.isPending ? 'Creando…' : 'Crear subasta'}
        </button>
      </form>
    </section>
  );
}
