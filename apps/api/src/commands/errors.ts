/** Errores de aplicación: no saben de HTTP; la capa de rutas los traduce. */
export class InvalidCommand extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidCommand';
  }
}

export class AuctionNotFound extends Error {
  constructor(readonly auctionId: string) {
    super(`la subasta ${auctionId} no existe`);
    this.name = 'AuctionNotFound';
  }
}

export class LotNotFound extends Error {
  constructor(readonly lotId: string) {
    super(`el lote ${lotId} no existe`);
    this.name = 'LotNotFound';
  }
}

export class IdempotencyKeyReused extends Error {
  constructor() {
    super('la Idempotency-Key ya se usó con otra petición');
    this.name = 'IdempotencyKeyReused';
  }
}

export class AuctionClosed extends Error {
  constructor(readonly auctionId: string) {
    super(`la subasta ${auctionId} está cerrada`);
    this.name = 'AuctionClosed';
  }
}
