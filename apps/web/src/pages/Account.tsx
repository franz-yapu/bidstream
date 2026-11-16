import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useApi, useMe } from '../auth/context';
import { Avatar } from '../components/Avatar';
import { ErrorNote } from '../components/ErrorNote';

const ROLE_LABEL = { ADMIN: 'Administrador', SELLER: 'Vendedor', BIDDER: 'Postor' } as const;

const schema = z.object({
  displayName: z
    .string()
    .trim()
    .min(2, 'Mínimo 2 caracteres')
    .max(30, 'Máximo 30 caracteres')
    .regex(/^[\p{L}\p{N}][\p{L}\p{N} ._'-]*$/u, "Solo letras, números, espacios y . _ - '"),
});
type Values = z.infer<typeof schema>;

export function AccountPage() {
  const api = useApi();
  const me = useMe();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { displayName: me?.displayName ?? '' },
  });
  const save = useMutation({ mutationFn: (v: Values) => api.updateDisplayName(v.displayName) });
  if (me === null) return null;

  return (
    <section className="mx-auto max-w-xl pt-6">
      <div className="flex items-center gap-4">
        <Avatar name={me.displayName} size={56} />
        <div>
          <h1 className="text-4xl">{me.displayName}</h1>
          <p className="text-ink-soft">
            {ROLE_LABEL[me.role]} · {me.email}
          </p>
        </div>
      </div>

      <form
        noValidate
        className="card mt-8 space-y-4 sm:p-8"
        onSubmit={(e) => {
          void handleSubmit((v) => save.mutateAsync(v).catch(() => undefined))(e);
        }}
      >
        <div>
          <label htmlFor="displayName" className="label">
            Nombre público
          </label>
          <input id="displayName" className="field" {...register('displayName')} />
          <p className="mt-1.5 text-[14px] text-ink-soft">
            Es lo que ven todos en las pujas. Nunca se muestra tu correo.
          </p>
          {errors.displayName && <p className="error">{errors.displayName.message}</p>}
        </div>
        <ErrorNote error={save.error} />
        {save.isSuccess && (
          <p role="status" className="text-[15px] font-medium text-forest">
            Nombre guardado.
          </p>
        )}
        <button type="submit" className="btn" disabled={save.isPending}>
          {save.isPending ? 'Guardando…' : 'Guardar nombre'}
        </button>
      </form>
    </section>
  );
}
