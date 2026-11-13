import type { LotNotification, NotificationBus } from '@bidstream/notifier';

/** Aviso a los clientes de que pudieron perderse notificaciones: deben volver a consultar el estado. */
export interface ResyncRequired {
  readonly type: 'ResyncRequired';
  readonly message: string;
}

export type LotUpdatePayload = LotNotification | ResyncRequired;

const RESYNC: ResyncRequired = {
  type: 'ResyncRequired',
  message: 'Se pudieron perder actualizaciones: vuelva a consultar el estado del lote.',
};

export interface LotUpdatesOptions {
  readonly bus: NotificationBus;
  readonly tenantId: string;
  readonly lotId: string;
  /** Tamaño máximo de la cola: si un cliente lento la desborda, se descarta y se avisa. */
  readonly maxQueue: number;
  /** Se llama una sola vez al cerrar el flujo (para liberar el cupo del tenant). */
  readonly onClose?: () => void;
}

/**
 * Flujo asíncrono de actualizaciones de un lote para **un** suscriptor (docs/sdd/E3/SDD.md §2.1):
 * una cola acotada alimentada por el bus. Si el cliente es lento y la cola se desborda, se descarta
 * lo pendiente y se deja un único `ResyncRequired`: la memoria nunca crece sin límite ni se frena a
 * los demás suscriptores. Al cerrarse (desconexión, error o `return()`) cancela sus suscripciones.
 */
export function lotUpdates(options: LotUpdatesOptions): AsyncIterableIterator<LotUpdatePayload> {
  const queue: LotUpdatePayload[] = [];
  let waiting: ((result: IteratorResult<LotUpdatePayload>) => void) | undefined;
  let closed = false;

  const push = (item: LotUpdatePayload): void => {
    if (closed) return;
    if (waiting !== undefined) {
      const resolve = waiting;
      waiting = undefined;
      resolve({ value: item, done: false });
      return;
    }
    if (queue.length >= options.maxQueue) {
      queue.length = 0;
      queue.push(RESYNC);
      return;
    }
    // Un aviso de resincronización pendiente ya cubre cualquier cosa posterior.
    if (queue.at(-1) === RESYNC) return;
    queue.push(item);
  };

  const offLot = options.bus.subscribe(options.tenantId, options.lotId, push);
  const offResync = options.bus.onResync(() => {
    push(RESYNC);
  });

  const close = (): void => {
    if (closed) return;
    closed = true;
    offLot();
    offResync();
    queue.length = 0;
    options.onClose?.();
    if (waiting !== undefined) {
      const resolve = waiting;
      waiting = undefined;
      resolve({ value: undefined, done: true });
    }
  };

  return {
    next: () => {
      const first = queue.shift();
      if (first !== undefined) return Promise.resolve({ value: first, done: false });
      if (closed) return Promise.resolve({ value: undefined, done: true });
      return new Promise((resolve) => {
        waiting = resolve;
      });
    },
    return: () => {
      close();
      return Promise.resolve({ value: undefined, done: true });
    },
    throw: (error: unknown) => {
      close();
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    },
    [Symbol.asyncIterator]() {
      return this;
    },
  };
}
