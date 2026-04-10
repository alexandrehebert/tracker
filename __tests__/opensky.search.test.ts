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
            find(_query: Record<string, unknown>) {
              return {
                async toArray() {
                  return [...store.values()].map((doc) => structuredClone(doc));
                },
              };
            },
            async deleteOne(filter: { _id: string }) {
              store.delete(filter._id);
              return { acknowledged: true, deletedCount: 1 };
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
  const originalAirlabsApiKey = process.env.AIRLABS_API_KEY;
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

    if (originalAirlabsApiKey === undefined) {
      delete process.env.AIRLABS_API_KEY;
    } else {
      process.env.AIRLABS_API_KEY = originalAirlabsApiKey;
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

  it('retries a rate-limited OpenSky states lookup once using the documented retry header', async () => {
    process.env.OPENSKY_CLIENT_ID = 'client-from-env';
    process.env.OPENSKY_CLIENT_SECRET = 'secret-from-env';

    let statesRequestCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url.includes('/protocol/openid-connect/token')) {
        return new Response(JSON.stringify({ access_token: 'token-123', expires_in: 1800 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.includes('/states/all')) {
        statesRequestCount += 1;

        if (statesRequestCount === 1) {
          return new Response(JSON.stringify({ error: 'Too Many Requests' }), {
            status: 429,
            statusText: 'Too Many Requests',
            headers: {
              'Content-Type': 'application/json',
              'X-Rate-Limit-Retry-After-Seconds': '0',
            },
          });
        }

        return new Response(JSON.stringify({ time: 1_700_000_700, states: [] }), {
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
    const result = await searchFlights('AF123');

    expect(result.flights).toEqual([]);
    expect(result.notFoundIdentifiers).toEqual(['AF123']);
    expect(statesRequestCount).toBe(2);
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
    expect(cachedResult?.flights[0]?.track).toHaveLength(150);
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

  it('keeps month-scale Wayback history without truncating snapshots or route points by default', async () => {
    process.env.MONGODB_URI = 'mongodb://mock:27017/tracker';

    const { readFlightSearchCache, writeFlightSearchCache } = await loadFlightCache();
    const cacheKey = 'shared-history:month-scale';
    const track = Array.from({ length: 200 }, (_, index) => ({
      time: 1_700_200_000 + index * 60,
      latitude: 40 + index * 0.05,
      longitude: -73 + index * 0.08,
      x: index,
      y: 200 - index,
      altitude: 8_000 + index * 20,
      heading: 90,
      onGround: index === 0,
    }));
    const fetchHistory = Array.from({ length: 1_700 }, (_, index) => ({
      id: `39bd24:manual-refresh:${1_700_200_000_000 + index * 60_000}`,
      capturedAt: 1_700_200_000_000 + index * 60_000,
      trigger: 'manual-refresh' as const,
      dataSource: 'opensky' as const,
      matchedBy: ['AFR123'],
      route: {
        departureAirport: 'LFPG',
        arrivalAirport: 'KJFK',
        firstSeen: 1_700_200_000,
        lastSeen: 1_700_212_000,
      },
      current: track[Math.min(index % track.length, track.length - 1)] ?? null,
      onGround: false,
      lastContact: 1_700_200_000 + index * 60,
      velocity: 900,
      heading: 90,
      geoAltitude: 10_000,
      baroAltitude: 10_000,
      sourceDetails: [],
    }));

    await writeFlightSearchCache(cacheKey, {
      query: 'AFR123',
      requestedIdentifiers: ['AFR123'],
      matchedIdentifiers: ['AFR123'],
      notFoundIdentifiers: [],
      fetchedAt: 1_700_302_000_000,
      flights: [
        {
          icao24: '39bd24',
          callsign: 'AFR123',
          originCountry: 'France',
          matchedBy: ['AFR123'],
          lastContact: track.at(-1)?.time ?? null,
          current: track.at(-1) ?? null,
          originPoint: track[0] ?? null,
          track,
          rawTrack: track,
          onGround: false,
          velocity: 905,
          heading: 92,
          verticalRate: 0,
          geoAltitude: track.at(-1)?.altitude ?? null,
          baroAltitude: track.at(-1)?.altitude ?? null,
          squawk: '1234',
          category: null,
          route: {
            departureAirport: 'LFPG',
            arrivalAirport: 'KJFK',
            firstSeen: 1_700_200_000,
            lastSeen: 1_700_212_000,
          },
          dataSource: 'opensky',
          sourceDetails: [],
          fetchHistory,
        },
      ],
    }, 'manual-refresh');

    const cachedResult = await readFlightSearchCache(cacheKey);
    expect(cachedResult?.flights[0]?.track).toHaveLength(200);
    expect(cachedResult?.flights[0]?.rawTrack).toHaveLength(200);
    expect(cachedResult?.flights[0]?.fetchHistory).toHaveLength(1_701);
  });

  it('bypasses the cached AirLabs live snapshot when forceRefresh is requested', async () => {
    delete process.env.OPENSKY_CLIENT_ID;
    delete process.env.OPENSKY_CLIENT_SECRET;
    delete process.env.AVIATION_STACK_API_KEY;
    delete process.env.FLIGHT_AWARE_API_KEY;
    delete process.env.FLIGHTAWARE_API_KEY;
    process.env.AIRLABS_API_KEY = 'airlabs-key';
    process.env.OPENSKY_CACHE_TTL_SECONDS = '300';
    delete process.env.MONGODB_URI;

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        response: {
          hex: '3C675A',
          reg_number: 'D-AIAB',
          aircraft_icao: 'A320',
          airline_iata: 'AF',
          airline_icao: 'AFR',
          airline_name: 'Air France',
          flight_number: '123',
          flight_icao: 'AFR123',
          flight_iata: 'AF123',
          dep_iata: 'CDG',
          dep_icao: 'LFPG',
          dep_time_ts: 1_775_852_100,
          dep_estimated_ts: 1_775_852_400,
          arr_iata: 'AMS',
          arr_icao: 'EHAM',
          arr_time_ts: 1_775_857_800,
          updated: 1_775_853_000,
          lat: 49.0123,
          lng: 2.5512,
          alt: 10_900,
          dir: 32,
          speed: 820,
          status: 'en-route',
          model: 'Airbus A320-200',
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        response: {
          hex: '3C675A',
          reg_number: 'D-AIAB',
          aircraft_icao: 'A320',
          airline_iata: 'AF',
          airline_icao: 'AFR',
          airline_name: 'Air France',
          flight_number: '123',
          flight_icao: 'AFR123',
          flight_iata: 'AF123',
          dep_iata: 'CDG',
          dep_icao: 'LFPG',
          dep_time_ts: 1_775_852_100,
          dep_estimated_ts: 1_775_852_400,
          arr_iata: 'AMS',
          arr_icao: 'EHAM',
          arr_time_ts: 1_775_857_800,
          updated: 1_775_853_600,
          lat: 49.245,
          lng: 2.91,
          alt: 11_250,
          dir: 41,
          speed: 835,
          status: 'en-route',
          model: 'Airbus A320-200',
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));

    vi.stubGlobal('fetch', fetchMock);

    const searchFlights = await loadSearchFlights();
    const firstResult = await searchFlights('AF123');
    const refreshedResult = await searchFlights('AF123', { forceRefresh: true });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(firstResult.flights[0]?.dataSource).toBe('airlabs');
    expect(firstResult.flights[0]?.lastContact).toBe(1_775_853_000);
    expect(refreshedResult.flights[0]?.lastContact).toBe(1_775_853_600);
    expect(refreshedResult.flights[0]?.geoAltitude).toBe(11_250);
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
});
