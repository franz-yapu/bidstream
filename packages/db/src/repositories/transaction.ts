import type { PrismaClient } from '../generated/client.js';
import { PrismaAuctionRepository } from './auction-repository.js';
import { PrismaLotRepository } from './lot-repository.js';
import { PrismaOutbox } from './outbox.js';
import { PrismaLotDecisionRepository } from '../decision/lot-decision-repository.js';

/** Lo que necesitan los repositorios: sirve igual un `PrismaClient` que el cliente de una transacción. */
export type DbClient = Pick<
  PrismaClient,
  'lot' | 'auction' | 'outboxMessage' | 'lotDecision' | '$queryRaw'
>;

export interface TransactionScope {
  readonly lots: PrismaLotRepository;
  readonly auctions: PrismaAuctionRepository;
  readonly outbox: PrismaOutbox;
  /** Estado autoritativo del decisor de pujas (ADR-0011). */
  readonly decisions: PrismaLotDecisionRepository;
}

export interface TransactionOptions {
  /** Tiempo máximo de la transacción (ms). Por defecto 5 000. */
  readonly timeoutMs?: number;
}

/**
 * Ejecuta `work` con repositorios y outbox ligados a la **misma** transacción. Si `work` lanza, se
 * revierte todo, incluido el outbox: nunca se publica un evento de un comando que falló (spec §5).
 */
export function withTransaction<T>(
  prisma: Pick<PrismaClient, '$transaction'>,
  work: (scope: TransactionScope) => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  return prisma.$transaction(
    (tx) =>
      work({
        lots: new PrismaLotRepository(tx),
        auctions: new PrismaAuctionRepository(tx),
        outbox: new PrismaOutbox(tx),
        decisions: new PrismaLotDecisionRepository(tx),
      }),
    { timeout: options.timeoutMs ?? 5_000 },
  );
}
