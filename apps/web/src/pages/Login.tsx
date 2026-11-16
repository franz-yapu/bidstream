import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Link, useLocation, useNavigate } from 'react-router';
import { z } from 'zod';
import { useApi } from '../auth/context';
import { ErrorNote } from '../components/ErrorNote';
import { loadConfig } from '../config';

const schema = z.object({
  tenantId: z.uuid('Debe ser un UUID'),
  email: z.email('Correo no válido'),
  password: z.string().min(1, 'Escribe la contraseña'),
});
type Values = z.infer<typeof schema>;

export function LoginPage() {
  const api = useApi();
  const navigate = useNavigate();
  const location = useLocation() as { state: { from?: string } | null };
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { tenantId: loadConfig().defaultTenantId, email: '', password: '' },
  });
  const login = useMutation({
    mutationFn: (v: Values) => api.login(v.tenantId, v.email, v.password),
    onSuccess: () => navigate(location.state?.from ?? '/', { replace: true }),
  });

  return (
    <section className="card mx-auto mt-8 max-w-md">
      <h1 className="mb-4 text-xl font-semibold">Entrar</h1>
      <form
        noValidate
        className="space-y-4"
        onSubmit={(e) => {
          void handleSubmit((v) => login.mutateAsync(v).catch(() => undefined))(e);
        }}
      >
        <div>
          <label htmlFor="tenantId" className="label">
            Organización (tenant)
          </label>
          <input
            id="tenantId"
            className="field font-mono"
            autoComplete="off"
            {...register('tenantId')}
          />
          {errors.tenantId && <p className="error">{errors.tenantId.message}</p>}
        </div>
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
        <div>
          <label htmlFor="password" className="label">
            Contraseña
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            className="field"
            {...register('password')}
          />
          {errors.password && <p className="error">{errors.password.message}</p>}
        </div>
        <ErrorNote error={login.error} />
        <button type="submit" className="btn w-full" disabled={login.isPending}>
          {login.isPending ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
      <p className="mt-4 text-sm opacity-80">
        ¿Sin cuenta?{' '}
        <Link to="/registro" className="underline">
          Regístrate como postor
        </Link>
      </p>
    </section>
  );
}
