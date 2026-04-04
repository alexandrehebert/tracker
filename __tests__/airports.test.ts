import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

async function loadAirportHelpers() {
  vi.resetModules();
  return import('~/lib/server/airports');
}

describe('airport directory helpers', () => {
  const originalMongoDbUri = process.env.MONGODB_URI;

  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.MONGODB_URI;
  });

  afterEach(() => {
    if (originalMongoDbUri === undefined) {
      delete process.env.MONGODB_URI;
    } else {
      process.env.MONGODB_URI = originalMongoDbUri;
    }

    vi.unstubAllGlobals();
    vi.doUnmock('mongodb');
  });

  it('deduplicates airports that appear under both ICAO and IATA keys', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        LFPG: {
          icao: 'LFPG',
          iata: 'CDG',
          name: 'Paris Charles de Gaulle',
          city: 'Paris',
          country: 'France',
          lat: 49.0097,
          lon: 2.5479,
          tz: 'Europe/Paris',
        },
        CDG: {
          icao: 'LFPG',
          iata: 'CDG',
          name: 'Paris Charles de Gaulle',
          city: 'Paris',
          country: 'France',
          lat: 49.0097,
          lon: 2.5479,
          tz: 'Europe/Paris',
        },
        EGLL: {
          icao: 'EGLL',
          iata: 'LHR',
          name: 'Heathrow',
          city: 'London',
          country: 'United Kingdom',
          lat: 51.47,
          lon: -0.4543,
          tz: 'Europe/London',
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ));

    const { listAirportDetails } = await loadAirportHelpers();
    const airports = await listAirportDetails();

    expect(airports).toHaveLength(2);
    expect(airports.map((airport) => airport.code)).toEqual(['LHR', 'CDG']);
    expect(airports[0]).toMatchObject({
      name: 'Heathrow',
      city: 'London',
      country: 'United Kingdom',
    });
  });

  it('restores the airport directory from MongoDB cache when the remote source is unavailable', async () => {
    process.env.MONGODB_URI = 'mongodb://cache-host:27017/tracker';

    const createIndexMock = vi.fn().mockResolvedValue('index-ready');
    const findOneMock = vi.fn().mockResolvedValue({
      _id: 'airport-directory:v1',
      payload: [
        {
          code: 'LHR',
          iata: 'LHR',
          icao: 'EGLL',
          name: 'Heathrow Airport',
          city: 'London',
          country: 'United Kingdom',
          latitude: 51.47,
          longitude: -0.4543,
          timezone: 'Europe/London',
        },
      ],
      expiresAt: new Date(Date.now() + 60_000),
      updatedAt: new Date(),
    });

    vi.doMock('mongodb', () => ({
      MongoClient: class {
        connect() {
          return Promise.resolve(this);
        }

        db() {
          return {
            collection() {
              return {
                createIndex: createIndexMock,
                findOne: findOneMock,
                updateOne: vi.fn().mockResolvedValue({ acknowledged: true }),
              };
            },
          };
        }
      },
    }));

    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
    vi.stubGlobal('fetch', fetchMock);

    const { listAirportDetails, lookupAirportDetails } = await loadAirportHelpers();
    const airports = await listAirportDetails();
    const airport = await lookupAirportDetails('EGLL');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(findOneMock).toHaveBeenCalledTimes(1);
    expect(airports).toHaveLength(1);
    expect(airport).toMatchObject({
      code: 'LHR',
      icao: 'EGLL',
      name: 'Heathrow Airport',
    });
  });

  it('returns a stable fallback airport for unknown codes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    const { lookupAirportDetails } = await loadAirportHelpers();
    const airport = await lookupAirportDetails('kjfk');

    expect(airport).toMatchObject({
      code: 'KJFK',
      iata: null,
      icao: 'KJFK',
      latitude: null,
      longitude: null,
    });
  });
});
