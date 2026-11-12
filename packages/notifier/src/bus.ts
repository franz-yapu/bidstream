import type { LotNotification } from './notification.js';

export type NotificationHandler = (notification: LotNotification) => void;

/** Reparto de notificaciones dentro de un proceso, por `(tenantId, lotId)`. */
export interface NotificationBus {
  publish(notification: LotNotification): void;
  /** Se suscribe a un lote de un tenant. Devuelve la función que cancela la suscripción. */
  subscribe(tenantId: string, lotId: string, handler: NotificationHandler): () => void;
  /** Aviso de que se perdió el canal y pudieron perderse notificaciones: los clientes deben recargar. */
  publishResync(): void;
  onResync(handler: () => void): () => void;
}

const keyOf = (tenantId: string, lotId: string): string => `${tenantId}/${lotId}`;

/**
 * Bus en memoria. El reparto es síncrono y el fallo de un suscriptor no impide el de los demás;
 * quien suscribe (las subscriptions de GraphQL, E3) debe protegerse de los lentos con su propia cola.
 */
export class InMemoryNotificationBus implements NotificationBus {
  private readonly handlers = new Map<string, Set<NotificationHandler>>();
  private readonly resyncHandlers = new Set<() => void>();

  constructor(private readonly onHandlerError: (error: unknown) => void = () => undefined) {}

  publish(notification: LotNotification): void {
    const set = this.handlers.get(keyOf(notification.tenantId, notification.lotId));
    if (set === undefined) return;
    for (const handler of [...set]) {
      try {
        handler(notification);
      } catch (error) {
        this.onHandlerError(error);
      }
    }
  }

  subscribe(tenantId: string, lotId: string, handler: NotificationHandler): () => void {
    const key = keyOf(tenantId, lotId);
    const set = this.handlers.get(key) ?? new Set<NotificationHandler>();
    set.add(handler);
    this.handlers.set(key, set);
    return () => {
      set.delete(handler);
      if (set.size === 0) this.handlers.delete(key);
    };
  }

  publishResync(): void {
    for (const handler of [...this.resyncHandlers]) {
      try {
        handler();
      } catch (error) {
        this.onHandlerError(error);
      }
    }
  }

  onResync(handler: () => void): () => void {
    this.resyncHandlers.add(handler);
    return () => {
      this.resyncHandlers.delete(handler);
    };
  }
}
