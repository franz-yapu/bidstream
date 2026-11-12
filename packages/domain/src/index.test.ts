import { describe, expect, it } from 'vitest';
import { DOMAIN_PACKAGE } from './index.js';

describe('@bidstream/domain', () => {
  it('expone el marcador del paquete', () => {
    expect(DOMAIN_PACKAGE).toBe('@bidstream/domain');
  });
});
