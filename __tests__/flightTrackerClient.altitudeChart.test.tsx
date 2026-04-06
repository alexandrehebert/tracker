import { render, screen, waitFor } from '@testing-library/react';
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

  it('renders a simple altitude trend chart for the selected flight', async () => {
    const user = userEvent.setup();

    render(<FlightTrackerClient map={map} />);

    await user.type(screen.getByLabelText(/flight identifiers/i), 'AFR12');
    await user.click(screen.getByRole('button', { name: /track flights/i }));

    expect(await screen.findByText(/altitude trend/i)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /altitude history for AFR12/i })).toBeInTheDocument();
  });

  it('shows the altitude variation scale for the selected flight chart', async () => {
    const user = userEvent.setup();

    render(<FlightTrackerClient map={map} />);

    await user.type(screen.getByLabelText(/flight identifiers/i), 'AFR12');
    await user.click(screen.getByRole('button', { name: /track flights/i }));

    expect(await screen.findByText(/range 1,800 m/i)).toBeInTheDocument();
    expect(screen.getByText(/high 10,000 m/i)).toBeInTheDocument();
    expect(screen.getByText(/low 8,200 m/i)).toBeInTheDocument();
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
