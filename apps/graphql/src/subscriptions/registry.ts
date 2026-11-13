import { GraphQLError } from 'graphql';

/**
 * Cupo de suscripciones simultáneas por tenant (OWASP A04): frena el agotamiento de conexiones por un
 * solo cliente. `acquire` devuelve la función que libera el cupo (idempotente).
 */
export class SubscriptionRegistry {
  private readonly counts = new Map<string, number>();

  acquire(tenantId: string, max: number): () => void {
    const current = this.counts.get(tenantId) ?? 0;
    if (current >= max) {
      throw new GraphQLError(
        `Se alcanzó el máximo de ${String(max)} suscripciones simultáneas para este tenant.`,
        { extensions: { code: 'TOO_MANY_SUBSCRIPTIONS', limit: max, http: { status: 429 } } },
      );
    }
    this.counts.set(tenantId, current + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const left = (this.counts.get(tenantId) ?? 1) - 1;
      if (left <= 0) this.counts.delete(tenantId);
      else this.counts.set(tenantId, left);
    };
  }

  /** Suscripciones activas de un tenant (o de todos). */
  count(tenantId?: string): number {
    if (tenantId !== undefined) return this.counts.get(tenantId) ?? 0;
    let total = 0;
    for (const n of this.counts.values()) total += n;
    return total;
  }
}
