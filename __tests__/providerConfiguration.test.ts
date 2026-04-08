import { afterEach, describe, expect, it, vi } from 'vitest';
import { isFlightAwareConfigured, hasFlightAwareCredentials } from '~/lib/server/providers/flightaware';

const originalFlightAwareApiKey = process.env.FLIGHT_AWARE_API_KEY;
const originalFlightAwareDisabled = process.env.FLIGHTAWARE_DISABLED;

async function loadFlightAwareProviderWithOverride(overrideState: 'enabled' | 'disabled' | null) {
  vi.resetModules();
  vi.doMock('~/lib/server/providers/overrides', () => ({
    getCachedProviderOverrides: async () => ({
      opensky: null,
      flightaware: overrideState,
      aviationstack: null,
      aerodatabox: null,
    }),
  }));

  return await import('~/lib/server/providers/flightaware');
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.doUnmock('~/lib/server/providers/overrides');

  if (originalFlightAwareApiKey === undefined) {
    delete process.env.FLIGHT_AWARE_API_KEY;
  } else {
    process.env.FLIGHT_AWARE_API_KEY = originalFlightAwareApiKey;
  }

  if (originalFlightAwareDisabled === undefined) {
    delete process.env.FLIGHTAWARE_DISABLED;
  } else {
    process.env.FLIGHTAWARE_DISABLED = originalFlightAwareDisabled;
  }
});

describe('provider configuration helpers', () => {
  it('keeps credential detection separate from runtime disable flags for FlightAware', () => {
    process.env.FLIGHT_AWARE_API_KEY = 'test-flightaware-key';
    process.env.FLIGHTAWARE_DISABLED = 'true';

    expect(hasFlightAwareCredentials()).toBe(true);
    expect(isFlightAwareConfigured()).toBe(false);
  });

  it('still runs the FlightAware lookup when the admin override forces the provider on', async () => {
    process.env.FLIGHT_AWARE_API_KEY = 'test-flightaware-key';
    process.env.FLIGHTAWARE_DISABLED = 'true';

    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ flights: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { lookupFlightAwareFlightWithReport } = await loadFlightAwareProviderWithOverride('enabled');
    const result = await lookupFlightAwareFlightWithReport('AF123', {
      referenceTimeMs: Date.parse('2026-04-14T09:30:00.000Z'),
    });

    expect(fetchMock.mock.calls.length).toBeGreaterThan(0);
    expect(result.report.status).toBe('no-data');
    expect(result.report.reason).not.toContain('not configured');
  });

  it('includes FlightAware in the enabled provider list when the admin override forces it on', async () => {
    process.env.FLIGHT_AWARE_API_KEY = 'test-flightaware-key';
    process.env.FLIGHTAWARE_DISABLED = 'true';

    vi.resetModules();
    vi.doMock('~/lib/server/providers/overrides', () => ({
      getCachedProviderOverrides: async () => ({
        opensky: null,
        flightaware: 'enabled',
        aviationstack: null,
        aerodatabox: null,
      }),
    }));

    const { getEnabledProvidersAsync: getEnabledProvidersWithOverride } = await import('~/lib/server/providers');
    await expect(getEnabledProvidersWithOverride()).resolves.toContain('flightaware');
  });
});
