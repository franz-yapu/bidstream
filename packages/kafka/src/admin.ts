import type { KafkaJS } from '@confluentinc/kafka-javascript';
import { createKafka } from './client.js';
import type { KafkaConfig } from './config.js';

/** Estados de un grupo de consumidores (enum numérico de librdkafka). */
const STATE_NAMES: Readonly<Record<number, string>> = {
  0: 'UNKNOWN',
  1: 'PREPARING_REBALANCE',
  2: 'COMPLETING_REBALANCE',
  3: 'STABLE',
  4: 'DEAD',
  5: 'EMPTY',
};

/** Códigos de error de Kafka que importan aquí. */
const ERR_NON_EMPTY_GROUP = 68;
const ERR_GROUP_ID_NOT_FOUND = 69;

export interface GroupInfo {
  readonly state: string;
  /** Miembros activos: un grupo con miembros no puede borrarse ni reposicionarse. */
  readonly members: number;
}

export interface ConsumerLag {
  readonly total: number;
  readonly partitions: readonly { readonly partition: number; readonly lag: number }[];
}

export class GroupNotEmptyError extends Error {
  constructor(readonly groupId: string) {
    super(`el grupo ${groupId} tiene miembros activos; deténgalos antes`);
    this.name = 'GroupNotEmptyError';
  }
}

export interface KafkaAdmin {
  /** Estado del grupo, o `null` si no existe (nunca se creó o ya se borró). */
  describeGroup(groupId: string): Promise<GroupInfo | null>;
  /**
   * Borra el grupo y con él sus offsets confirmados: al volver a conectarse con `fromBeginning`
   * empieza en `earliest`. El cliente de Kafka no implementa `setOffsets`/`resetOffsets`, y esto
   * produce el mismo efecto. Falla con `GroupNotEmptyError` si el grupo tiene miembros; si no
   * existe, no hace nada.
   */
  deleteGroup(groupId: string): Promise<void>;
  /** Mensajes del topic que el grupo aún no ha confirmado (sin offset confirmado = desde el inicio). */
  consumerLag(groupId: string, topic: string): Promise<ConsumerLag>;
  disconnect(): Promise<void>;
}

function errorCode(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = error.code;
    return typeof code === 'number' ? code : undefined;
  }
  return undefined;
}

/** Administración mínima de grupos de consumidores: lo que necesitan el reproceso (G2) y el lag (H4). */
export async function createKafkaAdmin(config: KafkaConfig): Promise<KafkaAdmin> {
  const admin: KafkaJS.Admin = createKafka(config).admin();
  await admin.connect();

  return {
    describeGroup: async (groupId) => {
      const { groups } = await admin.describeGroups([groupId]);
      const group = groups[0];
      if (group === undefined) return null;
      const state = STATE_NAMES[group.state] ?? 'UNKNOWN';
      if (state === 'DEAD' || errorCode(group.error) === ERR_GROUP_ID_NOT_FOUND) return null;
      return { state, members: group.members.length };
    },

    deleteGroup: async (groupId) => {
      let code: number | undefined;
      let detail: string;
      try {
        const [result] = await admin.deleteGroups([groupId]);
        code = errorCode(result?.error) ?? result?.errorCode;
        detail = result?.error?.message ?? '';
      } catch (error) {
        // La librería lanza KafkaJSDeleteGroupsError y deja el detalle por grupo en `groups`.
        const groups: unknown =
          typeof error === 'object' && error !== null && 'groups' in error
            ? error.groups
            : undefined;
        const first: unknown = Array.isArray(groups) ? groups[0] : undefined;
        if (typeof first === 'object' && first !== null) {
          const entry = first as { errorCode?: unknown; error?: unknown };
          code = typeof entry.errorCode === 'number' ? entry.errorCode : errorCode(entry.error);
        }
        detail = error instanceof Error ? error.message : String(error);
      }
      if (code === undefined || code === 0 || code === ERR_GROUP_ID_NOT_FOUND) return;
      if (code === ERR_NON_EMPTY_GROUP) throw new GroupNotEmptyError(groupId);
      throw new Error(`no se pudo borrar el grupo ${groupId}: ${detail || String(code)}`);
    },

    consumerLag: async (groupId, topic) => {
      const [ends, committed] = await Promise.all([
        admin.fetchTopicOffsets(topic),
        admin.fetchOffsets({ groupId, topics: [topic] }),
      ]);
      const committedBy = new Map<number, number>();
      for (const entry of committed) {
        for (const p of entry.partitions) committedBy.set(p.partition, Number(p.offset));
      }
      const partitions = ends
        .map((end) => {
          const high = Number(end.high);
          const low = Number(end.low);
          const done = committedBy.get(end.partition);
          // Sin offset confirmado (-1) el grupo empezaría en el primer mensaje retenido.
          const position = done === undefined || done < 0 ? low : Math.max(done, low);
          return { partition: end.partition, lag: Math.max(0, high - position) };
        })
        .sort((a, b) => a.partition - b.partition);
      return { total: partitions.reduce((sum, p) => sum + p.lag, 0), partitions };
    },

    disconnect: () => admin.disconnect(),
  };
}
