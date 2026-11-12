import { defineConfig } from 'prisma/config';

// La URL viene siempre del entorno (`DATABASE_URL`, ver `.env.example`); nunca se versiona.
// `prisma generate` no se conecta y debe funcionar en un clon limpio o en la CI sin la variable;
// los comandos que sí se conectan (migrate) fallan con un error claro si está vacía.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env['DATABASE_URL'] ?? '' },
});
