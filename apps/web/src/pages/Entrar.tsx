import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { z } from 'zod';
import { useApi } from '../auth/context';
import { ErrorNote } from '../components/ErrorNote';
import { Eye, EyeOff } from '../components/icons';
import { LotTicket } from '../components/LotTicket';
import { loadConfig } from '../config';

const base = {
  tenantId: z.uuid('Debe ser un UUID'),
  email: z.email('Escribe un correo válido'),
};
const loginSchema = z.object({
  ...base,
  displayName: z.string(),
  password: z.string().min(1, 'Escribe la contraseña'),
});
const registerSchema = z.object({
  ...base,
  displayName: z
    .string()
    .trim()
    .min(2, 'Mínimo 2 caracteres')
    .max(30, 'Máximo 30 caracteres')
    .regex(/^[\p{L}\p{N}][\p{L}\p{N} ._'-]*$/u, "Solo letras, números, espacios y . _ - '"),
  password: z.string().min(12, 'Mínimo 12 caracteres').max(128, 'Máximo 128 caracteres'),
});
type Values = z.infer<typeof registerSchema>;

/** Solo se vuelve a rutas internas: nunca a una dirección que venga de fuera. */
export function safeReturn(value: string | null): string {
  return value !== null && value.startsWith('/') && !value.startsWith('//') ? value : '/';
}

export function EntrarPage() {
  const api = useApi();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const mode = params.get('modo') === 'registro' ? 'registro' : 'entrar';
  const volver = safeReturn(params.get('volver'));
  const [showPassword, setShowPassword] = useState(false);
  const board = useQuery({ queryKey: ['board', 'OPEN'], queryFn: () => api.board('OPEN') });
  const first = board.data?.find((a) => a.lots.some((l) => l.status === 'OPEN'));
  const firstLot = first?.lots.find((l) => l.status === 'OPEN');
  const teaser =
    first !== undefined && firstLot !== undefined
      ? { lot: firstLot, auctionTitle: first.title }
      : undefined;
  const tenantFixed = loadConfig().defaultTenantId !== '';

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Values>({
    resolver: zodResolver(mode === 'registro' ? registerSchema : loginSchema),
    defaultValues: {
      tenantId: loadConfig().defaultTenantId,
      email: '',
      displayName: '',
      password: '',
    },
  });
  const submit = useMutation({
    mutationFn: async (v: Values) => {
      if (mode === 'registro') await api.register(v.tenantId, v.email, v.password, v.displayName);
      await api.login(v.tenantId, v.email, v.password);
    },
    onSuccess: () => navigate(volver, { replace: true }),
  });

  const choose = (next: 'entrar' | 'registro'): void => {
    const copy = new URLSearchParams(params);
    if (next === 'registro') copy.set('modo', 'registro');
    else copy.delete('modo');
    setParams(copy, { replace: true });
    submit.reset();
  };

  return (
    <section className="grid gap-6 pt-4 lg:grid-cols-[1fr_1.1fr]">
      <div className="order-2 hidden rounded-[28px] bg-forest p-10 text-paper lg:order-1 lg:flex lg:flex-col lg:justify-between">
        <h2 className="max-w-sm text-5xl leading-[1.05]">Entra a la sala.</h2>
        {teaser !== undefined && (
          <div className="my-8">
            <p className="mb-3 text-paper/80">Ahora mismo, en la sala:</p>
            <LotTicket lot={teaser.lot} auctionTitle={teaser.auctionTitle} />
          </div>
        )}
        <ul className="space-y-4 text-lg text-paper/90">
          <li>Sigue el precio de cada lote en tiempo real, sin recargar.</li>
          <li>Tu nombre público es lo único que ven los demás.</li>
          <li>Cada puja queda registrada: sabes cuándo entró y si va ganando.</li>
        </ul>
      </div>

      <div className="order-1 card sm:p-10 lg:order-2">
        <div
          role="tablist"
          aria-label="Acceso"
          className="mb-8 inline-flex gap-1 rounded-full bg-sand p-1"
        >
          {(['entrar', 'registro'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => {
                choose(m);
              }}
              className={`rounded-full px-4 py-1.5 text-[15px] font-medium transition-[background-color,color] duration-150 ${mode === m ? 'bg-paper text-ink' : 'text-ink-soft [@media(hover:hover)]:hover:text-ink'}`}
            >
              {m === 'entrar' ? 'Entrar' : 'Crear cuenta'}
            </button>
          ))}
        </div>

        <h1 className="text-4xl sm:text-5xl">{mode === 'entrar' ? 'Entrar' : 'Crear cuenta'}</h1>
        <p className="mt-2 text-ink-soft">
          {mode === 'entrar'
            ? 'Con tu cuenta puedes pujar en cualquier lote abierto.'
            : 'Mirar es libre. La cuenta te permite pujar.'}
        </p>

        <form
          key={mode}
          noValidate
          className="mt-8 space-y-5"
          onSubmit={(e) => {
            void handleSubmit((v) => submit.mutateAsync(v).catch(() => undefined))(e);
          }}
        >
          {!tenantFixed && (
            <div>
              <label htmlFor="tenantId" className="label">
                Organización (tenant)
              </label>
              <input
                id="tenantId"
                className="field font-mono text-sm"
                autoComplete="off"
                {...register('tenantId')}
              />
              {errors.tenantId && <p className="error">{errors.tenantId.message}</p>}
            </div>
          )}
          <div>
            <label htmlFor="email" className="label">
              Correo
            </label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              className="field"
              {...register('email')}
            />
            {errors.email && <p className="error">{errors.email.message}</p>}
          </div>
          {mode === 'registro' && (
            <div>
              <label htmlFor="displayName" className="label">
                Nombre público
              </label>
              <input
                id="displayName"
                autoComplete="nickname"
                className="field"
                aria-describedby="displayName-help"
                {...register('displayName')}
              />
              <p id="displayName-help" className="mt-1.5 text-[14px] text-ink-soft">
                Lo verán todos en las pujas. No uses tu correo.
              </p>
              {errors.displayName && <p className="error">{errors.displayName.message}</p>}
            </div>
          )}
          <div>
            <label htmlFor="password" className="label">
              Contraseña
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete={mode === 'registro' ? 'new-password' : 'current-password'}
                className="field pr-12"
                {...register('password')}
              />
              <button
                type="button"
                aria-label={showPassword ? 'Ocultar clave' : 'Mostrar clave'}
                aria-pressed={showPassword}
                onClick={() => {
                  setShowPassword((v) => !v);
                }}
                className="absolute inset-y-0 right-1 my-auto flex h-10 w-10 items-center justify-center rounded-full text-ink-soft transition-colors duration-150 [@media(hover:hover)]:hover:text-ink"
              >
                {showPassword ? <EyeOff /> : <Eye />}
              </button>
            </div>
            {mode === 'registro' && !errors.password && (
              <p className="mt-1.5 text-[14px] text-ink-soft">Mínimo 12 caracteres.</p>
            )}
            {errors.password && <p className="error">{errors.password.message}</p>}
          </div>
          <ErrorNote error={submit.error} />
          <button type="submit" className="btn w-full py-3 text-base" disabled={submit.isPending}>
            {submit.isPending
              ? mode === 'entrar'
                ? 'Entrando…'
                : 'Creando…'
              : mode === 'entrar'
                ? 'Entrar'
                : 'Crear cuenta'}
          </button>
        </form>
        <p className="mt-6 text-[15px] text-ink-soft">
          <Link to="/subastas" className="link">
            Seguir mirando sin cuenta
          </Link>
        </p>
      </div>
    </section>
  );
}
