import pg from 'pg';
import type { NotificationBus } from './bus.js';
import { lotNotificationSchema } from './notification.js';
import { NOTIFICATION_CHANNEL } from './publisher.js';

export interface ListenerLogger {
  info(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
}

export interface NotificationListenerOptions {
  readonly connectionString: string;
  readonly bus: NotificationBus;
  readonly logger?: ListenerLogger;
  readonly backoff?: { readonly baseMs: number; readonly capMs: number };
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface RunningNotificationListener {
  /** Se resuelve cuando la primera conexión ya escucha el canal. */
  readonly ready: Promise<void>;
  /** PID del backend de PostgreSQL que sostiene la escucha (útil para diagnóstico y pruebas). */
  backendPid(): number | undefined;
  stop(): Promise<void>;
}

const silent: ListenerLogger = { info: () => undefined, warn: () => undefined };

/**
 * Escucha el canal de notificaciones sobre una conexión **dedicada** (`LISTEN` es de sesión) y las
 * reparte en el bus. Si la conexión se pierde, reconecta con backoff, vuelve a escuchar y emite un
 * aviso de resincronización: las notificaciones del intervalo no se recuperan (best-effort), y el
 * estado real se vuelve a consultar por GraphQL.
 */
export function startNotificationListener(
  options: NotificationListenerOptions,
): RunningNotificationListener {
  const logger = options.logger ?? silent;
  const backoff = options.backoff ?? { baseMs: 200, capMs: 5_000 };
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  // Objeto en lugar de variable: `stop()` lo modifica desde otra función y TypeScript no lo estrecha.
  const state = { stopping: false };
  const isStopping = (): boolean => state.stopping;
  let client: pg.Client | undefined;
  let pid: number | undefined;
  let markReady!: () => void;
  const ready = new Promise<void>((resolve) => {
    markReady = resolve;
  });

  /** Una conexión completa: conecta, escucha y espera a que se pierda. */
  async function session(first: boolean): Promise<void> {
    const current = new pg.Client({ connectionString: options.connectionString });
    client = current;
    const lost = new Promise<void>((resolve) => {
      current.once('end', resolve);
      // `on`, no `once`: pg puede emitir más de un `error` y uno sin manejador tumbaría el proceso.
      current.on('error', (error: Error) => {
        logger.warn({ err: error.message }, 'la conexión de escucha falló');
        resolve();
      });
    });
    current.on('notification', (message) => {
      if (message.payload === undefined) return;
      let json: unknown;
      try {
        json = JSON.parse(message.payload);
      } catch {
        logger.warn({}, 'notificación con JSON inválido descartada');
        return;
      }
      const parsed = lotNotificationSchema.safeParse(json);
      if (parsed.success) options.bus.publish(parsed.data);
      else logger.warn({}, 'notificación con formato inválido descartada');
    });
    await current.connect();
    await current.query(`LISTEN ${NOTIFICATION_CHANNEL}`);
    const { rows } = await current.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
    pid = rows[0]?.pid;
    logger.info({ pid }, 'escuchando notificaciones');
    markReady();
    // Al reconectar pudieron perderse notificaciones: se avisa para que los clientes recarguen.
    if (!first) options.bus.publishResync();
    await lost;
  }

  const loop = (async () => {
    let first = true;
    let failures = 0;
    while (!isStopping()) {
      try {
        await session(first);
        first = false;
        failures = 0;
      } catch (error) {
        failures += 1;
        logger.warn(
          { err: error instanceof Error ? error.message : String(error) },
          'no se pudo escuchar',
        );
      }
      if (isStopping()) break;
      await sleep(Math.min(backoff.capMs, backoff.baseMs * 2 ** Math.max(0, failures - 1)));
    }
  })();

  return {
    ready,
    backendPid: () => pid,
    stop: async () => {
      state.stopping = true;
      await client?.end().catch(() => undefined);
      await loop;
    },
  };
}
