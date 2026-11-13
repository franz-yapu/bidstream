import type { Clock, IdGenerator } from '@bidstream/domain';
import type { PrismaClient } from '@bidstream/db';

/** Dependencias de los casos de uso de comandos. */
export interface CommandDeps {
  readonly prisma: Pick<PrismaClient, '$transaction'>;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  /** Topic de destino de los eventos (`bidstream.events.lot`). */
  readonly eventsTopic: string;
  /** Topic de comandos (`bidstream.commands.bid`). */
  readonly commandsTopic: string;
}

/** Contexto de la petición que origina un comando (F4). */
export interface CommandContext {
  /** `request.id` de la API: viaja en `meta.correlationId` hasta los consumidores. */
  readonly correlationId?: string;
}
