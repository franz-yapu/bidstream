/**
 * Esquema GraphQL de **solo lectura** sobre la proyección (spec §7). Ningún tipo expone la identidad
 * de postores ni de ganadores (docs/sdd/E1/SDD.md §2.3): solo `hasWinner` y `finalAmount`.
 */
export const typeDefs = /* GraphQL */ `
  "Importe decimal exacto con dos decimales, como cadena: \\"105.50\\". Nunca un número de coma flotante."
  scalar Money

  "Instante ISO-8601 en UTC: \\"2026-11-12T20:00:00.000Z\\"."
  scalar DateTime

  enum AuctionStatus {
    OPEN
    CLOSED
  }

  enum LotStatus {
    OPEN
    CLOSED
  }

  type Query {
    auction(id: ID!): Auction
    lot(id: ID!): Lot
    "Pujas de un lote en orden de ranking (mayor monto; a igual monto, la más antigua)."
    lotBids(lotId: ID!, first: Int = 20, after: String): BidConnection!
    "Lotes abiertos de una subasta, por orden de cierre."
    activeLots(auctionId: ID!, first: Int = 50): [Lot!]!
  }

  type Auction {
    id: ID!
    title: String!
    opensAt: DateTime!
    closesAt: DateTime!
    status: AuctionStatus!
    lots(first: Int = 50): [Lot!]!
  }

  type Lot {
    id: ID!
    "Puede ser nulo: la proyección es eventualmente consistente y el lote puede llegar antes que su subasta."
    auction: Auction
    title: String!
    startingPrice: Money!
    minIncrement: Money!
    currency: String!
    closesAt: DateTime!
    currentPrice: Money
    status: LotStatus!
    hasWinner: Boolean!
    "Importe de adjudicación; nulo si el lote sigue abierto o se cerró desierto."
    finalAmount: Money
    "Importe mínimo de la siguiente puja (regla del dominio)."
    nextMinimumBid: Money!
    bids(first: Int = 20, after: String): BidConnection!
  }

  type Bid {
    id: ID!
    amount: Money!
    placedAt: DateTime!
    "Posición en el ranking del lote: 1 es la mejor puja."
    rank: Int!
    awarded: Boolean!
  }

  type BidConnection {
    edges: [BidEdge!]!
    pageInfo: PageInfo!
  }

  type BidEdge {
    cursor: String!
    node: Bid!
  }

  type PageInfo {
    hasNextPage: Boolean!
    endCursor: String
  }
`;
