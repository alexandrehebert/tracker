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
      track: [],
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

    const flightCard = screen.getByRole('button', { name: /afr12/i });
    const colorDot = within(flightCard).getByLabelText(/map color/i);

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

  it('reuses cached airport details after a refresh for the same selected flight', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(window, 'fetch');

    render(<FlightTrackerClient map={map} />);

    await user.type(screen.getByLabelText(/flight identifiers/i), 'AFR12');
    await user.click(screen.getByRole('button', { name: /track flights/i }));

    expect(await screen.findByText('Paris Charles de Gaulle Airport')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^refresh$/i }));

    await waitFor(() => {
      const detailCalls = fetchMock.mock.calls.filter(([url]) => typeof url === 'string' && url.startsWith('/api/tracker/details'));
      expect(detailCalls).toHaveLength(1);
    });
  });

  it('keeps the last known flight visible when a refresh temporarily returns no live match', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(window, 'fetch');

    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify(responsePayload), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(detailsPayload), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          query: 'AFR12',
          requestedIdentifiers: ['AFR12'],
          matchedIdentifiers: [],
          notFoundIdentifiers: ['AFR12'],
          fetchedAt: Date.now(),
          flights: [],
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

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
