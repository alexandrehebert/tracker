import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

async function loadAeroDataBoxProvider() {
  vi.resetModules();
  return await import('~/lib/server/providers/aerodatabox');
}

describe('lookupAeroDataBoxFlightWithReport', () => {
  const originalRapidApiKey = process.env.AERODATABOX_RAPIDAPI_KEY;
  const originalDisabled = process.env.AERODATABOX_DISABLED;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.AERODATABOX_RAPIDAPI_KEY = 'rapid-key';
    delete process.env.AERODATABOX_DISABLED;
  });

  afterEach(() => {
    if (originalRapidApiKey === undefined) {
      delete process.env.AERODATABOX_RAPIDAPI_KEY;
    } else {
      process.env.AERODATABOX_RAPIDAPI_KEY = originalRapidApiKey;
    }

    if (originalDisabled === undefined) {
      delete process.env.AERODATABOX_DISABLED;
    } else {
      process.env.AERODATABOX_DISABLED = originalDisabled;
    }
  });

  it('queries AeroDataBox by flight number on the requested day and returns the best match', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([
      {
        number: 'AF123',
        callSign: 'AFR123',
        status: 'Expected',
        departure: {
          airport: {
            iata: 'CDG',
            icao: 'LFPG',
            shortName: 'Paris CDG',
            municipalityName: 'Paris',
          },
          scheduledTime: {
            utc: '2026-04-14T09:35:00.000Z',
            local: '2026-04-14T11:35:00.000+02:00',
          },
        },
        arrival: {
          airport: {
            iata: 'AMS',
            icao: 'EHAM',
            shortName: 'Amsterdam Schiphol',
            municipalityName: 'Amsterdam',
          },
          scheduledTime: {
            utc: '2026-04-14T11:10:00.000Z',
            local: '2026-04-14T13:10:00.000+02:00',
          },
        },
        aircraft: {
          reg: 'D-AIAB',
          modeS: '3C675A',
          model: 'Airbus A320-200',
        },
        airline: {
          name: 'Air France',
          iata: 'AF',
          icao: 'AFR',
        },
      },
    ]), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    vi.stubGlobal('fetch', fetchMock);

    const { lookupAeroDataBoxFlightWithReport } = await loadAeroDataBoxProvider();
    const result = await lookupAeroDataBoxFlightWithReport('AF123', {
      referenceTimeMs: Date.parse('2026-04-14T09:30:00.000Z'),
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit | undefined];
    expect(String(url)).toContain('/flights/Number/AF123/2026-04-14');
    expect(String(url)).toContain('dateLocalRole=Both');
    expect(init).toEqual(expect.objectContaining({
      headers: expect.objectContaining({
        'X-RapidAPI-Key': 'rapid-key',
        'X-RapidAPI-Host': 'aerodatabox.p.rapidapi.com',
      }),
    }));

    expect(result.match?.aircraft.icao24).toBe('3C675A');
    expect(result.match?.route.departureAirport).toBe('CDG');
    expect(result.match?.route.arrivalAirport).toBe('AMS');
    expect(result.report.source).toBe('aerodatabox');
    expect(result.report.status).toBe('used');
  });

  it('does not reuse a cached AeroDataBox result for a different requested day', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes('/2026-04-14')) {
        return new Response(JSON.stringify([
          {
            number: 'AF123',
            callSign: 'AFR123',
            status: 'Expected',
            departure: {
              airport: { iata: 'CDG', icao: 'LFPG' },
              scheduledTime: { utc: '2026-04-14T09:35:00.000Z' },
            },
            arrival: {
              airport: { iata: 'AMS', icao: 'EHAM' },
              scheduledTime: { utc: '2026-04-14T11:10:00.000Z' },
            },
            aircraft: { modeS: '3C675A' },
            airline: { iata: 'AF', icao: 'AFR' },
          },
        ]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.includes('/2026-04-16')) {
        return new Response(JSON.stringify([
          {
            number: 'AF123',
            callSign: 'AFR123',
            status: 'Expected',
            departure: {
              airport: { iata: 'CDG', icao: 'LFPG' },
              scheduledTime: { utc: '2026-04-16T09:35:00.000Z' },
            },
            arrival: {
              airport: { iata: 'AMS', icao: 'EHAM' },
              scheduledTime: { utc: '2026-04-16T11:10:00.000Z' },
            },
            aircraft: { modeS: '3C675A' },
            airline: { iata: 'AF', icao: 'AFR' },
          },
        ]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      throw new Error(`Unexpected AeroDataBox test URL: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    const { lookupAeroDataBoxFlightWithReport } = await loadAeroDataBoxProvider();

    await lookupAeroDataBoxFlightWithReport('AF123', {
      referenceTimeMs: Date.parse('2026-04-14T09:30:00.000Z'),
    });
    const result = await lookupAeroDataBoxFlightWithReport('AF123', {
      referenceTimeMs: Date.parse('2026-04-16T09:30:00.000Z'),
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.match?.route.firstSeen).toBe(Math.floor(Date.parse('2026-04-16T09:35:00.000Z') / 1000));
  });
});
