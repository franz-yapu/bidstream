import { CONSUMER_GROUPS, TOPICS } from '@bidstream/kafka';
import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  /**
   * Grupo (y nombre de consumidor) del projector. Solo la demostración del reproceso lo cambia, para
   * no tocar el entorno de desarrollo (docs/sdd/H5/SDD.md).
   */
  PROJECTOR_GROUP_ID: z.string().min(1).default(CONSUMER_GROUPS.projector),
  /** Topic de eventos que proyecta; por defecto el real. */
  PROJECTOR_TOPIC: z.string().min(1).default(TOPICS.eventsLot),
});
export type ProjectorConfig = z.infer<typeof envSchema>;

export function loadProjectorConfig(
  env: Readonly<Record<string, string | undefined>>,
): ProjectorConfig {
  return envSchema.parse(env);
}
