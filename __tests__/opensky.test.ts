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

  beforeEach(() => {
    vi.restoreAllMocks();
    mockMongoCollections.clear();
    delete process.env.OPENSKY_CLIENT_ID;
    delete process.env.OPENSKY_CLIENT_SECRET;
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

  it('reads OpenSky credentials from environment variables', async () => {
    process.env.OPENSKY_CLIENT_ID = 'client-from-env';
    process.env.OPENSKY_CLIENT_SECRET = 'secret-from-env';

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'token-123', expires_in: 1800 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ time: 123, states: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));

    vi.stubGlobal('fetch', fetchMock);

    const searchFlights = await loadSearchFlights();
    const result = await searchFlights('AF123');

    expect(result.requestedIdentifiers).toEqual(['AF123']);
    expect(result.flights).toEqual([]);

    const [authUrl, authInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(authUrl).toBe('https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token');
    expect(authInit.method).toBe('POST');

    const params = authInit.body as URLSearchParams;
    expect(params.get('client_id')).toBe('client-from-env');
    expect(params.get('client_secret')).toBe('secret-from-env');
  });

  it('retries OpenSky auth once after a transient connect timeout', async () => {
    process.env.OPENSKY_CLIENT_ID = 'client-from-env';
    process.env.OPENSKY_CLIENT_SECRET = 'secret-from-env';

    const networkCause = Object.assign(new Error('connect timeout reached'), {
      code: 'UND_ERR_CONNECT_TIMEOUT',
      errno: 'ETIMEDOUT',
      syscall: 'connect',
      host: 'auth.opensky-network.org',
    });
    const fetchError = Object.assign(new TypeError('fetch failed'), { cause: networkCause });

    const fetchMock = vi.fn()
      .mockRejectedValueOnce(fetchError)
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'token-123', expires_in: 1800 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ time: 123, states: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));

    vi.stubGlobal('fetch', fetchMock);

    const searchFlights = await loadSearchFlights();
    const result = await searchFlights('AF123');

    expect(result.requestedIdentifiers).toEqual(['AF123']);
    expect(result.flights).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token');
  });

  it('retries OpenSky auth once after an AbortSignal timeout', async () => {
    process.env.OPENSKY_CLIENT_ID = 'client-from-env';
    process.env.OPENSKY_CLIENT_SECRET = 'secret-from-env';

    const timeoutError = Object.assign(new Error('The operation was aborted due to timeout'), {
      name: 'TimeoutError',
      code: 23,
    });

    const fetchMock = vi.fn()
      .mockRejectedValueOnce(timeoutError)
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'token-123', expires_in: 1800 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ time: 123, states: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));

    vi.stubGlobal('fetch', fetchMock);

    const searchFlights = await loadSearchFlights();
    const result = await searchFlights('AF123');

    expect(result.requestedIdentifiers).toEqual(['AF123']);
    expect(result.flights).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token');
  });

  it('fails fast when the OpenSky env vars are missing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const searchFlights = await loadSearchFlights();

    await expect(searchFlights('AF123')).rejects.toThrow(
      'Missing OpenSky client credentials. Set OPENSKY_CLIENT_ID and OPENSKY_CLIENT_SECRET in your environment.',
    );

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns realistic preset demo flights for TEST1, TEST2, and TEST3 searches', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const searchFlights = await loadSearchFlights();
    const result = await searchFlights('TEST1,TEST2,TEST3');

    expect(result.requestedIdentifiers).toEqual(['TEST1', 'TEST2', 'TEST3']);
    expect(result.matchedIdentifiers).toEqual(['TEST1', 'TEST2', 'TEST3']);
    expect(result.notFoundIdentifiers).toEqual([]);
    expect(result.flights).toHaveLength(3);
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
          departureAirport: 'MEX',
          arrivalAirport: 'ATL',
        }),
      }),
    ]));

    const groundedFlight = result.flights.find((flight) => flight.callsign === 'DAL220');
    expect(groundedFlight?.originPoint?.longitude).toBeGreaterThan(-100);
    expect(groundedFlight?.originPoint?.longitude).toBeLessThan(-98);
    expect(groundedFlight?.originPoint?.latitude).toBeGreaterThan(19);
    expect(groundedFlight?.originPoint?.latitude).toBeLessThan(20);
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

  it('matches callsigns exactly instead of returning partial substring results', async () => {
    process.env.OPENSKY_CLIENT_ID = 'client-from-env';
    process.env.OPENSKY_CLIENT_SECRET = 'secret-from-env';

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
            '4ca123',
            'ETH5758',
            'Ireland',
            1_700_000_580,
            1_700_000_600,
            8.5,
            47.4,
            10_200,
            false,
            210,
            96,
            0,
            null,
            10_350,
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

      if (url.includes('/flights/all')) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.includes('/tracks/all') || url.includes('/flights/aircraft')) {
        throw new Error(`Unexpected exact-match lookup for ${url}`);
      }

      throw new Error(`Unhandled fetch URL in test: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    const searchFlights = await loadSearchFlights();
    const result = await searchFlights('ETH575');

    expect(result.flights).toEqual([]);
    expect(result.matchedIdentifiers).toEqual([]);
    expect(result.notFoundIdentifiers).toEqual(['ETH575']);
  });

  it('reuses cached flight search results for up to the configured ttl', async () => {
    process.env.OPENSKY_CLIENT_ID = 'client-from-env';
    process.env.OPENSKY_CLIENT_SECRET = 'secret-from-env';
    process.env.OPENSKY_CACHE_TTL_SECONDS = '300';
    process.env.MONGODB_URI = 'mongodb://mock:27017/tracker';

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'token-123', expires_in: 1800 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ time: 123, states: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));

    vi.stubGlobal('fetch', fetchMock);

    const searchFlights = await loadSearchFlights();
    const firstResult = await searchFlights('AF123');
    const secondResult = await searchFlights('AF123');

    expect(secondResult).toEqual(firstResult);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('persists shared fetch-history snapshots across refreshes and cached reads', async () => {
    process.env.OPENSKY_CLIENT_ID = 'client-from-env';
    process.env.OPENSKY_CLIENT_SECRET = 'secret-from-env';
    process.env.OPENSKY_CACHE_TTL_SECONDS = '300';
    delete process.env.AVIATION_STACK_API_KEY;
    delete process.env.FLIGHT_AWARE_API_KEY;
    delete process.env.FLIGHTAWARE_API_KEY;
    process.env.MONGODB_URI = 'mongodb://mock:27017/tracker';

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'token-123', expires_in: 1800 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
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
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ path: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        time: 1_700_000_900,
        states: [[
          '39bd24',
          'AFR123',
          'France',
          1_700_000_880,
          1_700_000_900,
          -14.9,
          49.8,
          11_050,
          false,
          920,
          284,
          0,
          null,
          11_050,
          '1234',
          false,
          0,
          null,
        ]],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ path: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));

    vi.stubGlobal('fetch', fetchMock);

    const searchFlights = await loadSearchFlights();
    const firstResult = await searchFlights('AFR123');
    const refreshedResult = await searchFlights('AFR123', { forceRefresh: true });
    const cachedResult = await searchFlights('AFR123');

    expect(firstResult.flights[0]?.fetchHistory).toHaveLength(1);
    expect(refreshedResult.flights[0]?.fetchHistory).toHaveLength(2);
    expect(cachedResult.flights[0]?.fetchHistory).toHaveLength(2);
    expect(cachedResult.flights[0]?.lastContact).toBe(1_700_000_900);
    expect(fetchMock).toHaveBeenCalledTimes(7);
  });

  it('preserves the earliest known origin point when shared-cache reconciliation receives a later partial track', async () => {
    process.env.MONGODB_URI = 'mongodb://mock:27017/tracker';

    const { readFlightSearchCache, writeFlightSearchCache } = await loadFlightCache();
    const cacheKey = 'preserve-origin:afr123';
    const initialTrack = Array.from({ length: 120 }, (_, index) => ({
      time: 1_700_100_000 + index * 60,
      latitude: 41.9742 + index * 0.01,
      longitude: -87.9073 + index * 0.25,
      x: 120 + index,
      y: 180 - index * 0.25,
      altitude: index === 0 ? 0 : 3_000 + index * 35,
      heading: 102,
      onGround: index === 0,
    }));
    const refreshedTrack = [
      ...initialTrack.slice(30),
      ...Array.from({ length: 30 }, (_, index) => ({
        time: 1_700_100_000 + (120 + index) * 60,
        latitude: 43.1742 + index * 0.01,
        longitude: -57.9073 + index * 0.25,
        x: 240 + index,
        y: 150 - index * 0.25,
        altitude: 7_200 + index * 20,
        heading: 105,
        onGround: false,
      })),
    ];

    await writeFlightSearchCache(cacheKey, {
      query: 'AFR123',
      requestedIdentifiers: ['AFR123'],
      matchedIdentifiers: ['AFR123'],
      notFoundIdentifiers: [],
      fetchedAt: 1_700_100_000_000,
      flights: [
        {
          icao24: '39bd24',
          callsign: 'AFR123',
          originCountry: 'France',
          matchedBy: ['AFR123'],
          lastContact: initialTrack.at(-1)?.time ?? null,
          current: initialTrack.at(-1)!,
          originPoint: initialTrack[0]!,
          track: initialTrack,
          rawTrack: initialTrack,
          onGround: false,
          velocity: 905,
          heading: 102,
          verticalRate: 0,
          geoAltitude: initialTrack.at(-1)?.altitude ?? null,
          baroAltitude: initialTrack.at(-1)?.altitude ?? null,
          squawk: '1234',
          category: null,
          route: {
            departureAirport: 'KORD',
            arrivalAirport: 'HAAB',
            firstSeen: null,
            lastSeen: null,
          },
        },
      ],
    }, 'search');

    await writeFlightSearchCache(cacheKey, {
      query: 'AFR123',
      requestedIdentifiers: ['AFR123'],
      matchedIdentifiers: ['AFR123'],
      notFoundIdentifiers: [],
      fetchedAt: 1_700_107_200_000,
      flights: [
        {
          icao24: '39bd24',
          callsign: 'AFR123',
          originCountry: 'France',
          matchedBy: ['AFR123'],
          lastContact: refreshedTrack.at(-1)?.time ?? null,
          current: refreshedTrack.at(-1)!,
          originPoint: refreshedTrack[0]!,
          track: refreshedTrack,
          rawTrack: refreshedTrack,
          onGround: false,
          velocity: 920,
          heading: 105,
          verticalRate: 0,
          geoAltitude: refreshedTrack.at(-1)?.altitude ?? null,
          baroAltitude: refreshedTrack.at(-1)?.altitude ?? null,
          squawk: '1234',
          category: null,
          route: {
            departureAirport: 'KORD',
            arrivalAirport: 'HAAB',
            firstSeen: null,
            lastSeen: null,
          },
        },
      ],
    }, 'manual-refresh');

    const cachedResult = await readFlightSearchCache(cacheKey);

    expect(cachedResult?.flights[0]?.originPoint?.time).toBe(initialTrack[0]?.time ?? null);
    expect(cachedResult?.flights[0]?.track[0]?.time).toBe(initialTrack[0]?.time ?? null);
    expect(cachedResult?.flights[0]?.track).toHaveLength(120);
  });

  it('keeps selected-flight snapshots in shared history after a cached page reload', async () => {
    process.env.MONGODB_URI = 'mongodb://mock:27017/tracker';

    const { readFlightSearchCache, writeFlightDetailsCache, writeFlightSearchCache } = await loadFlightCache();
    const cacheKey = 'shared-history:afr123';

    const baseFlight = {
      icao24: '39bd24',
      callsign: 'AFR123',
      originCountry: 'France',
      matchedBy: ['callsign'],
      lastContact: 1_700_000_900,
      current: null,
      originPoint: null,
      track: [],
      rawTrack: [],
      onGround: false,
      velocity: 920,
      heading: 284,
      verticalRate: 0,
      geoAltitude: 11_050,
      baroAltitude: 11_050,
      squawk: '1234',
      category: null,
      route: {
        departureAirport: 'LFPG',
        arrivalAirport: 'KJFK',
        firstSeen: 1_700_000_000,
        lastSeen: 1_700_002_400,
      },
      dataSource: 'opensky' as const,
      sourceDetails: [],
    };

    await writeFlightSearchCache(cacheKey, {
      query: 'AFR123',
      requestedIdentifiers: ['AFR123'],
      matchedIdentifiers: ['AFR123'],
      notFoundIdentifiers: [],
      fetchedAt: 1_700_000_000_000,
      flights: [baseFlight],
    }, 'search');

    await writeFlightSearchCache(cacheKey, {
      query: 'AFR123',
      requestedIdentifiers: ['AFR123'],
      matchedIdentifiers: ['AFR123'],
      notFoundIdentifiers: [],
      fetchedAt: 1_700_000_060_000,
      flights: [
        {
          ...baseFlight,
          lastContact: 1_700_000_960,
          velocity: 930,
          geoAltitude: 11_200,
          baroAltitude: 11_200,
        },
      ],
    }, 'manual-refresh');

    await writeFlightDetailsCache('details:39bd24', {
      icao24: '39bd24',
      callsign: 'AFR123',
      fetchedAt: 1_700_000_090_000,
      route: {
        departureAirport: 'LFPG',
        arrivalAirport: 'KJFK',
        firstSeen: 1_700_000_000,
        lastSeen: 1_700_002_400,
      },
      departureAirport: null,
      arrivalAirport: null,
      flightNumber: '123',
      airline: {
        name: 'Air France',
        iata: 'AF',
        icao: 'AFR',
      },
      aircraft: {
        registration: 'F-GZNN',
        iata: 'B77W',
        icao: 'B77W',
        icao24: '39BD24',
        model: 'Boeing 777-300ER',
      },
      dataSource: 'hybrid',
      sourceDetails: [],
    }, 'search');

    const cachedResult = await readFlightSearchCache(cacheKey);

    expect(cachedResult?.flights[0]?.fetchHistory).toHaveLength(3);
  });

  it('bypasses the cached search result when forceRefresh is requested', async () => {
    process.env.OPENSKY_CLIENT_ID = 'client-from-env';
    process.env.OPENSKY_CLIENT_SECRET = 'secret-from-env';
    process.env.OPENSKY_CACHE_TTL_SECONDS = '300';
    process.env.MONGODB_URI = 'mongodb://mock:27017/tracker';

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'token-123', expires_in: 1800 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
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
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ path: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        time: 1_700_000_900,
        states: [[
          '39bd24',
          'AFR123',
          'France',
          1_700_000_880,
          1_700_000_900,
          -14.9,
          49.8,
          11_050,
          false,
          920,
          284,
          0,
          null,
          11_050,
          '1234',
          false,
          0,
          null,
        ]],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ path: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));

    vi.stubGlobal('fetch', fetchMock);

    const searchFlights = await loadSearchFlights();
    const firstResult = await searchFlights('AFR123');
    const refreshedResult = await searchFlights('AFR123', { forceRefresh: true });

    expect(fetchMock).toHaveBeenCalledTimes(7);
    expect(firstResult.flights[0]?.lastContact).toBe(1_700_000_600);
    expect(refreshedResult.flights[0]?.lastContact).toBe(1_700_000_900);
    expect(refreshedResult.flights[0]?.geoAltitude).toBe(11_050);
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

  it('enriches live OpenSky matches with Aviationstack metadata when available', async () => {
    process.env.OPENSKY_CLIENT_ID = 'client-from-env';
    process.env.OPENSKY_CLIENT_SECRET = 'secret-from-env';
    process.env.AVIATION_STACK_API_KEY = 'aviationstack-key';
    delete process.env.MONGODB_URI;

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'token-123', expires_in: 1800 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
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
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        path: [
          [1_700_000_300, 49.8, -12.0, 9_500, 270, false],
          [1_700_000_480, 49.6, -13.5, 10_100, 276, false],
        ],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify([
        {
          estDepartureAirport: 'LFPG',
          estArrivalAirport: 'KJFK',
          firstSeen: 1_700_000_000,
          lastSeen: 1_700_002_400,
        },
      ]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        pagination: { count: 1, total: 1, offset: 0, limit: 100 },
        data: [
          {
            flight_status: 'active',
            departure: {
              airport: 'Paris Charles de Gaulle Airport',
              iata: 'CDG',
              icao: 'LFPG',
            },
            arrival: {
              airport: 'John F. Kennedy International Airport',
              iata: 'JFK',
              icao: 'KJFK',
            },
            airline: {
              name: 'Air France',
              iata: 'AF',
              icao: 'AFR',
            },
            flight: {
              number: '123',
              iata: 'AF123',
              icao: 'AFR123',
            },
            aircraft: {
              registration: 'F-GZNN',
              iata: 'B77W',
              icao: 'B77W',
              icao24: '39BD24',
            },
            live: {
              updated: '2026-04-04T10:05:00+00:00',
              latitude: 49.5,
              longitude: -15.4,
              altitude: 10668,
              direction: 281,
              speed_horizontal: 905,
              is_ground: false,
            },
          },
        ],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));

    vi.stubGlobal('fetch', fetchMock);

    const searchFlights = await loadSearchFlights();
    const result = await searchFlights('AFR123');

    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('aviationstack.com/v1/flights'))).toBe(true);
    expect(result.flights).toHaveLength(1);
    expect(result.notFoundIdentifiers).toEqual([]);
    expect(result.flights[0]).toMatchObject({
      callsign: 'AFR123',
      flightNumber: '123',
      airline: {
        name: 'Air France',
      },
      aircraft: {
        registration: 'F-GZNN',
        icao24: '39BD24',
      },
      dataSource: 'hybrid',
    });
    expect(result.flights[0]?.sourceDetails).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'opensky',
          status: 'used',
        }),
        expect.objectContaining({
          source: 'aviationstack',
          status: 'used',
          usedInResult: true,
        }),
      ]),
    );
  });

  it('falls back to the live FlightAware record instead of a future scheduled duplicate when OpenSky has no live match', async () => {
    process.env.OPENSKY_CLIENT_ID = 'client-from-env';
    process.env.OPENSKY_CLIENT_SECRET = 'secret-from-env';
    process.env.FLIGHT_AWARE_API_KEY = 'flightaware-key';
    delete process.env.FLIGHTAWARE_API_KEY;
    delete process.env.AVIATION_STACK_API_KEY;
    delete process.env.MONGODB_URI;

    const now = Math.floor(Date.now() / 1000);
    const futureDeparture = new Date((now + (48 * 60 * 60)) * 1000).toISOString();
    const futureArrival = new Date((now + (54 * 60 * 60)) * 1000).toISOString();
    const liveDeparture = new Date((now - (2 * 60 * 60)) * 1000).toISOString();
    const livePosition = new Date((now - 120) * 1000).toISOString();

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'token-123', expires_in: 1800 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        time: now,
        states: [],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        links: {},
        num_pages: 1,
        flights: [
          {
            ident: 'ETH575',
            ident_icao: 'ETH575',
            ident_iata: 'ET575',
            fa_flight_id: 'ETH575-future',
            operator: 'Ethiopian Airlines',
            operator_icao: 'ETH',
            operator_iata: 'ET',
            flight_number: '575',
            aircraft_type: 'B788',
            origin: {
              code: 'KORD',
              code_icao: 'KORD',
              code_iata: 'ORD',
              name: "Chicago O'Hare Intl",
            },
            destination: {
              code: 'HAAB',
              code_icao: 'HAAB',
              code_iata: 'ADD',
              name: "Bole Int'l",
            },
            scheduled_out: futureDeparture,
            scheduled_in: futureArrival,
            last_position: null,
          },
          {
            ident: 'ETH575',
            ident_icao: 'ETH575',
            ident_iata: 'ET575',
            fa_flight_id: 'ETH575-live',
            operator: 'Ethiopian Airlines',
            operator_icao: 'ETH',
            operator_iata: 'ET',
            flight_number: '575',
            aircraft_type: 'B788',
            origin: {
              code: 'KORD',
              code_icao: 'KORD',
              code_iata: 'ORD',
              name: "Chicago O'Hare Intl",
            },
            destination: {
              code: 'HAAB',
              code_icao: 'HAAB',
              code_iata: 'ADD',
              name: "Bole Int'l",
            },
            actual_out: liveDeparture,
            last_position: {
              latitude: 46.4141,
              longitude: 0.762,
              altitude: 39450,
              groundspeed: 460,
              heading: 117,
              timestamp: livePosition,
            },
          },
        ],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));

    vi.stubGlobal('fetch', fetchMock);

    const searchFlights = await loadSearchFlights();
    const result = await searchFlights('ETH575');

    expect(result.flights).toHaveLength(1);
    expect(result.flights[0]?.dataSource).toBe('flightaware');
    expect(result.flights[0]?.icao24).toBe('fa-eth575-live');
    expect(result.flights[0]?.callsign).toBe('ETH575');
    expect(result.flights[0]?.current?.time).toBe(now - 120);
    expect(result.flights[0]?.flightNumber).toBe('575');
  });

  it('enriches live OpenSky matches with FlightAware metadata when available', async () => {
    process.env.OPENSKY_CLIENT_ID = 'client-from-env';
    process.env.OPENSKY_CLIENT_SECRET = 'secret-from-env';
    process.env.FLIGHT_AWARE_API_KEY = 'flightaware-key';
    delete process.env.FLIGHTAWARE_API_KEY;
    delete process.env.AVIATION_STACK_API_KEY;
    delete process.env.MONGODB_URI;

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'token-123', expires_in: 1800 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
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
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        path: [
          [1_700_000_300, 49.8, -12.0, 9_500, 270, false],
          [1_700_000_480, 49.6, -13.5, 10_100, 276, false],
        ],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify([
        {
          estDepartureAirport: 'LFPG',
          estArrivalAirport: 'KJFK',
          firstSeen: 1_700_000_000,
          lastSeen: 1_700_002_400,
        },
      ]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        links: {},
        num_pages: 1,
        flights: [
          {
            ident: 'AFR123',
            ident_icao: 'AFR123',
            ident_iata: 'AF123',
            fa_flight_id: 'AFR123-1712225100-airline-0123',
            operator: 'Air France',
            operator_icao: 'AFR',
            operator_iata: 'AF',
            flight_number: '123',
            registration: 'F-GZNN',
            atc_ident: 'AFR123',
            aircraft_type: 'B77W',
            origin: {
              code: 'LFPG',
              code_icao: 'LFPG',
              code_iata: 'CDG',
              name: 'Paris Charles de Gaulle Airport',
              city: 'Paris',
            },
            destination: {
              code: 'KJFK',
              code_icao: 'KJFK',
              code_iata: 'JFK',
              name: 'John F. Kennedy International Airport',
              city: 'New York',
            },
            scheduled_out: '2026-04-04T08:15:00Z',
            estimated_out: '2026-04-04T08:18:00Z',
            actual_out: '2026-04-04T08:19:00Z',
            estimated_in: '2026-04-04T14:10:00Z',
            last_position: {
              fa_flight_id: 'AFR123-1712225100-airline-0123',
              altitude: 35000,
              groundspeed: 485,
              heading: 281,
              latitude: 49.5,
              longitude: -15.4,
              timestamp: '2026-04-04T10:05:00Z',
            },
          },
        ],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));

    vi.stubGlobal('fetch', fetchMock);

    const searchFlights = await loadSearchFlights();
    const result = await searchFlights('AFR123');

    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('aeroapi.flightaware.com/aeroapi/flights/AFR123'))).toBe(true);
    expect(result.flights).toHaveLength(1);
    expect(result.notFoundIdentifiers).toEqual([]);
    expect(result.flights[0]).toMatchObject({
      callsign: 'AFR123',
      flightNumber: '123',
      airline: {
        name: 'Air France',
        icao: 'AFR',
      },
      aircraft: {
        registration: 'F-GZNN',
        model: 'B77W',
      },
      dataSource: 'hybrid',
    });
    expect(result.flights[0]?.sourceDetails).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'opensky',
          status: 'used',
        }),
        expect.objectContaining({
          source: 'flightaware',
          status: 'used',
          usedInResult: true,
        }),
      ]),
    );
  });

  it('falls back to Aviationstack when OpenSky has no live match', async () => {
    process.env.OPENSKY_CLIENT_ID = 'client-from-env';
    process.env.OPENSKY_CLIENT_SECRET = 'secret-from-env';
    process.env.AVIATION_STACK_API_KEY = 'aviationstack-key';
    delete process.env.MONGODB_URI;

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
      .mockResolvedValueOnce(new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        pagination: { count: 1, total: 1, offset: 0, limit: 100 },
        data: [
          {
            flight_status: 'active',
            departure: {
              airport: 'Paris Charles de Gaulle Airport',
              iata: 'CDG',
              icao: 'LFPG',
              scheduled: '2026-04-04T08:15:00+00:00',
              estimated: '2026-04-04T08:18:00+00:00',
              actual: '2026-04-04T08:19:00+00:00',
            },
            arrival: {
              airport: 'John F. Kennedy International Airport',
              iata: 'JFK',
              icao: 'KJFK',
              scheduled: '2026-04-04T14:20:00+00:00',
              estimated: '2026-04-04T14:10:00+00:00',
              actual: null,
            },
            airline: {
              name: 'Air France',
              iata: 'AF',
              icao: 'AFR',
            },
            flight: {
              number: '123',
              iata: 'AF123',
              icao: 'AFR123',
            },
            aircraft: {
              registration: 'F-GZNN',
              iata: 'B77W',
              icao: 'B77W',
              icao24: '39BD24',
            },
            live: {
              updated: '2026-04-04T10:05:00+00:00',
              latitude: 49.5,
              longitude: -15.4,
              altitude: 10668,
              direction: 281,
              speed_horizontal: 905,
              is_ground: false,
            },
          },
        ],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));

    vi.stubGlobal('fetch', fetchMock);

    const searchFlights = await loadSearchFlights();
    const result = await searchFlights('AF123');

    expect(result.flights).toHaveLength(1);
    expect(result.matchedIdentifiers).toEqual(['AF123']);
    expect(result.flights[0]).toMatchObject({
      callsign: 'AF123',
      route: {
        departureAirport: 'LFPG',
        arrivalAirport: 'KJFK',
      },
      airline: {
        name: 'Air France',
      },
      aircraft: {
        registration: 'F-GZNN',
        model: 'B77W',
      },
      dataSource: 'aviationstack',
    });
  });

  it('includes the underlying network diagnostics when OpenSky fetch fails and Aviationstack takes over', async () => {
    process.env.OPENSKY_CLIENT_ID = 'client-from-env';
    process.env.OPENSKY_CLIENT_SECRET = 'secret-from-env';
    process.env.AVIATION_STACK_API_KEY = 'aviationstack-key';
    delete process.env.MONGODB_URI;

    const networkCause = Object.assign(new Error('connect timeout reached'), {
      code: 'ETIMEDOUT',
      errno: 'ETIMEDOUT',
      syscall: 'connect',
      host: 'auth.opensky-network.org',
    });
    const fetchError = Object.assign(new TypeError('fetch failed'), { cause: networkCause });

    const fetchMock = vi.fn()
      .mockRejectedValueOnce(fetchError)
      .mockRejectedValueOnce(fetchError)
      .mockResolvedValueOnce(new Response(JSON.stringify({
        pagination: { count: 1, total: 1, offset: 0, limit: 100 },
        data: [
          {
            flight_status: 'active',
            departure: {
              airport: 'Paris Charles de Gaulle Airport',
              iata: 'CDG',
              icao: 'LFPG',
            },
            arrival: {
              airport: 'John F. Kennedy International Airport',
              iata: 'JFK',
              icao: 'KJFK',
            },
            airline: {
              name: 'Air France',
              iata: 'AF',
              icao: 'AFR',
            },
            flight: {
              number: '123',
              iata: 'AF123',
              icao: 'AFR123',
            },
            aircraft: {
              registration: 'F-GZNN',
              iata: 'B77W',
              icao: 'B77W',
              icao24: '39BD24',
            },
            live: {
              updated: '2026-04-04T10:05:00+00:00',
              latitude: 49.5,
              longitude: -15.4,
              altitude: 10668,
              direction: 281,
              speed_horizontal: 905,
              is_ground: false,
            },
          },
        ],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));

    vi.stubGlobal('fetch', fetchMock);

    const searchFlights = await loadSearchFlights();
    const result = await searchFlights('AF123');
    const openSkyDetail = result.flights[0]?.sourceDetails?.find((detail) => detail.source === 'opensky');

    expect(openSkyDetail).toMatchObject({
      source: 'opensky',
      status: 'error',
      usedInResult: false,
      raw: expect.objectContaining({
        query: 'AF123',
        requestedIdentifiers: ['AF123'],
        code: 'ETIMEDOUT',
        causeMessage: 'connect timeout reached',
      }),
    });
    expect(openSkyDetail?.reason).toContain('ETIMEDOUT');
  });

  it('enriches selected-flight details with Aviationstack aircraft metadata when available', async () => {
    process.env.OPENSKY_CLIENT_ID = 'client-from-env';
    process.env.OPENSKY_CLIENT_SECRET = 'secret-from-env';
    process.env.AVIATION_STACK_API_KEY = 'aviationstack-key';
    delete process.env.MONGODB_URI;

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'token-123', expires_in: 1800 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify([
        {
          estDepartureAirport: 'LFPG',
          estArrivalAirport: 'KJFK',
          firstSeen: 1_700_000_000,
          lastSeen: 1_700_002_400,
        },
      ]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        pagination: { count: 1, total: 1, offset: 0, limit: 100 },
        data: [
          {
            departure: {
              airport: 'Paris Charles de Gaulle Airport',
              iata: 'CDG',
              icao: 'LFPG',
              scheduled: '2026-04-04T08:15:00+00:00',
              actual: '2026-04-04T08:19:00+00:00',
            },
            arrival: {
              airport: 'John F. Kennedy International Airport',
              iata: 'JFK',
              icao: 'KJFK',
              scheduled: '2026-04-04T14:20:00+00:00',
              actual: null,
            },
            airline: {
              name: 'Air France',
              iata: 'AF',
              icao: 'AFR',
            },
            flight: {
              number: '12',
              iata: 'AFR12',
              icao: 'AFR12',
            },
            aircraft: {
              registration: 'F-GSPK',
              iata: 'A359',
              icao: 'A359',
              icao24: '39BD24',
            },
          },
        ],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        LFPG: {
          iata: 'CDG',
          icao: 'LFPG',
          name: 'Paris Charles de Gaulle Airport',
          city: 'Paris',
          country: 'France',
          lat: 49.0097,
          lon: 2.5479,
          tz: 'Europe/Paris',
        },
        KJFK: {
          iata: 'JFK',
          icao: 'KJFK',
          name: 'John F. Kennedy International Airport',
          city: 'New York',
          country: 'United States',
          lat: 40.6413,
          lon: -73.7781,
          tz: 'America/New_York',
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));

    vi.stubGlobal('fetch', fetchMock);

    const getFlightSelectionDetails = await loadFlightSelectionDetails();
    const result = await getFlightSelectionDetails({
      icao24: '39bd24',
      callsign: 'AFR12',
      departureAirport: 'CDG',
      arrivalAirport: 'JFK',
      lastSeen: 1_700_002_400,
    });

    expect(result.departureAirport?.name).toBe('Paris Charles de Gaulle Airport');
    expect(result.arrivalAirport?.name).toBe('John F. Kennedy International Airport');
    expect(result.airline?.name).toBe('Air France');
    expect(result.aircraft).toMatchObject({
      registration: 'F-GSPK',
      model: 'A359',
      icao24: '39BD24',
    });
    expect(result.dataSource).toBe('hybrid');
  });

  it('ignores Aviationstack route timestamps that land after the OpenSky reference window', async () => {
    process.env.OPENSKY_CLIENT_ID = 'client-from-env';
    process.env.OPENSKY_CLIENT_SECRET = 'secret-from-env';
    process.env.AVIATION_STACK_API_KEY = 'aviationstack-key';
    delete process.env.MONGODB_URI;

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'token-123', expires_in: 1800 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [
          {
            flight_status: 'active',
            departure: {
              airport: 'Paris Charles de Gaulle Airport',
              iata: 'CDG',
              icao: 'LFPG',
              actual: '2026-04-04T15:44:00+02:00',
            },
            arrival: {
              airport: 'John F. Kennedy International Airport',
              iata: 'JFK',
              icao: 'KJFK',
              estimated: '2026-04-04T18:30:00-04:00',
            },
            airline: {
              name: 'Air France',
              iata: 'AF',
              icao: 'AFR',
            },
            flight: {
              number: '706',
              iata: 'AF706',
              icao: 'AFR706',
            },
            aircraft: {
              registration: 'F-GZNT',
              icao24: '39bd24',
              iata: 'B77W',
              icao: 'B77W',
            },
            live: null,
          },
        ],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        LFPG: {
          iata: 'CDG',
          icao: 'LFPG',
          name: 'Paris Charles de Gaulle Airport',
          city: 'Paris',
          country: 'France',
          lat: 49.0097,
          lon: 2.5479,
          tz: 'Europe/Paris',
        },
        KJFK: {
          iata: 'JFK',
          icao: 'KJFK',
          name: 'John F. Kennedy International Airport',
          city: 'New York',
          country: 'United States',
          lat: 40.6413,
          lon: -73.7781,
          tz: 'America/New_York',
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));

    vi.stubGlobal('fetch', fetchMock);

    const getFlightSelectionDetails = await loadFlightSelectionDetails();
    const result = await getFlightSelectionDetails({
      icao24: '39bd24',
      callsign: 'AFR706',
      departureAirport: 'CDG',
      arrivalAirport: 'JFK',
      lastSeen: 1_775_274_600,
    });

    expect(result.route.firstSeen).toBeNull();
    expect(result.route.lastSeen).toBeNull();
    expect(result.airline?.name).toBe('Air France');
  });

  it('caches selected-flight airport detail lookups for repeated selections', async () => {
    process.env.OPENSKY_CLIENT_ID = 'client-from-env';
    process.env.OPENSKY_CLIENT_SECRET = 'secret-from-env';
    process.env.MONGODB_URI = 'mongodb://mock:27017/tracker';

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'token-123', expires_in: 1800 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify([
        {
          estDepartureAirport: 'LFPG',
          estArrivalAirport: 'KJFK',
          firstSeen: 1_700_000_000,
          lastSeen: 1_700_002_400,
        },
      ]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        LFPG: {
          iata: 'CDG',
          icao: 'LFPG',
          name: 'Paris Charles de Gaulle Airport',
          city: 'Paris',
          country: 'France',
          lat: 49.0097,
          lon: 2.5479,
          tz: 'Europe/Paris',
        },
        KJFK: {
          iata: 'JFK',
          icao: 'KJFK',
          name: 'John F. Kennedy International Airport',
          city: 'New York',
          country: 'United States',
          lat: 40.6413,
          lon: -73.7781,
          tz: 'America/New_York',
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));

    vi.stubGlobal('fetch', fetchMock);

    const getFlightSelectionDetails = await loadFlightSelectionDetails();
    const firstResult = await getFlightSelectionDetails({
      icao24: '3c675a',
      callsign: 'AFR12',
      departureAirport: 'CDG',
      arrivalAirport: 'JFK',
      lastSeen: 1_700_002_400,
    });
    const secondResult = await getFlightSelectionDetails({
      icao24: '3c675a',
      callsign: 'AFR12',
      departureAirport: 'CDG',
      arrivalAirport: 'JFK',
      lastSeen: 1_700_002_400,
    });

    expect(secondResult).toEqual(firstResult);
    expect(firstResult.departureAirport?.name).toBe('Paris Charles de Gaulle Airport');
    expect(firstResult.arrivalAirport?.name).toBe('John F. Kennedy International Airport');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
