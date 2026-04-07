import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockMongoCollections = new Map<string, Map<string, Record<string, unknown>>>();

function getMockMongoCollection(dbName: string, collectionName: string) {
  const key = `${dbName}:${collectionName}`;
  let store = mockMongoCollections.get(key);
  if (!store) {
    store = new Map<string, Record<string, unknown>>();
    mockMongoCollections.set(key, store);
  }

  return store;
}

vi.mock('mongodb', () => {
  class MongoClient {
    constructor(_uri: string) {}

    async connect() {
      return this;
    }

    db(dbName: string) {
      return {
        collection(collectionName: string) {
          const store = getMockMongoCollection(dbName, collectionName);

          return {
            async createIndex() {
              return `${collectionName}_idx`;
            },
            async findOne(query: { _id: string; expiresAt?: { $gt: Date } }) {
              const document = store.get(query._id);
              if (!document) {
                return null;
              }

              const expiryLimit = query.expiresAt?.$gt;
              const expiresAt = document.expiresAt;
              if (expiryLimit && expiresAt instanceof Date && expiresAt <= expiryLimit) {
                return null;
              }

              return structuredClone(document);
            },
            async updateOne(
              filter: { _id: string },
              update: { $set: Record<string, unknown> },
            ) {
              const current = store.get(filter._id) ?? { _id: filter._id };
              const next = {
                ...current,
                ...structuredClone(update.$set),
                _id: filter._id,
              } satisfies Record<string, unknown>;

              store.set(filter._id, next);
              return {
                acknowledged: true,
                matchedCount: current._id ? 1 : 0,
                modifiedCount: 1,
                upsertedCount: current._id ? 0 : 1,
              };
            },
          };
        },
      };
    }
  }

  return { MongoClient };
});

async function loadSearchFlights() {
  vi.resetModules();
  return (await import('~/lib/server/opensky')).searchFlights;
}

async function loadFlightSelectionDetails() {
  vi.resetModules();
  return (await import('~/lib/server/flightSelectionDetails')).getFlightSelectionDetails;
}

async function loadFlightCache() {
  vi.resetModules();
  return await import('~/lib/server/flightCache');
}

describe('searchFlights', () => {
  const originalClientId = process.env.OPENSKY_CLIENT_ID;
  const originalClientSecret = process.env.OPENSKY_CLIENT_SECRET;
  const originalAviationStackApiKey = process.env.AVIATION_STACK_API_KEY;
  const originalFlightAwareApiKey = process.env.FLIGHTAWARE_API_KEY;
  const originalFlightAwareApiKeyAlt = process.env.FLIGHT_AWARE_API_KEY;
  const originalEnabledApiProviders = process.env.ENABLED_API_PROVIDERS;
  const originalDisabledApiProviders = process.env.DISABLED_API_PROVIDERS;
  const originalOpenSkyDisabled = process.env.OPENSKY_DISABLED;
  const originalFlightAwareDisabled = process.env.FLIGHTAWARE_DISABLED;
  const originalAviationstackDisabled = process.env.AVIATIONSTACK_DISABLED;
  const originalMongoDbUri = process.env.MONGODB_URI;
  const originalCacheTtl = process.env.OPENSKY_CACHE_TTL_SECONDS;
  const originalOpenSkyProxyUrl = process.env.OPENSKY_PROXY_URL;
  const originalOpenSkyProxySecret = process.env.OPENSKY_PROXY_SECRET;

  beforeEach(() => {
    vi.restoreAllMocks();
    mockMongoCollections.clear();
    delete process.env.OPENSKY_CLIENT_ID;
    delete process.env.OPENSKY_CLIENT_SECRET;
    delete process.env.OPENSKY_PROXY_URL;
    delete process.env.OPENSKY_PROXY_SECRET;
  });

  afterEach(() => {
    if (originalClientId === undefined) {
      delete process.env.OPENSKY_CLIENT_ID;
    } else {
      process.env.OPENSKY_CLIENT_ID = originalClientId;
    }

    if (originalClientSecret === undefined) {
      delete process.env.OPENSKY_CLIENT_SECRET;
    } else {
      process.env.OPENSKY_CLIENT_SECRET = originalClientSecret;
    }

    if (originalAviationStackApiKey === undefined) {
      delete process.env.AVIATION_STACK_API_KEY;
    } else {
      process.env.AVIATION_STACK_API_KEY = originalAviationStackApiKey;
    }

    if (originalFlightAwareApiKey === undefined) {
      delete process.env.FLIGHTAWARE_API_KEY;
    } else {
      process.env.FLIGHTAWARE_API_KEY = originalFlightAwareApiKey;
    }

    if (originalFlightAwareApiKeyAlt === undefined) {
      delete process.env.FLIGHT_AWARE_API_KEY;
    } else {
      process.env.FLIGHT_AWARE_API_KEY = originalFlightAwareApiKeyAlt;
    }

    if (originalMongoDbUri === undefined) {
      delete process.env.MONGODB_URI;
    } else {
      process.env.MONGODB_URI = originalMongoDbUri;
    }

    if (originalCacheTtl === undefined) {
      delete process.env.OPENSKY_CACHE_TTL_SECONDS;
    } else {
      process.env.OPENSKY_CACHE_TTL_SECONDS = originalCacheTtl;
    }

    if (originalOpenSkyProxyUrl === undefined) {
      delete process.env.OPENSKY_PROXY_URL;
    } else {
      process.env.OPENSKY_PROXY_URL = originalOpenSkyProxyUrl;
    }

    if (originalOpenSkyProxySecret === undefined) {
      delete process.env.OPENSKY_PROXY_SECRET;
    } else {
      process.env.OPENSKY_PROXY_SECRET = originalOpenSkyProxySecret;
    }

    if (originalEnabledApiProviders === undefined) {
      delete process.env.ENABLED_API_PROVIDERS;
    } else {
      process.env.ENABLED_API_PROVIDERS = originalEnabledApiProviders;
    }

    if (originalDisabledApiProviders === undefined) {
      delete process.env.DISABLED_API_PROVIDERS;
    } else {
      process.env.DISABLED_API_PROVIDERS = originalDisabledApiProviders;
    }

    if (originalOpenSkyDisabled === undefined) {
      delete process.env.OPENSKY_DISABLED;
    } else {
      process.env.OPENSKY_DISABLED = originalOpenSkyDisabled;
    }

    if (originalFlightAwareDisabled === undefined) {
      delete process.env.FLIGHTAWARE_DISABLED;
    } else {
      process.env.FLIGHTAWARE_DISABLED = originalFlightAwareDisabled;
    }

    if (originalAviationstackDisabled === undefined) {
      delete process.env.AVIATIONSTACK_DISABLED;
    } else {
      process.env.AVIATIONSTACK_DISABLED = originalAviationstackDisabled;
    }

    vi.unstubAllGlobals();
  });

  it('returns realistic preset demo flights for TEST1 through TEST6 searches', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const searchFlights = await loadSearchFlights();
    const result = await searchFlights('TEST1,TEST2,TEST3,TEST4,TEST5,TEST6');

    expect(result.requestedIdentifiers).toEqual(['TEST1', 'TEST2', 'TEST3', 'TEST4', 'TEST5', 'TEST6']);
    expect(result.matchedIdentifiers).toEqual(['TEST1', 'TEST2', 'TEST3', 'TEST4', 'TEST5', 'TEST6']);
    expect(result.notFoundIdentifiers).toEqual([]);
    expect(result.flights).toHaveLength(6);
    expect(fetchMock).not.toHaveBeenCalled();

    expect(result.flights).toEqual(expect.arrayContaining([
      expect.objectContaining({
        callsign: 'AFR006',
        matchedBy: expect.arrayContaining(['TEST1']),
        onGround: true,
        geoAltitude: 0,
        route: expect.objectContaining({
          departureAirport: 'CDG',
          arrivalAirport: 'JFK',
          lastSeen: null,
        }),
      }),
      expect.objectContaining({
        callsign: 'BAW117',
        matchedBy: expect.arrayContaining(['TEST2']),
        onGround: false,
        route: expect.objectContaining({
          departureAirport: 'LHR',
          arrivalAirport: 'JFK',
        }),
      }),
      expect.objectContaining({
        callsign: 'DAL220',
        matchedBy: expect.arrayContaining(['TEST3']),
        onGround: true,
        originPoint: expect.objectContaining({
          longitude: expect.any(Number),
          latitude: expect.any(Number),
          onGround: true,
        }),
        route: expect.objectContaining({
          departureAirport: 'ATL',
          arrivalAirport: 'JFK',
        }),
      }),
      expect.objectContaining({
        callsign: 'IBE6253',
        matchedBy: expect.arrayContaining(['TEST4']),
        onGround: false,
        route: expect.objectContaining({
          departureAirport: 'MAD',
          arrivalAirport: 'JFK',
        }),
      }),
      expect.objectContaining({
        callsign: 'KLM1698',
        matchedBy: expect.arrayContaining(['TEST5']),
        onGround: true,
        route: expect.objectContaining({
          departureAirport: 'BCN',
          arrivalAirport: 'AMS',
        }),
      }),
      expect.objectContaining({
        callsign: 'KAL031',
        matchedBy: expect.arrayContaining(['TEST6']),
        onGround: false,
        route: expect.objectContaining({
          departureAirport: 'DFW',
          arrivalAirport: 'ICN',
        }),
      }),
    ]));

    const groundedFlight = result.flights.find((flight) => flight.callsign === 'DAL220');
    expect(groundedFlight?.originPoint?.longitude).toBeGreaterThan(-85);
    expect(groundedFlight?.originPoint?.longitude).toBeLessThan(-84);
    expect(groundedFlight?.originPoint?.latitude).toBeGreaterThan(33);
    expect(groundedFlight?.originPoint?.latitude).toBeLessThan(34);

    const datelineFlight = result.flights.find((flight) => flight.callsign === 'KAL031');
    expect(datelineFlight?.track.some((point) => point.longitude < -170)).toBe(true);
    expect(datelineFlight?.track.some((point) => point.longitude > 170)).toBe(true);
  });

  it('keeps demo telemetry available when preset and non-preset identifiers are mixed', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const searchFlights = await loadSearchFlights();
    const result = await searchFlights('TEST2,DL045');

    expect(result.requestedIdentifiers).toEqual(['TEST2', 'DL045']);
    expect(result.matchedIdentifiers).toEqual(['TEST2']);
    expect(result.notFoundIdentifiers).toEqual(['DL045']);
    expect(result.flights).toEqual(expect.arrayContaining([
      expect.objectContaining({
        callsign: 'BAW117',
        matchedBy: expect.arrayContaining(['TEST2']),
        onGround: false,
      }),
    ]));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('treats auto-locked DEMO-TEST identifiers as fresh preset demo flights', async () => {
    vi.useFakeTimers();

    try {
      const firstNow = new Date('2026-04-06T12:00:00.000Z');
      const secondNow = new Date('2026-04-07T12:00:00.000Z');
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      const searchFlights = await loadSearchFlights();

      vi.setSystemTime(firstNow);
      const firstResult = await searchFlights('DEMO-TEST2,DEMO-TEST4');

      vi.setSystemTime(secondNow);
      const secondResult = await searchFlights('DEMO-TEST2,DEMO-TEST4');

      expect(fetchMock).not.toHaveBeenCalled();
      expect(secondResult.requestedIdentifiers).toEqual(['DEMO-TEST2', 'DEMO-TEST4']);
      expect(secondResult.matchedIdentifiers).toEqual(['DEMO-TEST2', 'DEMO-TEST4']);
      expect(secondResult.notFoundIdentifiers).toEqual([]);

      const firstBruno = firstResult.flights.find((flight) => flight.callsign === 'BAW117');
      const secondBruno = secondResult.flights.find((flight) => flight.callsign === 'BAW117');
      const secondEmma = secondResult.flights.find((flight) => flight.callsign === 'IBE6253');

      expect(firstBruno).toBeTruthy();
      expect(secondBruno).toBeTruthy();
      expect(secondEmma).toBeTruthy();
      expect((secondBruno?.track.at(0)?.time ?? 0)).toBeGreaterThan(Math.floor(secondNow.getTime() / 1000) - (2 * 60 * 60));
      expect((secondBruno?.track.at(-1)?.time ?? 0)).toBeGreaterThan((firstBruno?.track.at(-1)?.time ?? 0) + (20 * 60 * 60));
      expect(secondEmma?.matchedBy).toEqual(expect.arrayContaining(['TEST4']));
      expect(secondEmma?.onGround).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('lets the provider allowlist disable OpenSky before any network call', async () => {
    process.env.OPENSKY_CLIENT_ID = 'client-from-env';
    process.env.OPENSKY_CLIENT_SECRET = 'secret-from-env';
    process.env.ENABLED_API_PROVIDERS = 'flightaware, aviationstack';

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const searchFlights = await loadSearchFlights();

    await expect(searchFlights('AF123')).rejects.toThrow(
      'OpenSky provider is disabled by `ENABLED_API_PROVIDERS`.',
    );

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('skips FlightAware and Aviationstack when the allowlist only enables OpenSky', async () => {
    process.env.OPENSKY_CLIENT_ID = 'client-from-env';
    process.env.OPENSKY_CLIENT_SECRET = 'secret-from-env';
    process.env.FLIGHT_AWARE_API_KEY = 'flightaware-key';
    process.env.AVIATION_STACK_API_KEY = 'aviationstack-key';
    process.env.ENABLED_API_PROVIDERS = 'opensky';

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url.includes('/protocol/openid-connect/token')) {
        return new Response(JSON.stringify({ access_token: 'token-123', expires_in: 1800 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.includes('/states/all')) {
        return new Response(JSON.stringify({
          time: 1_700_000_600,
          states: [[
            '39bd24',
            'AFR123',
            'France',
            1_700_000_580,
            1_700_000_600,
            -15.4,
            49.5,
            10_668,
            false,
            905,
            281,
            0,
            null,
            10_668,
            '1234',
            false,
            0,
            null,
          ]],
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.includes('/tracks/all')) {
        return new Response(JSON.stringify({ path: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.includes('/flights/all')) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      throw new Error(`Unhandled fetch URL in test: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    const searchFlights = await loadSearchFlights();
    const result = await searchFlights('AFR123');

    expect(result.flights).toHaveLength(1);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('aeroapi.flightaware.com'))).toBe(false);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('aviationstack.com/v1/flights'))).toBe(false);
    expect(result.flights[0]?.sourceDetails).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: 'flightaware',
        status: 'skipped',
        reason: expect.stringContaining('ENABLED_API_PROVIDERS'),
      }),
      expect.objectContaining({
        source: 'aviationstack',
        status: 'skipped',
        reason: expect.stringContaining('ENABLED_API_PROVIDERS'),
      }),
    ]));
  });
});
