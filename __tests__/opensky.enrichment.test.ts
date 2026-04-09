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

async function loadFlightAwareProvider() {
  vi.resetModules();
  return await import('~/lib/server/providers/flightaware');
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

  it('skips OpenSky live requests when the provider is disabled and falls back directly to Aviationstack', async () => {
    process.env.OPENSKY_DISABLED = 'true';
    delete process.env.OPENSKY_CLIENT_ID;
    delete process.env.OPENSKY_CLIENT_SECRET;
    process.env.AVIATION_STACK_API_KEY = 'aviationstack-key';
    delete process.env.MONGODB_URI;

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes('aviationstack.com/v1/flights')) {
        return new Response(JSON.stringify({
          pagination: { count: 1, total: 1, offset: 0, limit: 100 },
          data: [
            {
              flight_status: 'active',
              departure: {
                airport: 'Paris Charles de Gaulle Airport',
                iata: 'CDG',
                icao: 'LFPG',
                scheduled: '2026-04-04T08:15:00+00:00',
              },
              arrival: {
                airport: 'John F. Kennedy International Airport',
                iata: 'JFK',
                icao: 'KJFK',
                scheduled: '2026-04-04T14:20:00+00:00',
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
        });
      }

      throw new Error(`Unexpected fetch URL in test: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    const searchFlights = await loadSearchFlights();
    const result = await searchFlights('AF123');

    expect(result.flights).toHaveLength(1);
    expect(result.flights[0]?.dataSource).toBe('aviationstack');
    expect(result.flights[0]?.sourceDetails).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'opensky',
          usedInResult: false,
          reason: expect.stringContaining('OPENSKY_DISABLED'),
        }),
        expect.objectContaining({
          source: 'aviationstack',
          status: 'used',
          usedInResult: true,
        }),
      ]),
    );
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('opensky-network.org'))).toBe(false);
  });

  it('prefers the scheduled future FlightAware record when validation passes a future departure reference time', async () => {
    process.env.FLIGHT_AWARE_API_KEY = 'flightaware-key';
    delete process.env.FLIGHTAWARE_API_KEY;
    delete process.env.AVIATION_STACK_API_KEY;
    delete process.env.MONGODB_URI;

    const now = Math.floor(Date.now() / 1000);
    const futureDeparture = new Date((now + (48 * 60 * 60)) * 1000).toISOString();
    const futureArrival = new Date((now + (54 * 60 * 60)) * 1000).toISOString();
    const liveDeparture = new Date((now - (2 * 60 * 60)) * 1000).toISOString();
    const livePosition = new Date((now - 120) * 1000).toISOString();

    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      links: {},
      num_pages: 1,
      flights: [
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
      ],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    vi.stubGlobal('fetch', fetchMock);

    const { lookupFlightAwareFlightWithReport } = await loadFlightAwareProvider();
    const result = await lookupFlightAwareFlightWithReport('ETH575', {
      referenceTimeMs: Date.parse(futureDeparture),
    });

    expect(result.match?.faFlightId).toBe('ETH575-future');
    expect(result.match?.current).toBeNull();
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

  it('reuses a single FlightAware AeroAPI request for identical concurrent lookups', async () => {
    process.env.FLIGHT_AWARE_API_KEY = 'flightaware-key';
    delete process.env.FLIGHTAWARE_API_KEY;
    delete process.env.AVIATION_STACK_API_KEY;
    delete process.env.MONGODB_URI;

    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({
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
          },
          destination: {
            code: 'KJFK',
            code_icao: 'KJFK',
            code_iata: 'JFK',
            name: 'John F. Kennedy International Airport',
          },
          scheduled_out: '2026-04-04T08:15:00Z',
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

    const { lookupFlightAwareFlightWithReport } = await loadFlightAwareProvider();
    const [first, second] = await Promise.all([
      lookupFlightAwareFlightWithReport('AF123'),
      lookupFlightAwareFlightWithReport('AF123'),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first.match?.callsign).toBe('AFR123');
    expect(second.match?.callsign).toBe('AFR123');
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
        departureAirport: 'CDG',
        arrivalAirport: 'JFK',
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
