/** Genera identificadores de evento (UUID v7). */
export interface IdGenerator {
  newId(): string;
}
