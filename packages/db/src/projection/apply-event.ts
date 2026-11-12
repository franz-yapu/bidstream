import { parseMoney, type DomainEvent } from '@bidstream/domain';
import type { PrismaClient } from '../generated/client.js';
import { decimalToMoney } from '../repositories/mappers.js';

/** Lo que necesita la proyección; sirve el cliente de una transacción. */
export type ProjectionClient = Pick<PrismaClient, 'auction' | 'lot' | 'bid'>;

/**
 * La proyección no pudo aplicar un evento (falta el lote, o el estado es incoherente). Se lanza en
 * lugar de ignorar el evento: el consumidor lo reintenta y, si persiste, va al DLQ.
 */
export class ProjectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectionError';
  }
}

function requireRows(count: number, what: string, id: string): void {
  if (count === 0) throw new ProjectionError(`${what} ${id} no existe en la proyección`);
}

/**
 * Traduce un evento de dominio a escrituras sobre `Auction`, `Lot` y `Bid` (docs/sdd/D4/SDD.md §2.1).
 * Debe ejecutarse dentro de una transacción (el consumidor base la abre). Sin reloj ni azar: el
 * mismo log produce siempre el mismo estado. La deduplicación es de D3 (`ProcessedEvent`), por eso
 * aquí se usan inserciones simples: un duplicado real debe verse como fallo.
 */
export async function applyEventToProjection(
  tx: ProjectionClient,
  event: DomainEvent,
): Promise<void> {
  const tenantId = event.tenantId;
  switch (event.type) {
    case 'AuctionOpened': {
      const p = event.payload;
      await tx.auction.create({
        data: {
          id: p.auctionId,
          tenantId,
          title: p.title,
          opensAt: new Date(p.opensAt),
          closesAt: new Date(p.closesAt),
          status: 'OPEN',
        },
      });
      return;
    }
    case 'LotPublished': {
      const p = event.payload;
      await tx.lot.create({
        data: {
          id: p.lotId,
          auctionId: p.auctionId,
          tenantId,
          title: p.title,
          startingPrice: p.startingPrice,
          minIncrement: p.minIncrement,
          currency: p.currency,
          closesAt: new Date(p.closesAt),
          status: 'OPEN',
        },
      });
      return;
    }
    case 'BidPlaced': {
      const p = event.payload;
      const { count } = await tx.lot.updateMany({
        where: { id: p.lotId, tenantId },
        data: { currentPrice: p.amount, currentBidder: p.bidderId },
      });
      requireRows(count, 'el lote', p.lotId);
      // El id de la puja es el eventId del BidPlaced: reprocesar el mismo evento no la duplica.
      await tx.bid.create({
        data: {
          id: event.eventId,
          lotId: p.lotId,
          bidderId: p.bidderId,
          amount: p.amount,
          placedAt: new Date(p.placedAt),
        },
      });
      return;
    }
    case 'BidRejected':
      // El rechazo no cambia el estado del lote; lo registra el `auditor`.
      return;
    case 'LotExtended': {
      const { count } = await tx.lot.updateMany({
        where: { id: event.payload.lotId, tenantId },
        data: { closesAt: new Date(event.payload.newClosesAt) },
      });
      requireRows(count, 'el lote', event.payload.lotId);
      return;
    }
    case 'LotClosed': {
      const { lotId, winnerId, finalAmount } = event.payload;
      const lot = await tx.lot.findFirst({ where: { id: lotId, tenantId } });
      if (lot === null) throw new ProjectionError(`el lote ${lotId} no existe en la proyección`);

      if (winnerId === null) {
        if (lot.currentPrice !== null) {
          throw new ProjectionError(`el lote ${lotId} tiene pujas pero LotClosed no trae ganador`);
        }
      } else {
        // La adjudicada es la puja de mayor ranking (mismo orden que `compareBids`).
        const top = await tx.bid.findFirst({
          where: { lotId },
          orderBy: [{ amount: 'desc' }, { placedAt: 'asc' }, { id: 'asc' }],
        });
        if (
          top === null ||
          top.bidderId !== winnerId ||
          finalAmount === null ||
          decimalToMoney(top.amount) !== parseMoney(finalAmount)
        ) {
          throw new ProjectionError(
            `LotClosed de ${lotId} no coincide con la puja de mayor ranking`,
          );
        }
        // El índice único parcial impide que haya más de una adjudicada por lote.
        await tx.bid.update({ where: { id: top.id }, data: { awarded: true } });
      }
      await tx.lot.update({ where: { id: lotId }, data: { status: 'CLOSED', winnerId } });
      return;
    }
    case 'AuctionClosed': {
      const { count } = await tx.auction.updateMany({
        where: { id: event.payload.auctionId, tenantId },
        data: { status: 'CLOSED' },
      });
      requireRows(count, 'la subasta', event.payload.auctionId);
      return;
    }
  }
}
