import { describe, expect, it } from 'vitest';
import { getWorldMapPayload } from '~/lib/server/worldMap';

describe('getWorldMapPayload', () => {
  it('returns a usable world map payload for the tracker', async () => {
    const map = await getWorldMapPayload('en');

    expect(map.viewBox.width).toBeGreaterThan(0);
    expect(map.viewBox.height).toBeGreaterThan(0);
    expect(map.countries.length).toBeGreaterThan(150);

    const france = map.countries.find((country) => country.code === 'FR');
    expect(france).toBeDefined();
    expect(france?.path.length).toBeGreaterThan(10);
    expect(france?.centroid.x).toBeGreaterThan(0);
    expect(france?.centroid.y).toBeGreaterThan(0);
  });

  it('localizes country labels for french requests', async () => {
    const map = await getWorldMapPayload('fr');
    const germany = map.countries.find((country) => country.code === 'DE');

    expect(germany).toBeDefined();
    expect(germany?.name).toBe('Allemagne');
  });
});
