import { resetProjection, type PrismaClient } from '@bidstream/db';
import {
  CONSUMER_GROUPS,
  createKafkaAdmin,
  TOPICS,
  type KafkaAdmin,
  type KafkaConfig,
} from '@bidstream/kafka';

/** El grupo del `projector` tiene miembros activos: hay que detenerlo antes de reprocesar. */
export class GroupActiveError extends Error {
  constructor(
    readonly groupId: string,
    readonly members: number,
  ) {
    super(
      `el grupo ${groupId} tiene ${String(members)} miembro(s) activo(s); detenga el projector`,
    );
    this.name = 'GroupActiveError';
  }
}

export interface ReprocessOptions {
  readonly prisma: Pick<PrismaClient, '$transaction'>;
  readonly kafka: KafkaConfig;
  /** Operación destructiva: sin `yes: true` no hace nada. */
  readonly yes: boolean;
  readonly topic?: string;
  readonly groupId?: string;
}

export interface ReprocessResult {
  /** Mensajes que el `projector` volverá a leer desde `earliest`. */
  readonly eventsInLog: number;
}

/**
 * Prepara la reconstrucción de la proyección desde el log de eventos (spec §5):
 *
 * 1. comprueba que el `projector` está parado (grupo sin miembros);
 * 2. `resetProjection`: vacía `bid`, `lot`, `auction` y los `processed_event` del `projector`, en
 *    una transacción;
 * 3. borra el grupo de Kafka: al arrancar de nuevo, el `projector` lee desde `earliest`.
 *
 * Se vacía la base **antes** de borrar el grupo. Si el paso 3 falla queda la proyección vacía con los
 * offsets antiguos, y basta repetir el comando (es idempotente); el orden inverso dejaría la
 * proyección llena y todo se ignoraría como duplicado. Después, arrancar el `projector` reconstruye.
 */
export async function reprocessProjection(options: ReprocessOptions): Promise<ReprocessResult> {
  if (!options.yes) {
    throw new Error(
      'el reproceso borra la proyección: requiere confirmación explícita (yes: true)',
    );
  }
  const topic = options.topic ?? TOPICS.eventsLot;
  const groupId = options.groupId ?? CONSUMER_GROUPS.projector;

  const admin = await createKafkaAdmin(options.kafka);
  try {
    const group = await admin.describeGroup(groupId);
    if (group !== null && group.members > 0) throw new GroupActiveError(groupId, group.members);

    await resetProjection(options.prisma, groupId);
    await admin.deleteGroup(groupId);

    const { total } = await admin.consumerLag(groupId, topic);
    return { eventsInLog: total };
  } finally {
    await admin.disconnect();
  }
}

/** Espera a que el grupo no tenga mensajes pendientes en el topic. */
export async function waitForLagZero(
  admin: KafkaAdmin,
  groupId: string,
  topic: string,
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
  const deadline = Date.now() + (options.timeoutMs ?? 60_000);
  for (;;) {
    const { total } = await admin.consumerLag(groupId, topic);
    if (total === 0) return;
    if (Date.now() >= deadline) {
      throw new Error(`timeout esperando lag 0 en ${groupId}/${topic} (quedan ${String(total)})`);
    }
    await new Promise((resolve) => setTimeout(resolve, options.intervalMs ?? 200));
  }
}
