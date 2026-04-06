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
});
