import type { DlqAdminOptions, PeekResult, ReprocessSummary } from '@bidstream/consumer';
import { ProblemError } from './problem.js';

/** Lo que necesita la API para administrar el DLQ; la implementación carga Kafka solo al usarse. */
export interface DlqAdminPort {
  peek(args: { limit?: number; includeOriginal?: boolean }): Promise<PeekResult>;
  reprocess(args: { limit?: number; eventIds?: readonly string[] }): Promise<ReprocessSummary>;
}

export interface LazyDlqAdminOptions {
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Sobrescribe topic del DLQ, grupo de reproceso o tiempo máximo (las pruebas lo usan). */
  readonly overrides?: Partial<Omit<DlqAdminOptions, 'kafka'>>;
}

/** Un reproceso ya en marcha es un conflicto (409), no un error del servidor. */
function translate(error: unknown): never {
  if (error instanceof Error && error.name === 'DlqBusyError') {
    throw new ProblemError(
      409,
      'urn:bidstream:problem:conflict',
      'Conflicto con el estado actual',
      'Ya hay un reproceso del DLQ en marcha.',
    );
  }
  throw error;
}

/**
 * Puerto real: **importa Kafka y el consumidor la primera vez que se usa**. El cliente nativo de Kafka
 * es pesado; así la API no lo carga si el administrador nunca se utiliza.
 */
export function lazyDlqAdmin(options: LazyDlqAdminOptions): DlqAdminPort {
  const load = async (): Promise<{
    consumer: typeof import('@bidstream/consumer');
    base: DlqAdminOptions;
  }> => {
    const [consumer, kafka] = await Promise.all([
      import('@bidstream/consumer'),
      import('@bidstream/kafka'),
    ]);
    const config = kafka.loadKafkaConfig({
      KAFKA_CLIENT_ID: 'bidstream-api-admin',
      ...options.env,
    });
    return { consumer, base: { kafka: config, ...options.overrides } };
  };
  return {
    peek: async (args) => {
      const { consumer, base } = await load();
      return consumer.peekDlq({ ...base, ...args }).catch(translate);
    },
    reprocess: async (args) => {
      const { consumer, base } = await load();
      return consumer
        .reprocessDlq({
          ...base,
          ...(args.limit === undefined ? {} : { limit: args.limit }),
          ...(args.eventIds === undefined ? {} : { eventIds: args.eventIds }),
        })
        .catch(translate);
    },
  };
}
