import type { AuctionState } from '../auction/state.js';
import type { BuildDeps, DomainEvent } from '../events/index.js';
import type { LotState } from '../lot/state.js';
import type { AuctionRepository } from './auction-repository.js';
import type { Clock } from './clock.js';
import type { EventPublisher } from './event-publisher.js';
import type { IdGenerator } from './id-generator.js';
import type { LotRepository } from './lot-repository.js';

/** Adapta `Clock` e `IdGenerator` a las dependencias de `buildEvent`. */
export function buildDepsFrom(clock: Clock, ids: IdGenerator): BuildDeps {
  return { newId: () => ids.newId(), now: () => clock.now() };
}

/** Reloj de pruebas: hora fija que se puede avanzar. */
export class FixedClock implements Clock {
  private current: Date;
  constructor(start: Date) {
    this.current = new Date(start.getTime());
  }
  now(): Date {
    return new Date(this.current.getTime());
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

/** Ids de prueba: UUID v7 válidos, distintos y reproducibles. */
export class SequentialIdGenerator implements IdGenerator {
  private counter = 0;
  newId(): string {
    this.counter += 1;
    return `0190a5c0-0000-7000-8000-${this.counter.toString(16).padStart(12, '0')}`;
  }
}

export class InMemoryLotRepository implements LotRepository {
  private readonly lots = new Map<string, LotState>();
  set(tenantId: string, state: LotState): void {
    this.lots.set(`${tenantId}/${state.lotId}`, state);
  }
  findById(tenantId: string, lotId: string): Promise<LotState | null> {
    return Promise.resolve(this.lots.get(`${tenantId}/${lotId}`) ?? null);
  }
}

export class InMemoryAuctionRepository implements AuctionRepository {
  private readonly auctions = new Map<string, AuctionState>();
  set(tenantId: string, state: AuctionState): void {
    this.auctions.set(`${tenantId}/${state.auctionId}`, state);
  }
  findById(tenantId: string, auctionId: string): Promise<AuctionState | null> {
    return Promise.resolve(this.auctions.get(`${tenantId}/${auctionId}`) ?? null);
  }
}

/** Publicador de pruebas: conserva los eventos en el orden publicado. */
export class RecordingEventPublisher implements EventPublisher {
  readonly published: DomainEvent[] = [];
  publish(events: readonly DomainEvent[]): Promise<void> {
    this.published.push(...events);
    return Promise.resolve();
  }
}
