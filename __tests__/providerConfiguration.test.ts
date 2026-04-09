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
      airlabs: null,
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
        airlabs: null,
        aerodatabox: null,
      }),
    }));

    const { getEnabledProvidersAsync: getEnabledProvidersWithOverride } = await import('~/lib/server/providers');
    await expect(getEnabledProvidersWithOverride()).resolves.toContain('flightaware');
  });

  it('does not reuse a cached live FlightAware match for a different validation date', async () => {
    process.env.FLIGHT_AWARE_API_KEY = 'test-flightaware-key';
    delete process.env.FLIGHTAWARE_DISABLED;

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        flights: [
          {
            ident: 'AF123',
            ident_icao: 'AFR123',
            ident_iata: 'AF123',
            fa_flight_id: 'AF123-live',
            operator: 'Air France',
            operator_icao: 'AFR',
            operator_iata: 'AF',
            flight_number: '123',
            origin: { code_iata: 'CDG', code_icao: 'LFPG', name: 'Paris CDG' },
            destination: { code_iata: 'AMS', code_icao: 'EHAM', name: 'Amsterdam Schiphol' },
            actual_out: '2026-04-08T09:35:00.000Z',
            estimated_in: '2026-04-08T11:10:00.000Z',
            last_position: {
              latitude: 49.01,
              longitude: 2.55,
              altitude: 36000,
              groundspeed: 430,
              heading: 32,
              timestamp: '2026-04-08T09:50:00.000Z',
            },
          },
        ],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        flights: [
          {
            ident: 'AF123',
            ident_icao: 'AFR123',
            ident_iata: 'AF123',
            fa_flight_id: 'AF123-future',
            operator: 'Air France',
            operator_icao: 'AFR',
            operator_iata: 'AF',
            flight_number: '123',
            origin: { code_iata: 'CDG', code_icao: 'LFPG', name: 'Paris CDG' },
            destination: { code_iata: 'AMS', code_icao: 'EHAM', name: 'Amsterdam Schiphol' },
            scheduled_out: '2026-04-14T09:35:00.000Z',
            scheduled_in: '2026-04-14T11:10:00.000Z',
            last_position: null,
          },
        ],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));

    vi.stubGlobal('fetch', fetchMock);

    const { lookupFlightAwareFlightWithReport } = await loadFlightAwareProviderWithOverride(null);

    await lookupFlightAwareFlightWithReport('AF123', {
      referenceTimeMs: Date.parse('2026-04-08T09:35:00.000Z'),
    });
    const result = await lookupFlightAwareFlightWithReport('AF123', {
      referenceTimeMs: Date.parse('2026-04-14T09:35:00.000Z'),
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.match?.faFlightId).toBe('AF123-future');
  });

  it('prefers the closest FlightAware schedule on either side of the typed validation date', async () => {
    process.env.FLIGHT_AWARE_API_KEY = 'test-flightaware-key';
    delete process.env.FLIGHTAWARE_DISABLED;

    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      flights: [
        {
          ident: 'AF123',
          ident_icao: 'AFR123',
          ident_iata: 'AF123',
          fa_flight_id: 'AF123-past-live',
          operator: 'Air France',
          operator_icao: 'AFR',
          operator_iata: 'AF',
          flight_number: '123',
          origin: { code_iata: 'CDG', code_icao: 'LFPG', name: 'Paris CDG' },
          destination: { code_iata: 'AMS', code_icao: 'EHAM', name: 'Amsterdam Schiphol' },
          actual_out: '2026-04-14T08:00:00.000Z',
          estimated_in: '2026-04-14T09:20:00.000Z',
          last_position: {
            latitude: 49.01,
            longitude: 2.55,
            altitude: 36000,
            groundspeed: 430,
            heading: 32,
            timestamp: '2026-04-14T08:15:00.000Z',
          },
        },
        {
          ident: 'AF123',
          ident_icao: 'AFR123',
          ident_iata: 'AF123',
          fa_flight_id: 'AF123-future-scheduled',
          operator: 'Air France',
          operator_icao: 'AFR',
          operator_iata: 'AF',
          flight_number: '123',
          origin: { code_iata: 'CDG', code_icao: 'LFPG', name: 'Paris CDG' },
          destination: { code_iata: 'AMS', code_icao: 'EHAM', name: 'Amsterdam Schiphol' },
          scheduled_out: '2026-04-14T10:00:00.000Z',
          scheduled_in: '2026-04-14T11:20:00.000Z',
          last_position: null,
        },
      ],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    vi.stubGlobal('fetch', fetchMock);

    const { lookupFlightAwareFlightWithReport } = await loadFlightAwareProviderWithOverride(null);
    const result = await lookupFlightAwareFlightWithReport('AF123', {
      referenceTimeMs: Date.parse('2026-04-14T09:30:00.000Z'),
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.match?.faFlightId).toBe('AF123-future-scheduled');
    expect(result.match?.route.firstSeen).toBe(Math.floor(Date.parse('2026-04-14T10:00:00.000Z') / 1000));
  });
});
