import type { Clock, IdGenerator } from '@bidstream/domain';
import { v7 as uuidv7 } from 'uuid';

/** Reloj real del sistema. */
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

/** Generador de ids reales: UUID v7 (ordenables por tiempo). */
export class Uuid7Generator implements IdGenerator {
  newId(): string {
    return uuidv7();
  }
}
