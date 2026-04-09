import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

async function loadAirlabsProvider() {
  vi.resetModules();
  return await import('~/lib/server/providers/airlabs');
}

describe('lookupAirlabsFlightWithReport', () => {
  const originalApiKey = process.env.AIRLABS_API_KEY;
  const originalDisabled = process.env.AIRLABS_DISABLED;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.AIRLABS_API_KEY = 'airlabs-key';
    delete process.env.AIRLABS_DISABLED;
  });

  afterEach(() => {
    if (originalApiKey === undefined) {
      delete process.env.AIRLABS_API_KEY;
    } else {
      process.env.AIRLABS_API_KEY = originalApiKey;
    }

    if (originalDisabled === undefined) {
      delete process.env.AIRLABS_DISABLED;
    } else {
      process.env.AIRLABS_DISABLED = originalDisabled;
    }
  });

  it('queries AirLabs for a flight identifier and returns the parsed match', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
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
        dep_time_ts: 1775852100,
        dep_estimated_ts: 1775852400,
        arr_iata: 'AMS',
        arr_icao: 'EHAM',
        arr_time_ts: 1775857800,
        updated: 1775853000,
        lat: 49.0123,
        lng: 2.5512,
        alt: 10900,
        dir: 32,
        speed: 820,
        status: 'en-route',
        model: 'Airbus A320-200',
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    vi.stubGlobal('fetch', fetchMock);

    const { lookupAirlabsFlightWithReport } = await loadAirlabsProvider();
    const result = await lookupAirlabsFlightWithReport('AF123', {
      referenceTimeMs: Date.parse('2026-04-09T09:35:00.000Z'),
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit | undefined];
    expect(String(url)).toContain('flight_iata=AF123');
    expect(String(url)).toContain('api_key=airlabs-key');

    expect(result.match?.aircraft.icao24).toBe('3C675A');
    expect(result.match?.route.departureAirport).toBe('CDG');
    expect(result.match?.route.arrivalAirport).toBe('AMS');
    expect(result.match?.flightNumber).toBe('123');
    expect(result.report.source).toBe('airlabs');
    expect(result.report.status).toBe('used');
  });

  it('ignores stale AirLabs live matches when the requested departure is several days later', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      response: {
        hex: '780F3C',
        reg_number: 'B-7368',
        aircraft_icao: 'A333',
        airline_iata: 'MU',
        airline_icao: 'CES',
        airline_name: 'China Eastern Airlines',
        flight_number: '554',
        flight_icao: 'CES554',
        flight_iata: 'MU554',
        dep_iata: 'CDG',
        dep_icao: 'LFPG',
        dep_time_ts: 1775664300,
        dep_estimated_ts: 1775664300,
        arr_iata: 'PVG',
        arr_icao: 'ZSPD',
        arr_time_ts: 1775707620,
        updated: 1775673000,
        lat: 50.11,
        lng: 8.68,
        alt: 10600,
        dir: 84,
        speed: 860,
        status: 'en-route',
        model: 'Airbus A330-300',
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    vi.stubGlobal('fetch', fetchMock);

    const { lookupAirlabsFlightWithReport } = await loadAirlabsProvider();
    const result = await lookupAirlabsFlightWithReport('MU554', {
      referenceTimeMs: Date.parse('2026-04-14T13:25:00.000Z'),
    });

    expect(result.match).toBeNull();
    expect(result.report.source).toBe('airlabs');
    expect(result.report.status).toBe('no-data');
    expect(result.report.reason).toMatch(/requested schedule/i);
  });

  it('checks the AirLabs schedules endpoint first for future validation lookups', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      response: [
        {
          airline_iata: 'MU',
          airline_icao: 'CES',
          airline_name: 'China Eastern Airlines',
          flight_number: '554',
          flight_icao: 'CES554',
          flight_iata: 'MU554',
          dep_iata: 'CDG',
          dep_icao: 'LFPG',
          dep_time_ts: 1776169500,
          dep_estimated_ts: 1776169500,
          arr_iata: 'PVG',
          arr_icao: 'ZSPD',
          arr_time_ts: 1776214500,
          arr_estimated_ts: 1776214500,
          status: 'scheduled',
        },
      ],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    vi.stubGlobal('fetch', fetchMock);

    const { lookupAirlabsFlightWithReport } = await loadAirlabsProvider();
    const result = await lookupAirlabsFlightWithReport('MU554', {
      referenceTimeMs: Date.parse('2026-04-14T13:25:00.000Z'),
    });

    expect(fetchMock).toHaveBeenCalled();
    const [url] = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit | undefined];
    expect(String(url)).toContain('/schedules?');
    expect(String(url)).toContain('flight_iata=MU554');
    expect(result.match?.route.departureAirport).toBe('CDG');
    expect(result.match?.route.arrivalAirport).toBe('PVG');
  });
});
