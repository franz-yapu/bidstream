import {
  buildDepsFrom,
  decideBid,
  decideCloseAuction,
  decideCloseLot,
  domainEventSchema,
  evolveAuction,
  evolveLot,
  FixedClock,
  formatMoney,
  minimumBid,
  parseMoney,
  SequentialIdGenerator,
  type AuctionState,
  type DomainEvent,
  type EventDraft,
  type LotState,
} from '@bidstream/domain';

export interface HistoryOptions {
  /** Semilla del generador pseudoaleatorio: la misma semilla produce siempre el mismo historial. */
  readonly seed: number;
  readonly auctions: number;
  readonly lotsPerAuction: number;
  /** Rondas de pujas por lote (cada ronda es un intento, que puede ser rechazado). */
  readonly bidsPerLot: number;
  readonly tenantId?: string;
}

const DEFAULT_TENANT = '11111111-1111-4111-8111-111111111111';
const BIDDERS = [
  'b1000000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-000000000002',
  'b1000000-0000-4000-8000-000000000003',
  'b1000000-0000-4000-8000-000000000004',
  'b1000000-0000-4000-8000-000000000005',
];
const START = new Date('2026-11-12T10:00:00.000Z');
const STEP_MS = 1_000;
const ANTI_SNIPING = { windowMs: 5_000, extensionMs: 5_000 };

/** Generador pseudoaleatorio con semilla (mulberry32). */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Historial **válido** y determinista de subastas, construido con las reglas del dominio
 * (`decideBid`, `decideCloseLot`, `decideCloseAuction`): subastas y lotes abiertos, pujas aceptadas y
 * rechazadas entrelazadas entre lotes y subastas, extensiones anti-sniping, lotes adjudicados y
 * desiertos, y subastas cerradas. El orden respeta la causalidad de cada agregado, no el de Kafka.
 */
export function generateHistory(options: HistoryOptions): DomainEvent[] {
  const random = createRandom(options.seed);
  const tenantId = options.tenantId ?? DEFAULT_TENANT;
  const clock = new FixedClock(START);
  const ids = new SequentialIdGenerator();
  const deps = buildDepsFrom(clock, ids);
  const history: DomainEvent[] = [];

  /** Convierte un borrador del dominio en un evento completo y lo añade; cada evento avanza el reloj. */
  const emit = (draft: EventDraft): DomainEvent => {
    clock.advance(STEP_MS);
    const event = domainEventSchema.parse({
      eventId: deps.newId(),
      type: draft.type,
      occurredAt: deps.now().toISOString(),
      tenantId,
      version: 1,
      payload: draft.payload,
    });
    history.push(event);
    return event;
  };

  const totalLots = options.auctions * options.lotsPerAuction;
  // Cada intento de puja consume entre 2 y 3 pasos de reloj (el avance de la puja y sus eventos).
  // Los cierres se sitúan hacia el final de las rondas para que las últimas pujas caigan en la
  // ventana anti-sniping y produzcan extensiones.
  const stepsNeeded =
    2 * options.auctions + totalLots + Math.ceil(2.2 * options.bidsPerLot * totalLots);
  const auctionClosesAt = new Date(START.getTime() + (stepsNeeded + 600) * STEP_MS);
  // Cada lote cierra en un momento distinto, repartido entre el 50 % y el 100 % de las rondas: los
  // que cierran antes ven pujas dentro de su ventana anti-sniping (extensiones) y dejan de recibirlas.
  const closesAtFor = (index: number): Date => {
    const fraction = 0.5 + (0.5 * index) / Math.max(1, totalLots - 1);
    return new Date(START.getTime() + Math.round(stepsNeeded * fraction) * STEP_MS);
  };

  const auctionIds: string[] = [];
  for (let a = 0; a < options.auctions; a++) {
    const auctionId = ids.newId();
    auctionIds.push(auctionId);
    emit({
      type: 'AuctionOpened',
      payload: {
        auctionId,
        title: `Subasta ${String(a + 1)}`,
        opensAt: START.toISOString(),
        closesAt: auctionClosesAt.toISOString(),
      },
    });
  }

  let lotIndex = 0;
  const auctionLots = new Map<string, string[]>();
  const lots = new Map<string, LotState>();
  for (const auctionId of auctionIds) {
    const lotIds: string[] = [];
    for (let l = 0; l < options.lotsPerAuction; l++) {
      const lotId = ids.newId();
      lotIds.push(lotId);
      const draft: EventDraft = {
        type: 'LotPublished',
        payload: {
          lotId,
          auctionId,
          title: `Lote ${String(l + 1)}`,
          startingPrice: formatMoney(10_000n + BigInt(Math.floor(random() * 50)) * 100n),
          minIncrement: formatMoney(500n),
          currency: 'USD',
          closesAt: closesAtFor(lotIndex++).toISOString(),
        },
      };
      emit(draft);
      const state = evolveLot(undefined, draft);
      if (state !== undefined) lots.set(lotId, state);
    }
    auctionLots.set(auctionId, lotIds);
  }

  // Un 15 % de los lotes no recibe ninguna puja y se cierra desierto.
  const lotIds = [...lots.keys()];
  const silent = new Set(lotIds.filter(() => random() < 0.15));

  for (let round = 0; round < options.bidsPerLot; round++) {
    // Las rondas entrelazan los lotes en un orden distinto cada vez.
    const order = lotIds.filter((id) => !silent.has(id)).sort(() => random() - 0.5);
    for (const lotId of order) {
      const state = lots.get(lotId);
      // Pasado el cierre (y sus extensiones) ya no se puja: el lote está a punto de cerrarse.
      if (state === undefined || clock.now() >= state.closesAt) continue;
      const bidderId = BIDDERS[Math.floor(random() * BIDDERS.length)] ?? BIDDERS[0] ?? '';
      // 20 % de los intentos ofrece menos del mínimo y se rechaza.
      const tooLow = random() < 0.2;
      const increments = BigInt(Math.floor(random() * 4));
      const amount = tooLow ? minimumBid(state) - 100n : minimumBid(state) + increments * 100n;
      clock.advance(STEP_MS);
      const drafts = decideBid(
        state,
        { bidderId, amount: amount < 0n ? 0n : amount, placedAt: clock.now() },
        ANTI_SNIPING,
      );
      let next: LotState | undefined = state;
      for (const draft of drafts) {
        emit(draft);
        next = next === undefined ? undefined : evolveLot(next, draft);
      }
      if (next !== undefined) lots.set(lotId, next);
    }
  }

  // Cierre: el reloj salta más allá del último cierre posible (incluidas las extensiones).
  const latest = Math.max(...[...lots.values()].map((l) => l.closesAt.getTime()));
  clock.advance(Math.max(0, latest - clock.now().getTime()) + STEP_MS);
  for (const lotId of lotIds) {
    const state = lots.get(lotId);
    if (state === undefined) continue;
    for (const draft of decideCloseLot(state, clock.now())) {
      emit(draft);
      const next = evolveLot(state, draft);
      if (next !== undefined) lots.set(lotId, next);
    }
  }

  for (const auctionId of auctionIds) {
    let state: AuctionState | undefined = undefined;
    state = evolveAuction(state, {
      type: 'AuctionOpened',
      payload: {
        auctionId,
        title: '',
        opensAt: START.toISOString(),
        closesAt: auctionClosesAt.toISOString(),
      },
    });
    for (const lotId of auctionLots.get(auctionId) ?? []) {
      const lot = lots.get(lotId);
      if (lot !== undefined && state !== undefined && lot.status === 'open') {
        state = { ...state, openLotIds: new Set([...state.openLotIds, lotId]) };
      }
    }
    if (state !== undefined) for (const draft of decideCloseAuction(state)) emit(draft);
  }

  return history;
}

/** Suma de los montos de las pujas aceptadas: útil para comprobar el estado final. */
export function totalPlaced(history: readonly DomainEvent[]): bigint {
  return history.reduce(
    (sum, e) => (e.type === 'BidPlaced' ? sum + parseMoney(e.payload.amount) : sum),
    0n,
  );
}
