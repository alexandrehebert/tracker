import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FlightTrackerClient from '~/components/tracker/flight/FlightTrackerClient';
import type { WorldMapPayload } from '~/lib/server/worldMap';

vi.mock('~/components/tracker/TrackerZoomControls', () => ({
  default: function MockTrackerZoomControls() {
    return <div data-testid="zoom-controls" />;
  },
}));

const mockFlightMap2D = vi.fn((_props: unknown) => <div data-testid="flight-map" />);

vi.mock('~/components/tracker/flight/FlightMap2D', () => ({
  default: function MockFlightMap2D(props: unknown) {
    return mockFlightMap2D(props);
  },
}));

const map: WorldMapPayload = {
  countries: [],
  viewBox: { width: 1000, height: 560 },
  projection: { scale: 160, translate: [500, 280] },
};

const responsePayload = {
  query: 'AFR12',
  requestedIdentifiers: ['AFR12'],
  matchedIdentifiers: ['AFR12'],
  notFoundIdentifiers: [],
  fetchedAt: Date.now(),
  flights: [
    {
      icao24: '3c675a',
      callsign: 'AFR12',
      originCountry: 'France',
      matchedBy: ['callsign'],
      lastContact: Math.round(Date.now() / 1000) - 30,
      current: {
        time: null,
        latitude: 48.8,
        longitude: 2.3,
        x: 0,
        y: 0,
        altitude: 10000,
        heading: 180,
        onGround: false,
      },
      originPoint: null,
      track: [
        {
          time: Math.round(Date.now() / 1000) - 180,
          latitude: 48.2,
          longitude: 1.8,
          x: 0,
          y: 0,
          altitude: 8200,
          heading: 180,
          onGround: false,
        },
        {
          time: Math.round(Date.now() / 1000) - 120,
          latitude: 48.4,
          longitude: 1.95,
          x: 0,
          y: 0,
          altitude: 9100,
          heading: 180,
          onGround: false,
        },
        {
          time: Math.round(Date.now() / 1000) - 60,
          latitude: 48.6,
          longitude: 2.1,
          x: 0,
          y: 0,
          altitude: 10000,
          heading: 180,
          onGround: false,
        },
      ],
      onGround: false,
      velocity: 230,
      heading: 180,
      verticalRate: 0,
      geoAltitude: 10000,
      baroAltitude: 10050,
      squawk: null,
      category: null,
      route: {
        departureAirport: 'CDG',
        arrivalAirport: 'JFK',
        firstSeen: null,
        lastSeen: null,
      },
      dataSource: 'hybrid',
      sourceDetails: [
        {
          source: 'opensky',
          status: 'used',
          usedInResult: true,
          reason: 'OpenSky matched this flight from live state vectors and recent route history.',
          raw: {
            route: {
              departureAirport: 'CDG',
              arrivalAirport: 'JFK',
            },
          },
        },
        {
          source: 'aviationstack',
          status: 'used',
          usedInResult: true,
          reason: 'Aviationstack returned a matching flight and its data was merged into this snapshot.',
          raw: {
            flightNumber: '12',
            airline: 'Air France',
          },
        },
        {
          source: 'flightaware',
          status: 'used',
          usedInResult: true,
          reason: 'FlightAware AeroAPI returned a matching flight and its data was merged into this snapshot.',
          raw: {
            flightNumber: '12',
            registration: 'F-GZNN',
          },
        },
      ],
    },
  ],
};

const detailsPayload = {
  icao24: '3c675a',
  callsign: 'AFR12',
  fetchedAt: Date.now(),
  route: {
    departureAirport: 'CDG',
    arrivalAirport: 'JFK',
    firstSeen: 1_700_000_000,
    lastSeen: 1_700_002_400,
  },
  departureAirport: {
    code: 'CDG',
    iata: 'CDG',
    icao: 'LFPG',
    name: 'Paris Charles de Gaulle Airport',
    city: 'Paris',
    country: 'France',
    latitude: 49.0097,
    longitude: 2.5479,
  },
  arrivalAirport: {
    code: 'JFK',
    iata: 'JFK',
    icao: 'KJFK',
    name: 'John F. Kennedy International Airport',
    city: 'New York',
    country: 'United States',
    latitude: 40.6413,
    longitude: -73.7781,
  },
  dataSource: 'hybrid',
  sourceDetails: [
    {
      source: 'opensky',
      status: 'used',
      usedInResult: true,
      reason: 'OpenSky route history was used to populate the selected-flight details.',
      raw: {
        route: {
          departureAirport: 'CDG',
          arrivalAirport: 'JFK',
        },
      },
    },
    {
      source: 'aviationstack',
      status: 'used',
      usedInResult: true,
      reason: 'Aviationstack returned a matching flight and its data was merged into this snapshot.',
      raw: {
        flightNumber: '12',
        airline: 'Air France',
      },
    },
    {
      source: 'flightaware',
      status: 'used',
      usedInResult: true,
      reason: 'FlightAware AeroAPI returned a matching flight and its data was merged into this snapshot.',
      raw: {
        flightNumber: '12',
        registration: 'F-GZNN',
      },
    },
  ],
};

describe('FlightTrackerClient', () => {
  beforeEach(() => {
    mockFlightMap2D.mockClear();

    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation(() => ({
        matches: false,
        media: '(max-width: 1023px)',
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );

    vi.spyOn(window, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const payload = url.startsWith('/api/tracker/details') ? detailsPayload : responsePayload;

      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    window.history.replaceState({}, '', '/en/tracker');
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('loads tracked flights from the URL query', async () => {
    window.history.replaceState({}, '', '/en/tracker?q=AFR12%2CDAL220');

    render(<FlightTrackerClient map={map} />);

    expect(await screen.findByText(/selected flight/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/flight identifiers/i)).toHaveValue('AFR12,DAL220');
    expect(window.fetch).toHaveBeenCalledWith('/api/tracker?q=AFR12%2CDAL220', { cache: 'no-store' });
  });

  it('does not refetch in a loop after loading the initial query from the URL', async () => {
    const fetchMock = vi.spyOn(window, 'fetch');
    window.history.replaceState({}, '', '/en/tracker?q=AFR12');

    render(<FlightTrackerClient map={map} />);

    expect(await screen.findByText(/selected flight/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  it('keeps the earliest known origin point when refresh reconciliation receives a later partial track', async () => {
    const user = userEvent.setup();
    const baseTime = 1_700_100_000;
    const initialTrack = Array.from({ length: 120 }, (_, index) => ({
      time: baseTime + index * 60,
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
        time: baseTime + (120 + index) * 60,
        latitude: 43.1742 + index * 0.01,
        longitude: -57.9073 + index * 0.25,
        x: 240 + index,
        y: 150 - index * 0.25,
        altitude: 7_200 + index * 20,
        heading: 105,
        onGround: false,
      })),
    ];

    const initialPayload = {
      ...responsePayload,
      fetchedAt: baseTime * 1000,
      flights: [
        {
          ...responsePayload.flights[0],
          lastContact: initialTrack.at(-1)?.time ?? null,
          current: initialTrack.at(-1)!,
          originPoint: initialTrack[0]!,
          track: initialTrack,
        },
      ],
    };
    const refreshedPayload = {
      ...responsePayload,
      fetchedAt: (baseTime + 7_200) * 1000,
      flights: [
        {
          ...responsePayload.flights[0],
          lastContact: refreshedTrack.at(-1)?.time ?? null,
          current: refreshedTrack.at(-1)!,
          originPoint: refreshedTrack[0]!,
          track: refreshedTrack,
        },
      ],
    };

    const fetchMock = vi.spyOn(window, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const payload = url.startsWith('/api/tracker/details')
        ? detailsPayload
        : (url.includes('refresh=1') ? refreshedPayload : initialPayload);

      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    window.history.replaceState({}, '', '/en/tracker?q=AFR12');
    render(<FlightTrackerClient map={map} />);

    expect(await screen.findByText(/selected flight/i)).toBeInTheDocument();

    await waitFor(() => {
      const latestCall = mockFlightMap2D.mock.calls.at(-1);
      const latestProps = latestCall?.[0] as { flights?: Array<{ originPoint?: { time: number | null }; track?: Array<{ time: number | null }> }> } | undefined;
      expect(latestProps?.flights?.[0]?.originPoint?.time).toBe(initialTrack[0]?.time ?? null);
      expect(latestProps?.flights?.[0]?.track?.[0]?.time).toBe(initialTrack[0]?.time ?? null);
    });

    await user.click(screen.getByRole('button', { name: /^refresh$/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/tracker?q=AFR12&refresh=1', { cache: 'no-store' });
    });

    await waitFor(() => {
      const latestCall = mockFlightMap2D.mock.calls.at(-1);
      const latestProps = latestCall?.[0] as { flights?: Array<{ originPoint?: { time: number | null }; track?: Array<{ time: number | null }> }> } | undefined;
      expect(latestProps?.flights?.[0]?.originPoint?.time).toBe(initialTrack[0]?.time ?? null);
      expect(latestProps?.flights?.[0]?.track?.[0]?.time).toBe(initialTrack[0]?.time ?? null);
    });
  });

  it('forces a cache-busting refresh and shows the fetch history modal', async () => {
    const user = userEvent.setup();
    const initialPayload = {
      ...responsePayload,
      fetchedAt: 1_700_000_000_000,
      flights: [
        {
          ...responsePayload.flights[0],
          lastContact: 1_700_000_000,
          velocity: 230,
          geoAltitude: 10_000,
          flightNumber: '12',
          airline: {
            name: 'Air France',
            iata: 'AF',
            icao: 'AFR',
          },
          aircraft: {
            registration: 'F-GZNN',
            iata: 'B77W',
            icao: 'B77W',
            icao24: '3C675A',
            model: 'B77W',
          },
          dataSource: 'hybrid' as const,
        },
      ],
    };
    const refreshedPayload = {
      ...initialPayload,
      fetchedAt: 1_700_000_060_000,
      flights: [
        {
          ...initialPayload.flights[0],
          lastContact: 1_700_000_060,
          velocity: 245,
          geoAltitude: 10_850,
          route: {
            departureAirport: null,
            arrivalAirport: 'JFK',
            firstSeen: null,
            lastSeen: null,
          },
          flightNumber: null,
          airline: null,
          aircraft: null,
        },
      ],
    };
    const refreshedDetailsPayload = {
      ...detailsPayload,
      fetchedAt: 1_700_000_060_000,
      dataSource: 'hybrid' as const,
      airline: {
        name: 'Air France',
        iata: 'AF',
        icao: 'AFR',
      },
      aircraft: {
        registration: 'F-GZNN',
        iata: 'B77W',
        icao: 'B77W',
        icao24: '3C675A',
        model: 'B77W',
      },
    };

    const fetchMock = vi.spyOn(window, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      if (url.startsWith('/api/tracker/details')) {
        return new Response(JSON.stringify(refreshedDetailsPayload), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const payload = url.includes('refresh=1') ? refreshedPayload : initialPayload;
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    render(<FlightTrackerClient map={map} />);

    await user.type(screen.getByLabelText(/flight identifiers/i), 'AFR12');
    await user.click(screen.getByRole('button', { name: /track flights/i }));

    expect(await screen.findByText('Air France')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /refresh/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/tracker?q=AFR12&refresh=1', { cache: 'no-store' });
    });

    await waitFor(() => {
      expect(screen.getAllByText('10,850 m').length).toBeGreaterThan(0);
    });
    expect(screen.getByText('Air France')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /view fetch history/i }));

    const dialog = await screen.findByRole('dialog', { name: /flight fetch history/i });
    expect(within(dialog).getByText(/manual refresh/i)).toBeInTheDocument();
    expect(within(dialog).getAllByText(/^OpenSky$/i).length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText(/^Aviationstack$/i).length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText(/^FlightAware$/i).length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText(/OpenSky matched this flight from live state vectors/i).length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText(/Aviationstack returned a matching flight and its data was merged/i).length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText(/FlightAware AeroAPI returned a matching flight and its data was merged/i).length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText(/used in the reconciled snapshot/i).length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText(/^Altitude$/i).length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText(/10,850 m/i).length).toBeGreaterThan(0);
  });

  it('folds unchanged fetch-history snapshots when a provider remains skipped', async () => {
    const user = userEvent.setup();
    const initialPayload = {
      ...responsePayload,
      fetchedAt: 1_700_000_000_000,
      flights: [
        {
          ...responsePayload.flights[0],
          sourceDetails: [
            {
              source: 'opensky' as const,
              status: 'used' as const,
              usedInResult: true,
              reason: 'OpenSky matched this flight from live state vectors and recent route history.',
              raw: { source: 'opensky' },
            },
          ],
        },
      ],
    };
    const refreshedPayload = {
      ...initialPayload,
      fetchedAt: 1_700_000_060_000,
      flights: [
        {
          ...initialPayload.flights[0],
          sourceDetails: [
            ...initialPayload.flights[0].sourceDetails,
            {
              source: 'flightaware' as const,
              status: 'skipped' as const,
              usedInResult: false,
              reason: 'FlightAware returned no usable match for this snapshot.',
              raw: null,
            },
          ],
        },
      ],
    };

    vi.spyOn(window, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const payload = url.includes('refresh=1') ? refreshedPayload : initialPayload;

      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    render(<FlightTrackerClient map={map} />);

    await user.type(screen.getByLabelText(/flight identifiers/i), 'AFR12');
    await user.click(screen.getByRole('button', { name: /track flights/i }));
    expect(await screen.findByText(/selected flight/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /refresh/i }));
    await user.click(await screen.findByRole('button', { name: /view fetch history/i }));

    const dialog = await screen.findByRole('dialog', { name: /flight fetch history/i });
    expect(within(dialog).getByText(/No material change detected/i)).toBeInTheDocument();
    expect(within(dialog).queryByText(/Skipped → Skipped/i)).not.toBeInTheDocument();
  });

  it('does not add a second search snapshot when details only refine metadata', async () => {
    const user = userEvent.setup();
    const searchFetchedAt = 1_700_000_000_000;
    const detailsFetchedAt = searchFetchedAt + 3_000;
    const searchPayload = {
      ...responsePayload,
      fetchedAt: searchFetchedAt,
      flights: [
        {
          ...responsePayload.flights[0],
          lastContact: Math.round(searchFetchedAt / 1000) - 30,
          route: {
            departureAirport: 'CDG',
            arrivalAirport: 'JFK',
            firstSeen: null,
            lastSeen: null,
          },
        },
      ],
    };
    const refinedDetailsPayload = {
      ...detailsPayload,
      fetchedAt: detailsFetchedAt,
      route: {
        departureAirport: 'CDG',
        arrivalAirport: 'JFK',
        firstSeen: 1_700_000_000,
        lastSeen: 1_700_002_400,
      },
    };
    const fetchMock = vi.spyOn(window, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const payload = url.startsWith('/api/tracker/details') ? refinedDetailsPayload : searchPayload;

      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    render(<FlightTrackerClient map={map} />);

    await user.type(screen.getByLabelText(/flight identifiers/i), 'AFR12');
    await user.click(screen.getByRole('button', { name: /track flights/i }));

    expect(await screen.findByText(/selected flight/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    expect(screen.getByText(/1 cached snapshot shared across refreshes/i)).toBeInTheDocument();
  });

  it('keeps shared cached fetch history returned by the API', async () => {
    const user = userEvent.setup();
    const cachedFetchedAt = 1_700_000_000_000;
    const cachedSearchPayload = {
      ...responsePayload,
      fetchedAt: cachedFetchedAt,
      flights: [
        {
          ...responsePayload.flights[0],
          lastContact: 1_700_000_000,
          fetchHistory: [
            {
              id: '3c675a:search:1699999940000',
              capturedAt: 1_699_999_940_000,
              trigger: 'search' as const,
              dataSource: 'hybrid' as const,
              matchedBy: ['callsign'],
              route: {
                departureAirport: 'CDG',
                arrivalAirport: 'JFK',
                firstSeen: null,
                lastSeen: null,
              },
              current: null,
              onGround: false,
              lastContact: 1_699_999_940,
              velocity: 220,
              heading: 180,
              geoAltitude: 9600,
              baroAltitude: 9650,
              sourceDetails: responsePayload.flights[0].sourceDetails,
            },
            {
              id: `3c675a:search:${cachedFetchedAt}`,
              capturedAt: cachedFetchedAt,
              trigger: 'search' as const,
              dataSource: 'hybrid' as const,
              matchedBy: ['callsign'],
              route: {
                departureAirport: 'CDG',
                arrivalAirport: 'JFK',
                firstSeen: null,
                lastSeen: null,
              },
              current: null,
              onGround: false,
              lastContact: 1_700_000_000,
              velocity: 230,
              heading: 180,
              geoAltitude: 10000,
              baroAltitude: 10050,
              sourceDetails: responsePayload.flights[0].sourceDetails,
            },
          ],
        },
      ],
    };
    const cachedDetailsPayload = {
      ...detailsPayload,
      fetchedAt: cachedFetchedAt,
    };

    vi.spyOn(window, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const payload = url.startsWith('/api/tracker/details') ? cachedDetailsPayload : cachedSearchPayload;

      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    render(<FlightTrackerClient map={map} />);

    await user.type(screen.getByLabelText(/flight identifiers/i), 'AFR12');
    await user.click(screen.getByRole('button', { name: /track flights/i }));

    expect(await screen.findByText(/selected flight/i)).toBeInTheDocument();
    expect(await screen.findByText(/2 cached snapshots shared across refreshes/i)).toBeInTheDocument();
  });
});
