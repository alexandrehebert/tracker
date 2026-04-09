import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

async function loadAviationstackProvider() {
  vi.resetModules();
  return await import('~/lib/server/providers/aviationstack');
}

describe('lookupAviationstackFlightWithReport', () => {
  const originalApiKey = process.env.AVIATION_STACK_API_KEY;
  const originalDisabled = process.env.AVIATIONSTACK_DISABLED;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.AVIATION_STACK_API_KEY = 'aviationstack-key';
    delete process.env.AVIATIONSTACK_DISABLED;
  });

  afterEach(() => {
    if (originalApiKey === undefined) {
      delete process.env.AVIATION_STACK_API_KEY;
    } else {
      process.env.AVIATION_STACK_API_KEY = originalApiKey;
    }

    if (originalDisabled === undefined) {
      delete process.env.AVIATIONSTACK_DISABLED;
    } else {
      process.env.AVIATIONSTACK_DISABLED = originalDisabled;
    }
  });

  it('prefers the future scheduled Aviationstack record when validation provides a reference time', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      data: [
        {
          flight_status: 'active',
          departure: {
            iata: 'CDG',
            icao: 'LFPG',
            scheduled: '2026-04-08T13:25:00.000Z',
            actual: '2026-04-08T13:42:00.000Z',
          },
          arrival: {
            iata: 'PVG',
            icao: 'ZSPD',
            scheduled: '2026-04-08T22:47:00.000Z',
          },
          airline: {
            name: 'China Eastern Airlines',
            iata: 'MU',
            icao: 'CES',
          },
          flight: {
            number: '554',
            iata: 'MU554',
            icao: 'CES554',
          },
          aircraft: {
            icao24: '780F3C',
          },
          live: {
            updated: '2026-04-08T14:00:00.000Z',
            latitude: 50.11,
            longitude: 8.68,
            altitude: 10600,
            direction: 84,
            speed_horizontal: 860,
            is_ground: false,
          },
        },
        {
          flight_status: 'scheduled',
          departure: {
            iata: 'CDG',
            icao: 'LFPG',
            scheduled: '2026-04-14T13:25:00.000Z',
          },
          arrival: {
            iata: 'PVG',
            icao: 'ZSPD',
            scheduled: '2026-04-14T22:47:00.000Z',
          },
          airline: {
            name: 'China Eastern Airlines',
            iata: 'MU',
            icao: 'CES',
          },
          flight: {
            number: '554',
            iata: 'MU554',
            icao: 'CES554',
          },
          aircraft: {
            icao24: null,
          },
          live: null,
        },
      ],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    vi.stubGlobal('fetch', fetchMock);

    const { lookupAviationstackFlightWithReport } = await loadAviationstackProvider();
    const result = await lookupAviationstackFlightWithReport('MU554', {
      referenceTimeMs: Date.parse('2026-04-14T13:25:00.000Z'),
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.match?.route.departureAirport).toBe('CDG');
    expect(result.match?.route.arrivalAirport).toBe('PVG');
    expect(result.match?.route.firstSeen).toBe(Math.floor(Date.parse('2026-04-14T13:25:00.000Z') / 1000));
    expect(result.report.status).toBe('used');
  });
});
