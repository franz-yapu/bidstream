import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/client.js';

export * from './generated/client.js';
export * from './repositories/index.js';
export * from './projection/index.js';
export * from './audit/index.js';
export {
  PrismaIdempotencyStore,
  requestHash,
  type ClaimResult,
  type IdempotencyClaim,
} from './idempotency/idempotency-store.js';
export { PrismaLotDecisionRepository } from './decision/lot-decision-repository.js';
export { applyEventToDecision, DecisionStateError } from './decision/apply-event.js';

/** Cliente Prisma sobre `pg` (driver adapter de Prisma 7). La URL se pasa explícita desde el entorno. */
export function createPrismaClient(databaseUrl: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
}
