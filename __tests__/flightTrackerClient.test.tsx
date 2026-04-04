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

vi.mock('~/components/tracker/flight/FlightMap2D', () => ({
  default: function MockFlightMap2D() {
    return <div data-testid="flight-map" />;
  },
}));

const map: WorldMapPayload = {
  countries: [],
  viewBox: { width: 1000, height: 560 },
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
};

describe('FlightTrackerClient', () => {
  beforeEach(() => {
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
    expect(within(dialog).getAllByText(/^Altitude$/i).length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText(/10,850 m/i).length).toBeGreaterThan(0);
  });

  it('clears tracked flights when the search field is emptied', async () => {
    const user = userEvent.setup();

    render(<FlightTrackerClient map={map} />);

    const input = screen.getByLabelText(/flight identifiers/i);
    await user.type(input, 'AFR12');
    await user.click(screen.getByRole('button', { name: /track flights/i }));

    expect(await screen.findByText(/selected flight/i)).toBeInTheDocument();

    await user.clear(input);

    await waitFor(() => {
      expect(screen.queryByText(/selected flight/i)).not.toBeInTheDocument();
    });
    expect(screen.getByText(/no live flights yet/i)).toBeInTheDocument();
    expect(window.location.search).toBe('');
  });

  it('provides a reset button to clear the current tracked flights', async () => {
    const user = userEvent.setup();

    render(<FlightTrackerClient map={map} />);

    const input = screen.getByLabelText(/flight identifiers/i);
    await user.type(input, 'AFR12');
    await user.click(screen.getByRole('button', { name: /track flights/i }));

    expect(await screen.findByText(/selected flight/i)).toBeInTheDocument();
    expect(window.location.search).toBe('?q=AFR12');

    await user.click(screen.getByRole('button', { name: /reset tracked flights/i }));

    expect(input).toHaveValue('');
    await waitFor(() => {
      expect(screen.queryByText(/selected flight/i)).not.toBeInTheDocument();
    });
    expect(window.location.search).toBe('');
  });

  it('shows a map color dot for each tracked flight in the list', async () => {
    const user = userEvent.setup();

    render(<FlightTrackerClient map={map} />);

    await user.type(screen.getByLabelText(/flight identifiers/i), 'AFR12');
    await user.click(screen.getByRole('button', { name: /track flights/i }));

    expect(await screen.findByText(/selected flight/i)).toBeInTheDocument();

    const flightCard = screen.getAllByRole('button', { name: /afr12/i })
      .find((element) => within(element).queryByLabelText(/map color/i));

    expect(flightCard).toBeDefined();

    const colorDot = within(flightCard as HTMLElement).getByLabelText(/map color/i);

    expect(colorDot).toHaveStyle({ backgroundColor: '#38bdf8' });
  });

  it('fetches and shows airport details for the selected flight', async () => {
    const user = userEvent.setup();

    render(<FlightTrackerClient map={map} />);

    await user.type(screen.getByLabelText(/flight identifiers/i), 'AFR12');
    await user.click(screen.getByRole('button', { name: /track flights/i }));

    expect(await screen.findByText('Paris Charles de Gaulle Airport')).toBeInTheDocument();
    expect(screen.getByText('John F. Kennedy International Airport')).toBeInTheDocument();
    expect(window.fetch).toHaveBeenCalledWith(
      expect.stringMatching(/^\/api\/tracker\/details\?/),
      { cache: 'no-store' },
    );
  });

  it('shows last observed instead of an arrival time while the selected flight is airborne', async () => {
    const user = userEvent.setup();

    render(<FlightTrackerClient map={map} />);

    await user.type(screen.getByLabelText(/flight identifiers/i), 'AFR12');
    await user.click(screen.getByRole('button', { name: /track flights/i }));

    expect(await screen.findByText('Paris Charles de Gaulle Airport')).toBeInTheDocument();
    expect(screen.getByText(/^Last observed$/i)).toBeInTheDocument();
    expect(screen.queryByText(/^Arrival observed$/i)).not.toBeInTheDocument();
  });

  it('hides an impossible departure-observed time when it is later than the last OpenSky observation', async () => {
    const user = userEvent.setup();
    const inconsistentDetailsPayload = {
      ...detailsPayload,
      route: {
        ...detailsPayload.route,
        firstSeen: Math.round(Date.now() / 1000) + 3600,
        lastSeen: null,
      },
    };

    vi.spyOn(window, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const payload = url.startsWith('/api/tracker/details') ? inconsistentDetailsPayload : responsePayload;

      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    render(<FlightTrackerClient map={map} />);

    await user.type(screen.getByLabelText(/flight identifiers/i), 'AFR12');
    await user.click(screen.getByRole('button', { name: /track flights/i }));

    expect(await screen.findByText('Paris Charles de Gaulle Airport')).toBeInTheDocument();

    const departureLabel = screen.getByText(/^Departure observed$/i);
    expect(departureLabel.nextElementSibling).toHaveTextContent('—');
  });

  it('renders a simple altitude trend chart for the selected flight', async () => {
    const user = userEvent.setup();

    render(<FlightTrackerClient map={map} />);

    await user.type(screen.getByLabelText(/flight identifiers/i), 'AFR12');
    await user.click(screen.getByRole('button', { name: /track flights/i }));

    expect(await screen.findByText(/altitude trend/i)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /altitude history for AFR12/i })).toBeInTheDocument();
  });

  it('renders the altitude trend endpoint marker as a circular overlay', async () => {
    const user = userEvent.setup();

    render(<FlightTrackerClient map={map} />);

    await user.type(screen.getByLabelText(/flight identifiers/i), 'AFR12');
    await user.click(screen.getByRole('button', { name: /track flights/i }));

    const chart = screen.getByRole('img', { name: /altitude history for AFR12/i });
    const endpointMarker = chart.parentElement?.querySelector('span[aria-hidden="true"]');

    expect(endpointMarker).not.toBeNull();
    expect(endpointMarker).toHaveClass('rounded-full');
  });

  it('does not show a raw api data toggle for the altitude chart', async () => {
    const user = userEvent.setup();
    const togglePayload = {
      ...responsePayload,
      flights: [
        {
          ...responsePayload.flights[0],
          track: [
            {
              time: Math.round(Date.now() / 1000) - 180,
              latitude: 48.2,
              longitude: 1.8,
              x: 0,
              y: 0,
              altitude: 10000,
              heading: 180,
              onGround: false,
            },
            {
              time: Math.round(Date.now() / 1000) - 120,
              latitude: 48.4,
              longitude: 1.95,
              x: 0,
              y: 0,
              altitude: 10000,
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
          rawTrack: [
            {
              time: Math.round(Date.now() / 1000) - 180,
              latitude: 48.2,
              longitude: 1.8,
              x: 0,
              y: 0,
              altitude: 10000,
              heading: 180,
              onGround: false,
            },
            {
              time: Math.round(Date.now() / 1000) - 120,
              latitude: 48.4,
              longitude: 1.95,
              x: 0,
              y: 0,
              altitude: 9600,
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
        },
      ],
    };

    vi.spyOn(window, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const payload = url.startsWith('/api/tracker/details') ? detailsPayload : togglePayload;

      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    render(<FlightTrackerClient map={map} />);

    await user.type(screen.getByLabelText(/flight identifiers/i), 'AFR12');
    await user.click(screen.getByRole('button', { name: /track flights/i }));

    expect(await screen.findByRole('img', { name: /altitude history for AFR12/i })).toBeInTheDocument();
    expect(screen.queryByText(/normalized track/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/raw api data/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /show raw altitude history for AFR12/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /show normalized altitude history for AFR12/i })).not.toBeInTheDocument();
  });

  it('plots the altitude trend chronologically so a long cruise shows as a long flat segment', async () => {
    const user = userEvent.setup();
    const now = Math.round(Date.now() / 1000);
    const chronologyPayload = {
      ...responsePayload,
      flights: [
        {
          ...responsePayload.flights[0],
          current: {
            ...responsePayload.flights[0].current,
            time: now - 60,
            altitude: 11100,
          },
          track: [
            {
              time: now - 3600,
              latitude: 47.9,
              longitude: 1.5,
              x: 0,
              y: 0,
              altitude: 8200,
              heading: 180,
              onGround: false,
            },
            {
              time: now - 3300,
              latitude: 48.0,
              longitude: 1.6,
              x: 0,
              y: 0,
              altitude: 11100,
              heading: 180,
              onGround: false,
            },
            {
              time: now - 600,
              latitude: 48.5,
              longitude: 2.0,
              x: 0,
              y: 0,
              altitude: 11100,
              heading: 180,
              onGround: false,
            },
          ],
          lastContact: now - 60,
          geoAltitude: 11100,
          baroAltitude: 11100,
        },
      ],
    };

    vi.spyOn(window, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const payload = url.startsWith('/api/tracker/details') ? detailsPayload : chronologyPayload;

      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    render(<FlightTrackerClient map={map} />);

    await user.type(screen.getByLabelText(/flight identifiers/i), 'AFR12');
    await user.click(screen.getByRole('button', { name: /track flights/i }));

    const chart = await screen.findByRole('img', { name: /altitude history for AFR12/i });
    const path = chart.querySelector('path');
    const coordinates = Array.from((path?.getAttribute('d') ?? '').matchAll(/-?\d+(?:\.\d+)?/g)).map(([value]) => Number(value));
    const anchorPoints = coordinates.length >= 8
      ? [
          { x: coordinates[0]!, y: coordinates[1]! },
          ...Array.from({ length: Math.floor((coordinates.length - 2) / 6) }, (_, index) => ({
            x: coordinates[(index * 6) + 6]!,
            y: coordinates[(index * 6) + 7]!,
          })),
        ]
      : [];

    expect(anchorPoints).toHaveLength(3);

    const earlySegmentWidth = anchorPoints[1]!.x - anchorPoints[0]!.x;
    const cruiseSegmentWidth = anchorPoints[2]!.x - anchorPoints[1]!.x;
    const cruiseSegmentHeight = Math.abs(anchorPoints[2]!.y - anchorPoints[1]!.y);

    expect(cruiseSegmentWidth).toBeGreaterThan(earlySegmentWidth * 3);
    expect(cruiseSegmentHeight).toBeLessThan(1);
  });

  it('does not inject the live altitude snapshot as an extra jump at the end of the history line', async () => {
    const user = userEvent.setup();
    const now = Math.round(Date.now() / 1000);
    const liveSnapshotPayload = {
      ...responsePayload,
      flights: [
        {
          ...responsePayload.flights[0],
          current: {
            ...responsePayload.flights[0].current,
            time: now,
            altitude: 11450,
          },
          track: [
            {
              time: now - 1800,
              latitude: 48.2,
              longitude: 1.8,
              x: 0,
              y: 0,
              altitude: 11100,
              heading: 180,
              onGround: false,
            },
            {
              time: now - 900,
              latitude: 48.4,
              longitude: 2.0,
              x: 0,
              y: 0,
              altitude: 11100,
              heading: 180,
              onGround: false,
            },
            {
              time: now - 300,
              latitude: 48.6,
              longitude: 2.2,
              x: 0,
              y: 0,
              altitude: 11100,
              heading: 180,
              onGround: false,
            },
          ],
          lastContact: now,
          geoAltitude: 11450,
          baroAltitude: 11420,
        },
      ],
    };

    vi.spyOn(window, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const payload = url.startsWith('/api/tracker/details') ? detailsPayload : liveSnapshotPayload;

      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    render(<FlightTrackerClient map={map} />);

    await user.type(screen.getByLabelText(/flight identifiers/i), 'AFR12');
    await user.click(screen.getByRole('button', { name: /track flights/i }));

    const chart = await screen.findByRole('img', { name: /altitude history for AFR12/i });
    const path = chart.querySelector('path');
    const coordinates = Array.from((path?.getAttribute('d') ?? '').matchAll(/-?\d+(?:\.\d+)?/g)).map(([value]) => Number(value));
    const anchorPoints = coordinates.length >= 8
      ? [
          { x: coordinates[0]!, y: coordinates[1]! },
          ...Array.from({ length: Math.floor((coordinates.length - 2) / 6) }, (_, index) => ({
            x: coordinates[(index * 6) + 6]!,
            y: coordinates[(index * 6) + 7]!,
          })),
        ]
      : [];

    expect(anchorPoints).toHaveLength(3);
    expect(Math.abs(anchorPoints[2]!.y - anchorPoints[1]!.y)).toBeLessThan(1);
    expect(screen.getAllByText('11,450 m').length).toBeGreaterThan(0);
  });

  it('renders a stable cruise segment when the backend provides normalized altitude history', async () => {
    const user = userEvent.setup();
    const now = Math.round(Date.now() / 1000);
    const normalizedCruisePayload = {
      ...responsePayload,
      flights: [
        {
          ...responsePayload.flights[0],
          current: {
            ...responsePayload.flights[0].current,
            altitude: 11100,
          },
          track: [
            {
              time: now - 300,
              latitude: 48.2,
              longitude: 1.8,
              x: 0,
              y: 0,
              altitude: 11100,
              heading: 180,
              onGround: false,
            },
            {
              time: now - 240,
              latitude: 48.3,
              longitude: 1.9,
              x: 0,
              y: 0,
              altitude: 11100,
              heading: 180,
              onGround: false,
            },
            {
              time: now - 180,
              latitude: 48.4,
              longitude: 2.0,
              x: 0,
              y: 0,
              altitude: 11100,
              heading: 180,
              onGround: false,
            },
            {
              time: now - 120,
              latitude: 48.5,
              longitude: 2.1,
              x: 0,
              y: 0,
              altitude: 11100,
              heading: 180,
              onGround: false,
            },
            {
              time: now - 60,
              latitude: 48.6,
              longitude: 2.2,
              x: 0,
              y: 0,
              altitude: 11100,
              heading: 180,
              onGround: false,
            },
          ],
          geoAltitude: 11100,
          baroAltitude: 11100,
        },
      ],
    };

    vi.spyOn(window, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const payload = url.startsWith('/api/tracker/details') ? detailsPayload : normalizedCruisePayload;

      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    render(<FlightTrackerClient map={map} />);

    await user.type(screen.getByLabelText(/flight identifiers/i), 'AFR12');
    await user.click(screen.getByRole('button', { name: /track flights/i }));

    const chart = await screen.findByRole('img', { name: /altitude history for AFR12/i });
    const path = chart.querySelector('path');
    const yCoordinates = Array.from((path?.getAttribute('d') ?? '').matchAll(/-?\d+(?:\.\d+)?/g))
      .map(([value]) => Number(value))
      .filter((_, index) => index % 2 === 1);

    expect(yCoordinates.length).toBeGreaterThan(1);
    expect(Math.max(...yCoordinates) - Math.min(...yCoordinates)).toBeLessThan(10);
  });

  it('preserves genuine climb changes instead of flattening them into a stair-step plateau', async () => {
    const user = userEvent.setup();
    const now = Math.round(Date.now() / 1000);
    const climbingPayload = {
      ...responsePayload,
      flights: [
        {
          ...responsePayload.flights[0],
          current: {
            ...responsePayload.flights[0].current,
            altitude: 11887,
          },
          track: [
            {
              time: now - 300,
              latitude: 48.2,
              longitude: 1.8,
              x: 0,
              y: 0,
              altitude: 10972,
              heading: 180,
              onGround: false,
            },
            {
              time: now - 240,
              latitude: 48.3,
              longitude: 1.9,
              x: 0,
              y: 0,
              altitude: 11277,
              heading: 180,
              onGround: false,
            },
            {
              time: now - 180,
              latitude: 48.4,
              longitude: 2.0,
              x: 0,
              y: 0,
              altitude: 11582,
              heading: 180,
              onGround: false,
            },
            {
              time: now - 120,
              latitude: 48.5,
              longitude: 2.1,
              x: 0,
              y: 0,
              altitude: 11277,
              heading: 180,
              onGround: false,
            },
            {
              time: now - 60,
              latitude: 48.6,
              longitude: 2.2,
              x: 0,
              y: 0,
              altitude: 11582,
              heading: 180,
              onGround: false,
            },
            {
              time: now - 30,
              latitude: 48.7,
              longitude: 2.3,
              x: 0,
              y: 0,
              altitude: 11887,
              heading: 180,
              onGround: false,
            },
          ],
          geoAltitude: 11887,
          baroAltitude: 11887,
        },
      ],
    };

    vi.spyOn(window, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const payload = url.startsWith('/api/tracker/details') ? detailsPayload : climbingPayload;

      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    render(<FlightTrackerClient map={map} />);

    await user.type(screen.getByLabelText(/flight identifiers/i), 'AFR12');
    await user.click(screen.getByRole('button', { name: /track flights/i }));

    const chart = await screen.findByRole('img', { name: /altitude history for AFR12/i });
    const path = chart.querySelector('path');
    const coordinates = Array.from((path?.getAttribute('d') ?? '').matchAll(/-?\d+(?:\.\d+)?/g)).map(([value]) => Number(value));
    const anchorPoints = coordinates.length >= 8
      ? [
          { x: coordinates[0]!, y: coordinates[1]! },
          ...Array.from({ length: Math.floor((coordinates.length - 2) / 6) }, (_, index) => ({
            x: coordinates[(index * 6) + 6]!,
            y: coordinates[(index * 6) + 7]!,
          })),
        ]
      : [];

    expect(anchorPoints).toHaveLength(6);
    expect(anchorPoints[2]!.y).toBeLessThan(anchorPoints[1]!.y - 0.5);
    expect(anchorPoints[4]!.y).toBeLessThan(anchorPoints[3]!.y - 0.5);
  });

  it('keeps near-level cruise history from stretching into a tall zigzag chart', async () => {
    const user = userEvent.setup();
    const cruisePayload = {
      ...responsePayload,
      flights: [
        {
          ...responsePayload.flights[0],
          current: {
            ...responsePayload.flights[0].current,
            altitude: 11125,
          },
          track: [
            {
              time: Math.round(Date.now() / 1000) - 300,
              latitude: 48.2,
              longitude: 1.8,
              x: 0,
              y: 0,
              altitude: 11020,
              heading: 180,
              onGround: false,
            },
            {
              time: Math.round(Date.now() / 1000) - 240,
              latitude: 48.3,
              longitude: 1.9,
              x: 0,
              y: 0,
              altitude: 11100,
              heading: 180,
              onGround: false,
            },
            {
              time: Math.round(Date.now() / 1000) - 180,
              latitude: 48.4,
              longitude: 2.0,
              x: 0,
              y: 0,
              altitude: 11010,
              heading: 180,
              onGround: false,
            },
            {
              time: Math.round(Date.now() / 1000) - 120,
              latitude: 48.5,
              longitude: 2.1,
              x: 0,
              y: 0,
              altitude: 11110,
              heading: 180,
              onGround: false,
            },
            {
              time: Math.round(Date.now() / 1000) - 60,
              latitude: 48.6,
              longitude: 2.2,
              x: 0,
              y: 0,
              altitude: 11025,
              heading: 180,
              onGround: false,
            },
          ],
          geoAltitude: 11125,
          baroAltitude: 11100,
        },
      ],
    };

    vi.spyOn(window, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const payload = url.startsWith('/api/tracker/details') ? detailsPayload : cruisePayload;

      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    render(<FlightTrackerClient map={map} />);

    await user.type(screen.getByLabelText(/flight identifiers/i), 'AFR12');
    await user.click(screen.getByRole('button', { name: /track flights/i }));

    const chart = await screen.findByRole('img', { name: /altitude history for AFR12/i });
    const line = chart.querySelector('path, polyline');

    expect(line).not.toBeNull();

    const yCoordinates = Array.from((line?.getAttribute('d') ?? line?.getAttribute('points') ?? '').matchAll(/-?\d+(?:\.\d+)?/g))
      .map(([value]) => Number(value))
      .filter((_, index) => index % 2 === 1);

    expect(yCoordinates.length).toBeGreaterThan(1);
    expect(Math.max(...yCoordinates) - Math.min(...yCoordinates)).toBeLessThan(20);
  });

  it('forces a fresh airport-details request after a manual refresh for the same selected flight', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(window, 'fetch');

    render(<FlightTrackerClient map={map} />);

    await user.type(screen.getByLabelText(/flight identifiers/i), 'AFR12');
    await user.click(screen.getByRole('button', { name: /track flights/i }));

    expect(await screen.findByText('Paris Charles de Gaulle Airport')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^refresh$/i }));

    await waitFor(() => {
      const detailCalls = fetchMock.mock.calls.filter(([url]) => typeof url === 'string' && url.startsWith('/api/tracker/details'));
      expect(detailCalls.length).toBeGreaterThan(1);
      expect(detailCalls.some(([url]) => typeof url === 'string' && url.includes('refresh=1'))).toBe(true);
    });
  });

  it('keeps the last known flight visible when a refresh temporarily returns no live match', async () => {
    const user = userEvent.setup();

    vi.spyOn(window, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      if (url.startsWith('/api/tracker/details')) {
        return new Response(JSON.stringify(detailsPayload), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.includes('refresh=1')) {
        return new Response(JSON.stringify({
          query: 'AFR12',
          requestedIdentifiers: ['AFR12'],
          matchedIdentifiers: [],
          notFoundIdentifiers: ['AFR12'],
          fetchedAt: Date.now(),
          flights: [],
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify(responsePayload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    render(<FlightTrackerClient map={map} />);

    await user.type(screen.getByLabelText(/flight identifiers/i), 'AFR12');
    await user.click(screen.getByRole('button', { name: /track flights/i }));

    expect(await screen.findByText(/selected flight/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^refresh$/i }));

    await waitFor(() => {
      expect(screen.getByText(/selected flight/i)).toBeInTheDocument();
    });
  });
});
