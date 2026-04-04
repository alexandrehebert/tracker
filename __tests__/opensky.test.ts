import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

async function loadSearchFlights() {
  vi.resetModules();
  return (await import('~/lib/server/opensky')).searchFlights;
}

async function loadFlightSelectionDetails() {
  vi.resetModules();
  return (await import('~/lib/server/opensky')).getFlightSelectionDetails;
}

describe('searchFlights', () => {
  const originalClientId = process.env.OPENSKY_CLIENT_ID;
  const originalClientSecret = process.env.OPENSKY_CLIENT_SECRET;
  const originalMongoDbUri = process.env.MONGODB_URI;
  const originalCacheTtl = process.env.OPENSKY_CACHE_TTL_SECONDS;

  beforeEach(() => {
    vi.restoreAllMocks();
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

  it('fails fast when the OpenSky env vars are missing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const searchFlights = await loadSearchFlights();

    await expect(searchFlights('AF123')).rejects.toThrow(
      'Missing OpenSky client credentials. Set OPENSKY_CLIENT_ID and OPENSKY_CLIENT_SECRET in your environment.',
    );

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reuses cached flight search results for up to the configured ttl', async () => {
    process.env.OPENSKY_CLIENT_ID = 'client-from-env';
    process.env.OPENSKY_CLIENT_SECRET = 'secret-from-env';
    process.env.OPENSKY_CACHE_TTL_SECONDS = '300';
    delete process.env.MONGODB_URI;

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

  it('caches selected-flight airport detail lookups for repeated selections', async () => {
    process.env.OPENSKY_CLIENT_ID = 'client-from-env';
    process.env.OPENSKY_CLIENT_SECRET = 'secret-from-env';
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
