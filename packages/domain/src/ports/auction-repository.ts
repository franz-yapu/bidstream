import type { AuctionState } from '../auction/state.js';

/** Lectura del estado actual de una subasta (la proyección). Solo lectura, ver `LotRepository`. */
export interface AuctionRepository {
  findById(tenantId: string, auctionId: string): Promise<AuctionState | null>;
}
