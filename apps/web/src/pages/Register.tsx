import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router';
import { z } from 'zod';
import { useApi } from '../auth/context';
import { ErrorNote } from '../components/ErrorNote';
import { loadConfig } from '../config';

const schema = z.object({
  tenantId: z.uuid('Debe ser un UUID'),
  email: z.email('Correo no válido'),
  password: z.string().min(12, 'Mínimo 12 caracteres').max(128, 'Máximo 128 caracteres'),
});
type Values = z.infer<typeof schema>;

export function RegisterPage() {
  const api = useApi();
  const navigate = useNavigate();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { tenantId: loadConfig().defaultTenantId, email: '', password: '' },
  });
  const signUp = useMutation({
    mutationFn: async (v: Values) => {
      await api.register(v.tenantId, v.email, v.password);
      await api.login(v.tenantId, v.email, v.password);
    },
    onSuccess: () => navigate('/', { replace: true }),
  });

  return (
    <section className="card mx-auto mt-8 max-w-md">
      <h1 className="mb-4 text-xl font-semibold">Crear cuenta de postor</h1>
      <form
        noValidate
        className="space-y-4"
        onSubmit={(e) => {
          void handleSubmit((v) => signUp.mutateAsync(v).catch(() => undefined))(e);
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
            autoComplete="new-password"
            className="field"
            {...register('password')}
          />
          {errors.password && <p className="error">{errors.password.message}</p>}
        </div>
        <ErrorNote error={signUp.error} />
        <button type="submit" className="btn w-full" disabled={signUp.isPending}>
          {signUp.isPending ? 'Creando…' : 'Crear cuenta'}
        </button>
      </form>
      <p className="mt-4 text-sm opacity-80">
        ¿Ya tienes cuenta?{' '}
        <Link to="/login" className="underline">
          Entrar
        </Link>
      </p>
    </section>
  );
}
