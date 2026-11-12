import type { Clock, IdGenerator } from '@bidstream/domain';
import type { PrismaClient } from '@bidstream/db';

/** Dependencias de los casos de uso de comandos. */
export interface CommandDeps {
  readonly prisma: Pick<PrismaClient, '$transaction'>;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  /** Topic de destino de los eventos (`bidstream.events.lot`). */
  readonly eventsTopic: string;
}
