import { describe, expect, it } from 'vitest';
import { loadProjectorConfig } from './config.js';

describe('loadProjectorConfig', () => {
  const base = { DATABASE_URL: 'postgresql://u:p@localhost:5432/d' };

  it('por defecto usa el grupo y el topic reales', () => {
    expect(loadProjectorConfig(base)).toMatchObject({
      PROJECTOR_GROUP_ID: 'projector',
      PROJECTOR_TOPIC: 'bidstream.events.lot',
    });
  });
  it('PROJECTOR_GROUP_ID y PROJECTOR_TOPIC permiten una demostración aislada', () => {
    expect(
      loadProjectorConfig({ ...base, PROJECTOR_GROUP_ID: 'demo', PROJECTOR_TOPIC: 'demo.events' }),
    ).toMatchObject({ PROJECTOR_GROUP_ID: 'demo', PROJECTOR_TOPIC: 'demo.events' });
  });
  it('exige DATABASE_URL y rechaza valores vacíos', () => {
    expect(() => loadProjectorConfig({})).toThrow();
    expect(() => loadProjectorConfig({ ...base, PROJECTOR_GROUP_ID: '' })).toThrow();
  });
});
