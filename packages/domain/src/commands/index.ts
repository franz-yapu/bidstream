import { z } from 'zod';
import { v7 as uuidv7 } from 'uuid';
import type { EventMeta } from '../events/index.js';
import { COMMAND_VERSION } from './envelope.js';
import { placeBid } from './placeBid.js';

export { COMMAND_VERSION } from './envelope.js';

/** Unión discriminada por `type`: el contrato de los comandos que viajan por `bidstream.commands.bid`. */
export const domainCommandSchema = z.discriminatedUnion('type', [placeBid]);

export type DomainCommand = z.infer<typeof domainCommandSchema>;
export type CommandType = DomainCommand['type'];
export type CommandOf<T extends CommandType> = Extract<DomainCommand, { type: T }>;
export type CommandPayloadOf<T extends CommandType> = CommandOf<T>['payload'];

export type ParseCommandResult =
  | { readonly success: true; readonly command: DomainCommand }
  | { readonly success: false; readonly error: z.ZodError };

/** Valida un mensaje entrante de `bidstream.commands.bid`. */
export function parseCommand(input: unknown): ParseCommandResult {
  const result = domainCommandSchema.safeParse(input);
  return result.success
    ? { success: true, command: result.data }
    : { success: false, error: result.error };
}

export interface BuildCommandDeps {
  readonly newId: () => string;
  readonly now: () => Date;
}

const defaultDeps: BuildCommandDeps = { newId: () => uuidv7(), now: () => new Date() };

/** Fabrica un comando válido; lanza si no cumple el contrato. */
export function buildCommand<T extends CommandType>(
  type: T,
  tenantId: string,
  payload: CommandPayloadOf<T>,
  options: {
    readonly deps?: BuildCommandDeps;
    readonly meta?: EventMeta;
    readonly commandId?: string;
  } = {},
): CommandOf<T> {
  const deps = options.deps ?? defaultDeps;
  const candidate = {
    commandId: options.commandId ?? deps.newId(),
    type,
    receivedAt: deps.now().toISOString(),
    tenantId,
    version: COMMAND_VERSION,
    payload,
    ...(options.meta === undefined ? {} : { meta: options.meta }),
  };
  return domainCommandSchema.parse(candidate) as CommandOf<T>;
}

/** Clave de partición (ADR-0001): `lotId`, igual que los eventos del lote. */
export function commandPartitionKey(command: DomainCommand): string {
  return command.payload.lotId;
}
