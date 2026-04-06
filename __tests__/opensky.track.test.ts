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

  it('sorts live track points chronologically before building the map route', async () => {
    process.env.OPENSKY_CLIENT_ID = 'client-from-env';
    process.env.OPENSKY_CLIENT_SECRET = 'secret-from-env';

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'token-123', expires_in: 1800 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        time: 1_700_000_300,
        states: [[
          'abc123',
          'HLF9872',
          'Poland',
          1_700_000_290,
          1_700_000_300,
          104.3,
          43.2,
          10_500,
          false,
          230,
          90,
          0,
          null,
          10_800,
          '1234',
          false,
          0,
          null,
        ]],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        path: [
          [1_700_000_200, 46.0, 60.0, 10_000, 80, false],
          [1_700_000_000, 50.4743, 19.08, 0, 0, true],
          [1_700_000_100, 48.5, 35.0, 6_000, 70, false],
        ],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));

    vi.stubGlobal('fetch', fetchMock);

    const searchFlights = await loadSearchFlights();
    const result = await searchFlights('HLF9872');

    expect(result.flights).toHaveLength(1);
    expect(result.flights[0]?.track.map((point) => point.time)).toEqual([
      1_700_000_000,
      1_700_000_100,
      1_700_000_200,
    ]);
    expect(result.flights[0]?.originPoint?.time).toBe(1_700_000_000);
  });

  it('normalizes altitude glitches and fills short climb gaps in the backend track history', async () => {
    process.env.OPENSKY_CLIENT_ID = 'client-from-env';
    process.env.OPENSKY_CLIENT_SECRET = 'secret-from-env';

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'token-123', expires_in: 1800 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        time: 1_700_000_620,
        states: [[
          'abc123',
          'HLF9872',
          'Poland',
          1_700_000_610,
          1_700_000_620,
          104.3,
          43.2,
          11_200,
          false,
          230,
          90,
          0,
          null,
          11_200,
          '1234',
          false,
          0,
          null,
        ]],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        path: [
          [1_700_000_000, 50.0, 19.0, 10_000, 70, false],
          [1_700_000_060, 50.2, 19.5, 10_000, 72, false],
          [1_700_000_120, 50.4, 20.0, 9_600, 74, false],
          [1_700_000_180, 50.6, 20.5, 10_000, 76, false],
          [1_700_000_600, 51.4, 22.0, 11_200, 82, false],
        ],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));

    vi.stubGlobal('fetch', fetchMock);

    const searchFlights = await loadSearchFlights();
    const result = await searchFlights('HLF9872');
    const track = result.flights[0]?.track ?? [];

    expect(track.find((point) => point.time === 1_700_000_120)?.altitude).toBe(10_000);
    expect(track.length).toBeGreaterThan(5);
    expect(track.some((point) => point.time != null && point.time > 1_700_000_180 && point.time < 1_700_000_600)).toBe(true);
  });

  it('removes short two-point altitude wobble noise more aggressively', async () => {
    process.env.OPENSKY_CLIENT_ID = 'client-from-env';
    process.env.OPENSKY_CLIENT_SECRET = 'secret-from-env';

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'token-123', expires_in: 1800 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        time: 1_700_000_360,
        states: [[
          'abc123',
          'HLF9872',
          'Poland',
          1_700_000_350,
          1_700_000_360,
          104.3,
          43.2,
          10_050,
          false,
          230,
          90,
          0,
          null,
          10_050,
          '1234',
          false,
          0,
          null,
        ]],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        path: [
          [1_700_000_000, 50.0, 19.0, 10_000, 70, false],
          [1_700_000_060, 50.1, 19.2, 10_030, 71, false],
          [1_700_000_120, 50.2, 19.4, 10_420, 72, false],
          [1_700_000_180, 50.3, 19.6, 9_620, 73, false],
          [1_700_000_240, 50.4, 19.8, 10_040, 74, false],
          [1_700_000_300, 50.5, 20.0, 10_020, 75, false],
        ],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));

    vi.stubGlobal('fetch', fetchMock);

    const searchFlights = await loadSearchFlights();
    const result = await searchFlights('HLF9872');
    const track = result.flights[0]?.track ?? [];

    expect(track.find((point) => point.time === 1_700_000_120)?.altitude).toBeCloseTo(10_035, -1);
    expect(track.find((point) => point.time === 1_700_000_180)?.altitude).toBeCloseTo(10_035, -1);
  });

  it('falls back to recent flight history when a live callsign is temporarily missing', async () => {
    process.env.OPENSKY_CLIENT_ID = 'client-from-env';
    process.env.OPENSKY_CLIENT_SECRET = 'secret-from-env';

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'token-123', expires_in: 1800 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        time: 1_700_000_600,
        states: [],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify([
        {
          icao24: '151abc',
          callsign: 'AFL1183 ',
          firstSeen: 1_700_000_000,
          lastSeen: 1_700_000_500,
          estDepartureAirport: 'UUEE',
          estArrivalAirport: 'URMG',
        },
      ]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        path: [
          [1_700_000_000, 55.9726, 37.4146, 0, 0, true],
          [1_700_000_500, 44.6917, 45.6889, 9_800, 155, false],
        ],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify([
        {
          estDepartureAirport: 'UUEE',
          estArrivalAirport: 'URMG',
          firstSeen: 1_700_000_000,
          lastSeen: 1_700_000_500,
        },
      ]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));

    vi.stubGlobal('fetch', fetchMock);

    const searchFlights = await loadSearchFlights();
    const result = await searchFlights('AFL1183');

    expect(result.matchedIdentifiers).toEqual(['AFL1183']);
    expect(result.notFoundIdentifiers).toEqual([]);
    expect(result.flights).toHaveLength(1);
    expect(result.flights[0]).toMatchObject({
      callsign: 'AFL1183',
      icao24: '151abc',
      route: {
        departureAirport: 'UUEE',
        arrivalAirport: 'URMG',
      },
    });
    expect(result.flights[0]?.current?.time).toBe(1_700_000_500);
  });

  it('guesses the departure airport from the origin point when route data is missing', async () => {
    process.env.OPENSKY_CLIENT_ID = 'client-from-env';
    process.env.OPENSKY_CLIENT_SECRET = 'secret-from-env';

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'token-123', expires_in: 1800 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        time: 1_700_000_600,
        states: [[
          '400123',
          'BAW123',
          'United Kingdom',
          1_700_000_580,
          1_700_000_600,
          -0.2,
          51.5,
          10_000,
          false,
          230,
          90,
          0,
          null,
          10_200,
          '1234',
          false,
          0,
          null,
        ]],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        path: [
          [1_700_000_000, 51.47, -0.4543, 0, 0, true],
          [1_700_000_300, 51.5, -0.2, 9_500, 80, false],
        ],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        EGLL: {
          iata: 'LHR',
          icao: 'EGLL',
          name: 'Heathrow Airport',
          city: 'London',
          country: 'United Kingdom',
          lat: 51.47,
          lon: -0.4543,
          tz: 'Europe/London',
        },
        EGLC: {
          iata: 'LCY',
          icao: 'EGLC',
          name: 'London City Airport',
          city: 'London',
          country: 'United Kingdom',
          lat: 51.5053,
          lon: 0.0553,
          tz: 'Europe/London',
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));

    vi.stubGlobal('fetch', fetchMock);

    const searchFlights = await loadSearchFlights();
    const result = await searchFlights('BAW123');

    expect(result.flights).toHaveLength(1);
    expect(result.flights[0]?.route.departureAirport).toBe('EGLL');
    expect(result.flights[0]?.route.arrivalAirport).toBeNull();
  });
});
