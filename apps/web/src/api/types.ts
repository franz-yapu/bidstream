// Formas de lo que devuelven la API y GraphQL (apps/graphql/src/schema.ts). Los importes son `Money`
// (cadena "105.50") y las fechas, instantes ISO-8601 en UTC. De un postor solo se conoce su nombre
// público (ADR-0015): nunca un identificador ni el correo.
export type AuctionStatus = 'OPEN' | 'CLOSED';
export type LotStatus = 'OPEN' | 'CLOSED';

export interface Auction {
  readonly id: string;
  readonly title: string;
  readonly opensAt: string;
  readonly closesAt: string;
  readonly status: AuctionStatus;
}

/** Postor tal como lo ve el público. */
export interface Bidder {
  readonly displayName: string;
}

export interface Lot {
  readonly id: string;
  readonly title: string;
  readonly currency: string;
  readonly startingPrice: string;
  readonly minIncrement: string;
  readonly currentPrice: string | null;
  readonly closesAt: string;
  readonly status: LotStatus;
  readonly hasWinner: boolean;
  readonly finalAmount: string | null;
  readonly nextMinimumBid: string;
  /** Quién va ganando (lote abierto con pujas). Solo en las consultas que lo piden. */
  readonly leader?: Bidder | null;
  /** Quién ganó (lote cerrado con ganador). Solo en las consultas que lo piden. */
  readonly winner?: Bidder | null;
}

export interface LotWithAuction extends Lot {
  readonly auction: { readonly id: string; readonly title: string } | null;
}

/** Una subasta abierta con sus lotes, para el inicio. */
export interface AuctionWithLiveLots extends Auction {
  readonly lots: readonly Lot[];
}

export interface AuctionWithLots extends Auction {
  readonly lots: readonly Lot[];
}

export interface Bid {
  readonly id: string;
  readonly amount: string;
  readonly placedAt: string;
  readonly rank: number;
  readonly awarded: boolean;
  readonly bidder: Bidder | null;
}

export interface Page<T> {
  readonly items: readonly T[];
  readonly hasNextPage: boolean;
  readonly endCursor: string | null;
}

/** Actualización pública de un lote en tiempo real (`Subscription.lotUpdated`). */
export type LotUpdate =
  | {
      readonly __typename: 'LotPublishedUpdate';
      readonly eventId: string;
      readonly occurredAt: string;
    }
  | {
      readonly __typename: 'BidPlacedUpdate';
      readonly eventId: string;
      readonly occurredAt: string;
      readonly amount: string;
      readonly placedAt: string;
    }
  | {
      readonly __typename: 'LotExtendedUpdate';
      readonly eventId: string;
      readonly occurredAt: string;
      readonly newClosesAt: string;
    }
  | {
      readonly __typename: 'LotClosedUpdate';
      readonly eventId: string;
      readonly occurredAt: string;
      readonly finalAmount: string | null;
      readonly hasWinner: boolean;
    }
  | { readonly __typename: 'ResyncRequired'; readonly message: string };

export interface NewAuction {
  readonly title: string;
  readonly opensAt: string;
  readonly closesAt: string;
}

export interface NewLot {
  readonly title: string;
  readonly startingPrice: string;
  readonly minIncrement: string;
  readonly currency: string;
  readonly closesAt: string;
}

export interface DlqEntry {
  readonly reason: 'poison' | 'retries-exhausted';
  readonly attempts: number;
  readonly reprocessCount: number;
  readonly error: { readonly name: string; readonly message: string };
  readonly source: { readonly topic: string; readonly partition: number; readonly offset: string };
  readonly failedAt: string;
}

export interface DlqSnapshot {
  readonly entries: readonly DlqEntry[];
  readonly pending: number;
  readonly total: number;
}

export interface ReprocessSummary {
  readonly examined: number;
  readonly republished: number;
  readonly remaining: number;
}
