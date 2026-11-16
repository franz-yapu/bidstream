import { createClient } from 'graphql-sse';
import type { AppConfig } from '../config';
import { ServerClock } from './clock';
import { ApiError, createAuthedFetch, toApiError, type FetchFn } from './http';
import { SessionStore, type Me, type TokenPair } from './session';
import type {
  Auction,
  AuctionStatus,
  AuctionWithLots,
  Bid,
  DlqSnapshot,
  LotUpdate,
  LotWithAuction,
  NewAuction,
  NewLot,
  Page,
  ReprocessSummary,
} from './types';

const LOT_FIELDS = `id title currency startingPrice minIncrement currentPrice closesAt status
  hasWinner finalAmount nextMinimumBid`;

const Q = {
  auctions: `query($first: Int!, $after: String, $status: AuctionStatus) {
    auctions(first: $first, after: $after, status: $status) {
      edges { cursor node { id title opensAt closesAt status } }
      pageInfo { hasNextPage endCursor } } }`,
  auction: `query($id: ID!) { auction(id: $id) { id title opensAt closesAt status
    lots(first: 50) { ${LOT_FIELDS} } } }`,
  lot: `query($id: ID!) { lot(id: $id) { ${LOT_FIELDS} auction { id title } } }`,
  bids: `query($lotId: ID!, $first: Int!, $after: String) {
    lotBids(lotId: $lotId, first: $first, after: $after) {
      edges { node { id amount placedAt rank awarded } }
      pageInfo { hasNextPage endCursor } } }`,
  lotUpdated: `subscription($lotId: ID!) { lotUpdated(lotId: $lotId) {
    __typename
    ... on LotPublishedUpdate { eventId occurredAt }
    ... on BidPlacedUpdate { eventId occurredAt amount placedAt }
    ... on LotExtendedUpdate { eventId occurredAt newClosesAt }
    ... on LotClosedUpdate { eventId occurredAt finalAmount hasWinner }
    ... on ResyncRequired { message } } }`,
} as const;

interface GraphQLReply<T> {
  data?: T | null;
  errors?: { message: string; extensions?: { code?: string } }[];
}

export interface Api {
  readonly session: SessionStore;
  readonly clock: ServerClock;
  restore(): Promise<Me | null>;
  login(tenantId: string, email: string, password: string): Promise<Me>;
  register(tenantId: string, email: string, password: string, displayName: string): Promise<void>;
  logout(): Promise<void>;
  listAuctions(options?: {
    after?: string | null;
    status?: AuctionStatus | null;
  }): Promise<Page<Auction>>;
  getAuction(id: string): Promise<AuctionWithLots | null>;
  getLot(id: string): Promise<LotWithAuction | null>;
  getBids(lotId: string, after?: string | null): Promise<Page<Bid>>;
  createAuction(body: NewAuction): Promise<{ auctionId: string }>;
  createLot(auctionId: string, body: NewLot): Promise<{ lotId: string }>;
  placeBid(lotId: string, amount: string, idempotencyKey: string): Promise<{ commandId: string }>;
  dlq(): Promise<DlqSnapshot>;
  reprocessDlq(): Promise<ReprocessSummary>;
  subscribeLot(lotId: string, onUpdate: (u: LotUpdate) => void, onError: () => void): () => void;
}

export function createApi(
  config: AppConfig,
  fetchFn: FetchFn = (url, init) => fetch(url, init),
): Api {
  const clock = new ServerClock();
  const observed: FetchFn = async (url, init) => {
    const res = await fetchFn(url, init);
    clock.observe(res);
    return res;
  };

  const refreshTokens = async (refreshToken: string): Promise<TokenPair> => {
    const res = await observed(`${config.apiUrl}/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) throw await toApiError(res);
    return (await res.json()) as TokenPair;
  };
  const session = new SessionStore(refreshTokens);
  const authed = createAuthedFetch(session, observed);

  async function rest<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<T> {
    const res = await authed(`${config.apiUrl}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!res.ok) throw await toApiError(res);
    return (await res.json()) as T;
  }

  async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const res = await authed(config.graphqlUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/graphql-response+json, application/json',
      },
      body: JSON.stringify({ query, variables }),
    });
    const reply = (await res.json().catch(() => ({}))) as GraphQLReply<T>;
    if (reply.errors?.length || !res.ok || reply.data == null) {
      const first = reply.errors?.[0];
      throw new ApiError(
        res.status,
        first?.extensions?.code ?? 'Error de consulta',
        first?.message,
      );
    }
    return reply.data;
  }

  async function loadMe(): Promise<Me> {
    const me = await rest<Me>('GET', '/v1/auth/me');
    session.setMe(me);
    return me;
  }

  const sse = createClient({
    url: config.graphqlUrl,
    retryAttempts: 10,
    // se evalúa en cada (re)conexión: usa siempre el token de acceso vigente
    headers: async () => {
      if (session.accessToken === null) await session.refresh();
      return session.accessToken === null ? {} : { authorization: `Bearer ${session.accessToken}` };
    },
  });

  return {
    session,
    clock,
    async restore() {
      if (session.me !== null) return session.me;
      if (session.accessToken === null && !(await session.refresh())) return null;
      try {
        return await loadMe();
      } catch {
        session.clear();
        return null;
      }
    },
    async login(tenantId, email, password) {
      const res = await observed(`${config.apiUrl}/v1/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tenantId, email, password }),
      });
      if (!res.ok) throw await toApiError(res);
      session.setTokens((await res.json()) as TokenPair);
      return loadMe();
    },
    async register(tenantId, email, password, displayName) {
      const res = await observed(`${config.apiUrl}/v1/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tenantId, email, password, displayName }),
      });
      if (!res.ok) throw await toApiError(res);
    },
    async logout() {
      const refreshToken = session.currentRefreshToken();
      session.clear();
      if (refreshToken === null) return;
      // el cierre local ya está hecho; revocar en el servidor es de mejor esfuerzo
      await observed(`${config.apiUrl}/v1/auth/logout`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      }).catch(() => undefined);
    },
    async listAuctions({ after = null, status = null } = {}) {
      const data = await gql<{
        auctions: {
          edges: { node: Auction }[];
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
        };
      }>(Q.auctions, { first: 20, after, status });
      return {
        items: data.auctions.edges.map((e) => e.node),
        hasNextPage: data.auctions.pageInfo.hasNextPage,
        endCursor: data.auctions.pageInfo.endCursor,
      };
    },
    async getAuction(id) {
      return (await gql<{ auction: AuctionWithLots | null }>(Q.auction, { id })).auction;
    },
    async getLot(id) {
      return (await gql<{ lot: LotWithAuction | null }>(Q.lot, { id })).lot;
    },
    async getBids(lotId, after = null) {
      const data = await gql<{
        lotBids: {
          edges: { node: Bid }[];
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
        };
      }>(Q.bids, { lotId, first: 10, after });
      return {
        items: data.lotBids.edges.map((e) => e.node),
        hasNextPage: data.lotBids.pageInfo.hasNextPage,
        endCursor: data.lotBids.pageInfo.endCursor,
      };
    },
    createAuction: (body) => rest('POST', '/v1/auctions', body),
    createLot: (auctionId, body) => rest('POST', `/v1/auctions/${auctionId}/lots`, body),
    placeBid: (lotId, amount, idempotencyKey) =>
      rest('POST', `/v1/lots/${lotId}/bids`, { amount }, { 'idempotency-key': idempotencyKey }),
    dlq: () => rest('GET', '/v1/admin/dlq?limit=50'),
    reprocessDlq: () => rest('POST', '/v1/admin/dlq/reprocess', {}),
    subscribeLot(lotId, onUpdate, onError) {
      return sse.subscribe<{ lotUpdated: LotUpdate }>(
        { query: Q.lotUpdated, variables: { lotId } },
        {
          next: (result) => {
            if (result.data?.lotUpdated) onUpdate(result.data.lotUpdated);
          },
          error: onError,
          complete: () => undefined,
        },
      );
    },
  };
}
