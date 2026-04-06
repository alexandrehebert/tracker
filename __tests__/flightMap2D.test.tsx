import { fireEvent, render, screen } from '@testing-library/react';
import { geoNaturalEarth1 } from 'd3-geo';
import { zoomIdentity } from 'd3-zoom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorldMapPayload } from '~/lib/server/worldMap';
import { TrackerMapProvider, type TrackerMapContextValue } from '~/components/tracker/contexts/TrackerMapContext';
import FlightMap2D from '~/components/tracker/flight/FlightMap2D';
import type { FlightMapAirportMarker, FriendAvatarMarker, SelectedFlightDetails, TrackedFlight } from '~/components/tracker/flight/types';

const mockUseTrackerLayout = vi.fn();

vi.mock('~/components/tracker/contexts/TrackerLayoutContext', () => ({
  useTrackerLayout: () => mockUseTrackerLayout(),
}));

const map: WorldMapPayload = {
  countries: [
    {
      code: 'FR',
      name: 'France',
      capital: 'Paris',
      flag: '🇫🇷',
      path: 'M10 10 L40 10 L40 40 Z',
      centroid: { x: 25, y: 25 },
      capitalPoint: { x: 24, y: 24 },
      focusBounds: { x: 10, y: 10, width: 30, height: 30 },
      latlng: [46, 2],
    },
  ],
  viewBox: { width: 1000, height: 560 },
  projection: { scale: 160, translate: [500, 280] },
};

function createMapProjection() {
  const projection = geoNaturalEarth1();
  projection.scale(map.projection.scale).translate([...map.projection.translate]);
  return projection;
}

function getProjectedCoordinates(
  point: { latitude: number | null; longitude: number | null } | null | undefined,
) {
  if (!point || point.latitude == null || point.longitude == null) {
    return null;
  }

  return createMapProjection()([point.longitude, point.latitude]);
}

function getProjectedPathToken(point: { latitude: number; longitude: number } | null | undefined): string {
  const coordinates = getProjectedCoordinates(point);
  return coordinates ? `${coordinates[0].toFixed(2)} ${coordinates[1].toFixed(2)}` : '';
}

function getProjectedTransform(point: { latitude: number; longitude: number } | null | undefined, scale = 1): string | null {
  const coordinates = getProjectedCoordinates(point);
  return coordinates ? `translate(${coordinates[0]} ${coordinates[1]}) scale(${scale})` : null;
}

const trackedFlight: TrackedFlight = {
  icao24: 'abc123',
  callsign: 'AFR123',
  originCountry: 'France',
  matchedBy: ['AFR123'],
  lastContact: 1_700_000_000,
  current: {
    time: 1_700_000_000,
    latitude: 48.8566,
    longitude: 2.3522,
    x: 120,
    y: 140,
    altitude: 11000,
    heading: 45,
    onGround: false,
  },
  originPoint: {
    time: 1_699_999_000,
    latitude: 43.6047,
    longitude: 1.4442,
    x: 80,
    y: 160,
    altitude: 0,
    heading: null,
    onGround: false,
  },
  track: [
    {
      time: 1_699_999_500,
      latitude: 46.2276,
      longitude: 2.2137,
      x: 100,
      y: 150,
      altitude: 8500,
      heading: 30,
      onGround: false,
    },
  ],
  onGround: false,
  velocity: 240,
  heading: 45,
  verticalRate: 0,
  geoAltitude: 11000,
  baroAltitude: 10900,
  squawk: '1234',
  category: null,
  route: {
    departureAirport: 'LFBO',
    arrivalAirport: 'LFPG',
    firstSeen: 1_699_999_000,
    lastSeen: 1_700_000_000,
  },
};

const preDepartureFlight: TrackedFlight = {
  ...trackedFlight,
  icao24: 'predep1',
  callsign: 'TEST1',
  matchedBy: ['TEST1'],
  current: {
    time: 1_700_000_000,
    latitude: 43.6293,
    longitude: 1.363,
    x: 80,
    y: 160,
    altitude: 0,
    heading: 45,
    onGround: true,
  },
  originPoint: {
    time: 1_699_999_000,
    latitude: 43.6293,
    longitude: 1.363,
    x: 80,
    y: 160,
    altitude: 0,
    heading: null,
    onGround: true,
  },
  track: [],
  onGround: true,
  velocity: 0,
  geoAltitude: 0,
  baroAltitude: 0,
};

const secondaryFlight: TrackedFlight = {
  ...trackedFlight,
  icao24: 'def456',
  callsign: 'DAL456',
  matchedBy: ['DAL456'],
  current: {
    ...trackedFlight.current!,
    time: 1_700_000_100,
    latitude: 51.5074,
    longitude: -0.1278,
    x: 300,
    y: 280,
  },
  originPoint: {
    ...trackedFlight.originPoint!,
    time: 1_699_999_100,
    latitude: 40.6413,
    longitude: -73.7781,
    x: 260,
    y: 320,
  },
  track: [
    {
      ...trackedFlight.track[0]!,
      time: 1_699_999_700,
      latitude: 47.4502,
      longitude: -30.0,
      x: 280,
      y: 300,
    },
  ],
};

const selectedFlightDetails: SelectedFlightDetails = {
  icao24: trackedFlight.icao24,
  callsign: trackedFlight.callsign,
  fetchedAt: Date.now(),
  route: trackedFlight.route,
  departureAirport: {
    code: 'LFBO',
    iata: 'TLS',
    icao: 'LFBO',
    name: 'Toulouse-Blagnac Airport',
    city: 'Toulouse',
    country: 'France',
    latitude: 43.6293,
    longitude: 1.363,
  },
  arrivalAirport: {
    code: 'LFPG',
    iata: 'CDG',
    icao: 'LFPG',
    name: 'Paris Charles de Gaulle Airport',
    city: 'Paris',
    country: 'France',
    latitude: 49.0097,
    longitude: 2.5479,
  },
};

const airportMarkers: FlightMapAirportMarker[] = [
  {
    id: 'lfbo-departure',
    code: 'TLS',
    latitude: 43.6293,
    longitude: 1.363,
    label: 'Toulouse-Blagnac Airport',
    usage: 'departure',
  },
  {
    id: 'lfpg-arrival',
    code: 'CDG',
    latitude: 49.0097,
    longitude: 2.5479,
    label: 'Paris Charles de Gaulle Airport',
    usage: 'arrival',
  },
];

type FocusBoundsHandler = NonNullable<TrackerMapContextValue['focusBounds']>;

describe('FlightMap2D', () => {
  beforeEach(() => {
    mockUseTrackerLayout.mockReset();
  });

  function renderMap(
    isMobile: boolean,
    {
      flights = [],
      selectedIcao24 = null,
      selectedFlightDetails: selectionDetails = null,
      airportMarkers: mapAirportMarkers = [],
      staticFriendMarkers = [],
      selectionMode = 'single',
      mapTransform = zoomIdentity,
      focusBounds = vi.fn() as FocusBoundsHandler,
    }: {
      flights?: TrackedFlight[];
      selectedIcao24?: string | null;
      selectedFlightDetails?: SelectedFlightDetails | null;
      airportMarkers?: FlightMapAirportMarker[];
      staticFriendMarkers?: FriendAvatarMarker[];
      selectionMode?: 'single' | 'all';
      mapTransform?: typeof zoomIdentity;
      focusBounds?: FocusBoundsHandler;
    } = {},
  ) {
    mockUseTrackerLayout.mockReturnValue({
      isMobile,
      layoutReady: true,
      sidebarOpen: true,
      setSidebarOpen: vi.fn(),
      sidebarRef: { current: null },
      sidebarToggleRef: { current: null },
      topBarRef: { current: null },
    });

    return render(
      <TrackerMapProvider
        value={{
          globeRef: { current: null },
          setGlobeRef: vi.fn(),
          svgRef: { current: null },
          mapTransform,
          zoomBy: vi.fn(),
          resetZoom: vi.fn(),
          focusBounds,
        }}
      >
        <FlightMap2D
          map={map}
          flights={flights}
          selectedIcao24={selectedIcao24}
          selectedFlightDetails={selectionDetails}
          airportMarkers={mapAirportMarkers}
          staticFriendMarkers={staticFriendMarkers}
          selectionMode={selectionMode}
        />
      </TrackerMapProvider>,
    );
  }

  it('uses slice preserveAspectRatio on mobile so the map fills the screen height', () => {
    renderMap(true);

    expect(screen.getByRole('img', { name: /interactive world map/i })).toHaveAttribute('preserveAspectRatio', 'xMidYMid slice');
  });

  it('uses slice preserveAspectRatio on desktop so the map fills the screen without top or bottom padding', () => {
    renderMap(false);

    expect(screen.getByRole('img', { name: /interactive world map/i })).toHaveAttribute('preserveAspectRatio', 'xMidYMid slice');
  });

  it('keeps the dark map background across the full viewport while preserving the grid overlay', () => {
    const { container } = renderMap(false);

    const svg = screen.getByRole('img', { name: /interactive world map/i });
    expect(svg).toHaveStyle({ background: '#061729' });

    expect(container.querySelector('pattern#tracker-map-grid')).not.toBeNull();
    expect(container.querySelector('rect[fill="url(#tracker-map-grid)"]')).not.toBeNull();
  });

  it('moves the grid with the transformed map layer', () => {
    const { container } = renderMap(false, {
      mapTransform: zoomIdentity.translate(120, 80).scale(1.5),
    });

    const gridRect = container.querySelector('rect[fill="url(#tracker-map-grid)"]');
    expect(gridRect?.parentElement).toHaveAttribute('transform', 'translate(120,80) scale(1.5)');
  });

  it('extends the grid beyond the viewport so it feels infinite while panning', () => {
    const { container } = renderMap(false);

    const gridRect = container.querySelector('rect[fill="url(#tracker-map-grid)"]');
    expect(Number(gridRect?.getAttribute('x') ?? '0')).toBeLessThan(0);
    expect(Number(gridRect?.getAttribute('y') ?? '0')).toBeLessThan(0);
    expect(Number(gridRect?.getAttribute('width') ?? '0')).toBeGreaterThan(map.viewBox.width * 2);
    expect(Number(gridRect?.getAttribute('height') ?? '0')).toBeGreaterThan(map.viewBox.height * 2);
  });

  it('renders subtle halo gradients behind the 2D map', () => {
    const { container } = renderMap(false);

    expect(container.querySelector('radialGradient#tracker-map-halo-primary')).not.toBeNull();
    expect(container.querySelector('radialGradient#tracker-map-halo-secondary')).not.toBeNull();
    expect(container.querySelector('rect[fill="url(#tracker-map-halo-primary)"]')).not.toBeNull();
    expect(container.querySelector('rect[fill="url(#tracker-map-halo-secondary)"]')).not.toBeNull();
  });

  it('keeps selected markers and labels at a fixed screen size while zoomed', () => {
    const { container } = renderMap(false, {
      flights: [trackedFlight],
      selectedIcao24: trackedFlight.icao24,
      mapTransform: zoomIdentity.scale(2),
    });

    const markerTransforms = Array.from(container.querySelectorAll('g.cursor-pointer')).map(
      (marker) => marker.getAttribute('transform'),
    );

    expect(markerTransforms).toContain(getProjectedTransform(trackedFlight.current, 0.5));

    const labelText = screen.getByText(trackedFlight.callsign);
    expect(labelText.parentElement?.parentElement).toHaveAttribute(
      'transform',
      getProjectedTransform(trackedFlight.current, 0.5),
    );
  });

  it('shows labeled departure and arrival airports on the shared map', () => {
    const { container } = renderMap(false, {
      flights: [trackedFlight],
      airportMarkers,
    });

    const airportGroups = Array.from(container.querySelectorAll('g[opacity="0.98"]'));

    fireEvent.mouseEnter(airportGroups[0]!);
    expect(screen.getByText('TLS')).toBeInTheDocument();

    fireEvent.mouseLeave(airportGroups[0]!);
    fireEvent.mouseEnter(airportGroups[1]!);
    expect(screen.getByText('CDG')).toBeInTheDocument();
  });

  it('renders small friend clusters as split backgrounds and larger ones as counts', () => {
    const { container } = renderMap(false, {
      staticFriendMarkers: [
        {
          id: 'pair-1',
          name: 'Alice',
          avatarUrl: null,
          color: '#ef4444',
          latitude: -33.8688,
          longitude: 151.2093,
        },
        {
          id: 'pair-2',
          name: 'Bob',
          avatarUrl: null,
          color: '#22c55e',
          latitude: -33.8688,
          longitude: 151.2093,
        },
        {
          id: 'quad-1',
          name: 'Cara',
          avatarUrl: null,
          color: '#3b82f6',
          latitude: 40.4168,
          longitude: -3.7038,
        },
        {
          id: 'quad-2',
          name: 'Dan',
          avatarUrl: null,
          color: '#f59e0b',
          latitude: 40.4168,
          longitude: -3.7038,
        },
        {
          id: 'quad-3',
          name: 'Eve',
          avatarUrl: null,
          color: '#a855f7',
          latitude: 40.4168,
          longitude: -3.7038,
        },
        {
          id: 'quad-4',
          name: 'Finn',
          avatarUrl: null,
          color: '#14b8a6',
          latitude: 40.4168,
          longitude: -3.7038,
        },
        {
          id: 'count-1',
          name: 'Gia',
          avatarUrl: null,
          color: '#ec4899',
          latitude: 34.0522,
          longitude: -118.2437,
        },
        {
          id: 'count-2',
          name: 'Hugo',
          avatarUrl: null,
          color: '#84cc16',
          latitude: 34.0522,
          longitude: -118.2437,
        },
        {
          id: 'count-3',
          name: 'Iris',
          avatarUrl: null,
          color: '#06b6d4',
          latitude: 34.0522,
          longitude: -118.2437,
        },
        {
          id: 'count-4',
          name: 'Jules',
          avatarUrl: null,
          color: '#f97316',
          latitude: 34.0522,
          longitude: -118.2437,
        },
        {
          id: 'count-5',
          name: 'Kira',
          avatarUrl: null,
          color: '#8b5cf6',
          latitude: 34.0522,
          longitude: -118.2437,
        },
      ],
    });

    const splitTwoCluster = container.querySelector('[data-cluster-layout="split-2"]');
    const splitFourCluster = container.querySelector('[data-cluster-layout="split-4"]');
    const countCluster = container.querySelector('[data-cluster-layout="count"]');

    expect(splitTwoCluster).not.toBeNull();
    expect(splitTwoCluster?.querySelector('text')).toBeNull();
    expect(splitFourCluster).not.toBeNull();
    expect(splitFourCluster?.querySelector('text')).toBeNull();
    expect(countCluster).not.toBeNull();
    expect(countCluster?.querySelector('text')?.textContent).toBe('5');
  });

  it('shows avatar images inside clustered friend bubbles when available', () => {
    const { container } = renderMap(false, {
      staticFriendMarkers: [
        {
          id: 'avatar-pair-1',
          name: 'Alice',
          avatarUrl: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="%23ef4444"/></svg>',
          color: '#ef4444',
          latitude: -33.8688,
          longitude: 151.2093,
        },
        {
          id: 'avatar-pair-2',
          name: 'Bob',
          avatarUrl: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="%2322c55e"/></svg>',
          color: '#22c55e',
          latitude: -33.8688,
          longitude: 151.2093,
        },
        {
          id: 'avatar-count-1',
          name: 'Cara',
          avatarUrl: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="%233b82f6"/></svg>',
          color: '#3b82f6',
          latitude: 34.0522,
          longitude: -118.2437,
        },
        {
          id: 'avatar-count-2',
          name: 'Dan',
          avatarUrl: null,
          color: '#f59e0b',
          latitude: 34.0522,
          longitude: -118.2437,
        },
        {
          id: 'avatar-count-3',
          name: 'Eve',
          avatarUrl: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="%23a855f7"/></svg>',
          color: '#a855f7',
          latitude: 34.0522,
          longitude: -118.2437,
        },
        {
          id: 'avatar-count-4',
          name: 'Finn',
          avatarUrl: null,
          color: '#14b8a6',
          latitude: 34.0522,
          longitude: -118.2437,
        },
        {
          id: 'avatar-count-5',
          name: 'Gia',
          avatarUrl: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="%23ec4899"/></svg>',
          color: '#ec4899',
          latitude: 34.0522,
          longitude: -118.2437,
        },
      ],
    });

    const splitTwoCluster = container.querySelector('[data-cluster-layout="split-2"]');
    const countCluster = container.querySelector('[data-cluster-layout="count"]');

    expect(splitTwoCluster?.querySelectorAll('image').length).toBe(2);
    expect(countCluster?.querySelectorAll('image').length).toBeGreaterThan(0);
  });

  it('renders the hovered friend cluster last so its label stays above the other markers', () => {
    const { container } = renderMap(false, {
      staticFriendMarkers: [
        {
          id: 'hover-a-1',
          name: 'Alice',
          avatarUrl: null,
          color: '#ef4444',
          latitude: -33.8688,
          longitude: 151.2093,
        },
        {
          id: 'hover-a-2',
          name: 'Bob',
          avatarUrl: null,
          color: '#22c55e',
          latitude: -33.8688,
          longitude: 151.2093,
        },
        {
          id: 'hover-b-1',
          name: 'Cara',
          avatarUrl: null,
          color: '#3b82f6',
          latitude: 34.0522,
          longitude: -118.2437,
        },
        {
          id: 'hover-b-2',
          name: 'Dan',
          avatarUrl: null,
          color: '#f59e0b',
          latitude: 34.0522,
          longitude: -118.2437,
        },
      ],
    });

    const firstCluster = Array.from(container.querySelectorAll('g[data-cluster-layout="split-2"]')).find(
      (group) => group.querySelector('title')?.textContent?.includes('Alice, Bob'),
    );
    const hoverTarget = firstCluster?.querySelector('circle[fill="transparent"]');

    expect(firstCluster).not.toBeNull();
    expect(hoverTarget).not.toBeNull();

    fireEvent.mouseEnter(hoverTarget!);

    const clusterGroups = Array.from(container.querySelectorAll('g[data-cluster-layout="split-2"]'));
    expect(clusterGroups.at(-1)?.querySelector('title')?.textContent).toContain('Alice, Bob');
    expect(container.textContent).toContain('Alice, Bob');
  });

  it('does not refocus the map when the same selected flight refreshes with new live data', () => {
    const focusBounds = vi.fn();
    const { rerender } = renderMap(false, {
      flights: [trackedFlight],
      selectedIcao24: trackedFlight.icao24,
      focusBounds,
    });

    expect(focusBounds).toHaveBeenCalledTimes(1);

    const baseLastContact = trackedFlight.lastContact ?? 0;
    const baseCurrentTime = trackedFlight.current?.time ?? baseLastContact;

    const refreshedFlight: TrackedFlight = {
      ...trackedFlight,
      lastContact: baseLastContact + 60,
      current: trackedFlight.current
        ? {
            ...trackedFlight.current,
            time: baseCurrentTime + 60,
            x: trackedFlight.current.x + 18,
            y: trackedFlight.current.y + 12,
          }
        : null,
      track: [
        ...trackedFlight.track,
        {
          ...(trackedFlight.track.at(-1) ?? trackedFlight.current ?? trackedFlight.originPoint)!,
          time: baseLastContact + 45,
          x: (trackedFlight.current?.x ?? 120) + 10,
          y: (trackedFlight.current?.y ?? 140) + 8,
        },
      ],
    };

    rerender(
      <TrackerMapProvider
        value={{
          globeRef: { current: null },
          setGlobeRef: vi.fn(),
          svgRef: { current: null },
          mapTransform: zoomIdentity,
          zoomBy: vi.fn(),
          resetZoom: vi.fn(),
          focusBounds,
        }}
      >
        <FlightMap2D
          map={map}
          flights={[refreshedFlight]}
          selectedIcao24={refreshedFlight.icao24}
          selectedFlightDetails={selectedFlightDetails}
        />
      </TrackerMapProvider>,
    );

    expect(focusBounds).toHaveBeenCalledTimes(1);
  });

  it('draws the route through the origin, sampled track, and current position', () => {
    const { container } = renderMap(false, {
      flights: [trackedFlight],
      selectedIcao24: trackedFlight.icao24,
    });

    const routePath = Array.from(container.querySelectorAll('path')).find((path) => {
      const value = path.getAttribute('d') ?? '';
      return value.includes(getProjectedPathToken(trackedFlight.originPoint))
        && value.includes(getProjectedPathToken(trackedFlight.track[0]))
        && value.includes(getProjectedPathToken(trackedFlight.current));
    });

    expect(routePath).not.toBeNull();
  });

  it('renders the selected route as a smoothed curve instead of sharp line segments', () => {
    const { container } = renderMap(false, {
      flights: [trackedFlight],
      selectedIcao24: trackedFlight.icao24,
    });

    const routePath = Array.from(container.querySelectorAll('path')).find((path) => {
      const value = path.getAttribute('d') ?? '';
      return value.includes(getProjectedPathToken(trackedFlight.originPoint))
        && value.includes(getProjectedPathToken(trackedFlight.current));
    });

    expect(routePath?.getAttribute('d')).toMatch(/[CQ]/);
  });

  it('uses the map projection for route points even when incoming x/y are stale', () => {
    const staleProjectedFlight: TrackedFlight = {
      ...trackedFlight,
      icao24: 'stale01',
      callsign: 'STL123',
      matchedBy: ['STL123'],
      originPoint: trackedFlight.originPoint
        ? {
            ...trackedFlight.originPoint,
            x: 5,
            y: 15,
          }
        : null,
      track: trackedFlight.track.map((point, index) => ({
        ...point,
        x: 10 + index * 7,
        y: 20 + index * 9,
      })),
      current: trackedFlight.current
        ? {
            ...trackedFlight.current,
            x: 30,
            y: 40,
          }
        : null,
    };

    const { container } = renderMap(false, {
      flights: [staleProjectedFlight],
      selectedIcao24: staleProjectedFlight.icao24,
    });

    const routePath = Array.from(container.querySelectorAll('path')).find((path) => {
      const value = path.getAttribute('d') ?? '';
      return value.includes(getProjectedPathToken(staleProjectedFlight.originPoint))
        && value.includes(getProjectedPathToken(staleProjectedFlight.current));
    });

    expect(routePath).not.toBeNull();
    expect(routePath?.getAttribute('d')).not.toContain('5.00 15.00');
    expect(routePath?.getAttribute('d')).not.toContain('30.00 40.00');
  });

  it('collapses repeated cached route samples so the path does not zig-zag between the same checkpoints', () => {
    const cachedHistoryFlight: TrackedFlight = {
      ...trackedFlight,
      icao24: 'cachedup2d',
      callsign: 'CCH123',
      originPoint: {
        ...trackedFlight.originPoint!,
        latitude: 52.62,
        longitude: -8.41,
        x: 425.79,
        y: 107.19,
      },
      track: [
        {
          ...trackedFlight.track[0]!,
          time: 1_700_000_010,
          latitude: 53.46,
          longitude: -16.8,
          x: 441.32,
          y: 107.37,
        },
        {
          ...trackedFlight.track[0]!,
          time: 1_700_000_020,
          latitude: 52.62,
          longitude: -8.41,
          x: 425.79,
          y: 107.19,
        },
        {
          ...trackedFlight.track[0]!,
          time: 1_700_000_030,
          latitude: 53.46,
          longitude: -16.8,
          x: 441.32,
          y: 107.37,
        },
        {
          ...trackedFlight.track[0]!,
          time: 1_700_000_040,
          latitude: 53.88,
          longitude: -24.7,
          x: 459.98,
          y: 108.66,
        },
      ],
      current: {
        ...trackedFlight.current!,
        time: 1_700_000_050,
        latitude: 53.94,
        longitude: -31.25,
        x: 479.86,
        y: 111.23,
      },
      route: {
        departureAirport: 'EGLL',
        arrivalAirport: 'KJFK',
        firstSeen: 1_700_000_000,
        lastSeen: 1_700_000_050,
      },
    };

    const { container } = renderMap(false, {
      flights: [cachedHistoryFlight],
      selectedIcao24: cachedHistoryFlight.icao24,
      selectedFlightDetails: {
        ...selectedFlightDetails,
        icao24: cachedHistoryFlight.icao24,
        callsign: cachedHistoryFlight.callsign,
      },
    });

    const routePath = Array.from(container.querySelectorAll('path.cursor-pointer')).find((path) => {
      if (path.getAttribute('stroke-dasharray') === '8 8') {
        return false;
      }

      const value = path.getAttribute('d') ?? '';
      return value.includes(getProjectedPathToken(cachedHistoryFlight.originPoint))
        && value.includes(getProjectedPathToken(cachedHistoryFlight.current));
    });

    const routeValue = routePath?.getAttribute('d') ?? '';
    const originOccurrences = routeValue.split(getProjectedPathToken(cachedHistoryFlight.originPoint)).length - 1;

    expect(routePath).not.toBeNull();
    expect(originOccurrences).toBeLessThanOrEqual(2);
  });

  it('uses the resolved departure airport as the selected route start when live track history begins mid-flight', () => {
    const departureAirportDetails: SelectedFlightDetails = {
      ...selectedFlightDetails,
      route: {
        ...selectedFlightDetails.route,
        departureAirport: 'KORD',
      },
      departureAirport: {
        code: 'KORD',
        iata: 'ORD',
        icao: 'KORD',
        name: "Chicago O'Hare International Airport",
        city: 'Chicago',
        country: 'United States',
        latitude: 41.9742,
        longitude: -87.9073,
      },
    };

    const { container } = renderMap(false, {
      flights: [trackedFlight],
      selectedIcao24: trackedFlight.icao24,
      selectedFlightDetails: departureAirportDetails,
    });

    const departureCoordinates = getProjectedCoordinates(departureAirportDetails.departureAirport);

    expect(departureCoordinates).not.toBeNull();

    const expectedOriginTransform = `translate(${departureCoordinates?.[0]} ${departureCoordinates?.[1]}) scale(1)`;
    const markerTransforms = Array.from(container.querySelectorAll('g.cursor-pointer')).map(
      (marker) => marker.getAttribute('transform'),
    );

    expect(markerTransforms).toContain(expectedOriginTransform);
    expect(markerTransforms).not.toContain(`translate(${trackedFlight.originPoint?.x} ${trackedFlight.originPoint?.y}) scale(1)`);
  });

  it('draws a route between the resolved airports when OpenSky live points are unavailable', () => {
    const offlineFlight: TrackedFlight = {
      ...trackedFlight,
      icao24: 'offline01',
      callsign: 'OFF123',
      matchedBy: ['OFF123'],
      current: null,
      originPoint: null,
      track: [],
      rawTrack: [],
      velocity: null,
      heading: null,
      geoAltitude: null,
      baroAltitude: null,
      onGround: false,
    };

    const { container } = renderMap(false, {
      flights: [offlineFlight],
      selectedIcao24: offlineFlight.icao24,
      selectedFlightDetails: {
        ...selectedFlightDetails,
        icao24: offlineFlight.icao24,
        callsign: offlineFlight.callsign,
      },
    });

    const departureCoordinates = getProjectedCoordinates(selectedFlightDetails.departureAirport);
    const arrivalCoordinates = getProjectedCoordinates(selectedFlightDetails.arrivalAirport);

    expect(departureCoordinates).not.toBeNull();
    expect(arrivalCoordinates).not.toBeNull();

    const routePath = Array.from(container.querySelectorAll('path.cursor-pointer')).find((path) => {
      if (path.getAttribute('stroke-dasharray') === '8 8') {
        return false;
      }

      const value = path.getAttribute('d') ?? '';
      return value.includes(`${departureCoordinates?.[0].toFixed(2)} ${departureCoordinates?.[1].toFixed(2)}`)
        && value.includes(`${arrivalCoordinates?.[0].toFixed(2)} ${arrivalCoordinates?.[1].toFixed(2)}`);
    });

    expect(routePath).not.toBeNull();
  });

  it('only draws the route for the selected flight when several flights are tracked', () => {
    const { container } = renderMap(false, {
      flights: [trackedFlight, secondaryFlight],
      selectedIcao24: trackedFlight.icao24,
    });

    const selectedRoute = Array.from(container.querySelectorAll('path')).find((path) => {
      const value = path.getAttribute('d') ?? '';
      return value.includes(getProjectedPathToken(trackedFlight.originPoint))
        && value.includes(getProjectedPathToken(trackedFlight.current));
    });

    const nonSelectedRoute = Array.from(container.querySelectorAll('path')).find((path) => {
      const value = path.getAttribute('d') ?? '';
      return value.includes(getProjectedPathToken(secondaryFlight.originPoint))
        && value.includes(getProjectedPathToken(secondaryFlight.current));
    });

    expect(selectedRoute).not.toBeNull();
    expect(nonSelectedRoute).toBeUndefined();
  });

  it('renders the selected flight markers after the other flights so its dots stay on top', () => {
    const { container } = renderMap(false, {
      flights: [trackedFlight, secondaryFlight],
      selectedIcao24: trackedFlight.icao24,
    });

    const markerTransforms = Array.from(container.querySelectorAll('g.cursor-pointer')).map(
      (marker) => marker.getAttribute('transform'),
    );

    expect(markerTransforms.at(-1)).toBe(getProjectedTransform(trackedFlight.current, 1));
  });

  it('repositions the selected label away from the map edge when the flight is near the boundary', () => {
    const edgeFlight: TrackedFlight = {
      ...trackedFlight,
      current: {
        ...trackedFlight.current!,
        latitude: 82,
        longitude: 170,
        x: 985,
        y: 18,
      },
    };

    renderMap(false, {
      flights: [edgeFlight],
      selectedIcao24: edgeFlight.icao24,
    });

    const labelText = screen.getByText(edgeFlight.callsign);
    const labelContainer = labelText.closest('g');

    expect(labelContainer).toHaveAttribute('transform', expect.stringMatching(/translate\((?:-?\d+(?:\.\d+)?)\s+-\d+(?:\.\d+)?\)/));
  });

  it('anchors the selected-flight connector on the label edge instead of a corner', () => {
    const { container } = renderMap(false, {
      flights: [trackedFlight],
      selectedIcao24: trackedFlight.icao24,
    });

    const labelText = screen.getByText(trackedFlight.callsign);
    const labelContainer = labelText.closest('g');
    const connector = container.querySelector('line');
    const labelRect = labelContainer?.querySelector('rect');

    expect(labelContainer).not.toBeNull();
    expect(connector).not.toBeNull();
    expect(labelRect).not.toBeNull();

    const transformMatch = labelContainer?.getAttribute('transform')?.match(/translate\(([-\d.]+)\s+([-\d.]+)\)/);
    expect(transformMatch).not.toBeNull();

    const offsetX = Number(transformMatch?.[1]);
    const offsetY = Number(transformMatch?.[2]);
    const width = Number(labelRect?.getAttribute('width'));
    const height = Number(labelRect?.getAttribute('height'));
    const x2 = Number(connector?.getAttribute('x2'));
    const y2 = Number(connector?.getAttribute('y2'));
    const epsilon = 0.001;

    const onVerticalEdge = Math.abs(x2 - offsetX) < epsilon || Math.abs(x2 - (offsetX + width)) < epsilon;
    const onHorizontalEdge = Math.abs(y2 - offsetY) < epsilon || Math.abs(y2 - (offsetY + height)) < epsilon;

    expect(onVerticalEdge || onHorizontalEdge).toBe(true);
    expect(onVerticalEdge && onHorizontalEdge).toBe(false);
  });

  it('gives longer callsigns enough label width for comfortable padding', () => {
    const wideFlight: TrackedFlight = {
      ...trackedFlight,
      icao24: 'wide01',
      callsign: 'MWW8888888',
      matchedBy: ['MWW8888888'],
    };

    const { container } = renderMap(false, {
      flights: [wideFlight],
      selectedIcao24: wideFlight.icao24,
    });

    const labelRect = Array.from(container.querySelectorAll('rect')).find((rect) => rect.getAttribute('rx') === '12');

    expect(labelRect).not.toBeNull();
    expect(Number(labelRect?.getAttribute('width'))).toBeGreaterThanOrEqual(120);
  });

  it('draws a fading dashed forecast path with a matching shadow line toward its arrival airport', () => {
    const { container } = renderMap(false, {
      flights: [trackedFlight],
      selectedIcao24: trackedFlight.icao24,
      selectedFlightDetails,
    });

    const dashedForecastPaths = Array.from(container.querySelectorAll('path')).filter(
      (path) => path.getAttribute('stroke-dasharray') === '8 8',
    );
    const forecastPath = dashedForecastPaths.find((path) =>
      (path.getAttribute('stroke') ?? '').includes('selected-flight-forecast-gradient'),
    );
    const shadowPath = dashedForecastPaths.find((path) =>
      (path.getAttribute('stroke') ?? '').includes('selected-flight-forecast-shadow-gradient'),
    );

    expect(forecastPath).toBeTruthy();
    expect(shadowPath).toBeTruthy();
    expect(Number(shadowPath?.getAttribute('stroke-width'))).toBeGreaterThan(Number(forecastPath?.getAttribute('stroke-width')));
  });

  it('does not show a dashed forecast route before takeoff while the flight is still on the departure airport', () => {
    const { container } = renderMap(false, {
      flights: [preDepartureFlight],
      selectedIcao24: preDepartureFlight.icao24,
      selectedFlightDetails: {
        ...selectedFlightDetails,
        icao24: preDepartureFlight.icao24,
        callsign: preDepartureFlight.callsign,
      },
    });

    const forecastPath = Array.from(container.querySelectorAll('path')).find(
      (path) => path.getAttribute('stroke-dasharray') === '8 8'
        && (path.getAttribute('stroke') ?? '').includes('selected-flight-forecast-gradient'),
    );

    expect(forecastPath).toBeFalsy();
  });

  it('shows an airborne forecast preview in all-flight mode on the flat map', () => {
    const { container } = renderMap(false, {
      flights: [trackedFlight],
      selectedIcao24: null,
      selectionMode: 'all',
      selectedFlightDetails,
    });

    const forecastPath = Array.from(container.querySelectorAll('path')).find(
      (path) => path.getAttribute('stroke-dasharray') === '8 8',
    );

    expect(forecastPath).toBeTruthy();
  });

  it('falls back to a heading-based forecast path when airport details are not available', () => {
    const { container } = renderMap(false, {
      flights: [trackedFlight],
      selectedIcao24: trackedFlight.icao24,
    });

    const forecastPath = Array.from(container.querySelectorAll('path')).find(
      (path) => path.getAttribute('stroke-dasharray') === '8 8',
    );

    expect(forecastPath).toBeTruthy();
  });

  it('centers the callsign text inside the selected label', () => {
    renderMap(false, {
      flights: [trackedFlight],
      selectedIcao24: trackedFlight.icao24,
    });

    const labelText = screen.getByText(trackedFlight.callsign);
    expect(labelText).toHaveAttribute('text-anchor', 'middle');
    expect(labelText).toHaveAttribute('dominant-baseline', 'middle');
  });
});
