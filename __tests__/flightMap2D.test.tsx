import { render, screen } from '@testing-library/react';
import { geoNaturalEarth1 } from 'd3-geo';
import { zoomIdentity } from 'd3-zoom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorldMapPayload } from '~/lib/server/worldMap';
import { TrackerMapProvider, type TrackerMapContextValue } from '~/components/tracker/contexts/TrackerMapContext';
import FlightMap2D from '~/components/tracker/flight/FlightMap2D';
import type { FlightMapAirportMarker, SelectedFlightDetails, TrackedFlight } from '~/components/tracker/flight/types';

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
    x: 300,
    y: 280,
  },
  originPoint: {
    ...trackedFlight.originPoint!,
    time: 1_699_999_100,
    x: 260,
    y: 320,
  },
  track: [
    {
      ...trackedFlight.track[0]!,
      time: 1_699_999_700,
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
      mapTransform = zoomIdentity,
      focusBounds = vi.fn() as FocusBoundsHandler,
    }: {
      flights?: TrackedFlight[];
      selectedIcao24?: string | null;
      selectedFlightDetails?: SelectedFlightDetails | null;
      airportMarkers?: FlightMapAirportMarker[];
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
    expect(svg).toHaveStyle({ background: '#071a31' });

    expect(container.querySelector('pattern#tracker-map-grid')).not.toBeNull();
    expect(container.querySelector('rect[fill="url(#tracker-map-grid)"]')).not.toBeNull();
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

    expect(markerTransforms).toContain(`translate(${trackedFlight.current?.x} ${trackedFlight.current?.y}) scale(0.5)`);

    const labelText = screen.getByText(trackedFlight.callsign);
    expect(labelText.parentElement?.parentElement).toHaveAttribute(
      'transform',
      `translate(${trackedFlight.current?.x} ${trackedFlight.current?.y}) scale(0.5)`,
    );
  });

  it('shows labeled departure and arrival airports on the shared map', () => {
    renderMap(false, {
      flights: [trackedFlight],
      airportMarkers,
    });

    expect(screen.getByText('TLS')).toBeInTheDocument();
    expect(screen.getByText('CDG')).toBeInTheDocument();
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
      return value.includes(`${trackedFlight.originPoint?.x.toFixed(2)} ${trackedFlight.originPoint?.y.toFixed(2)}`)
        && value.includes(`${trackedFlight.track[0]?.x.toFixed(2)} ${trackedFlight.track[0]?.y.toFixed(2)}`)
        && value.includes(`${trackedFlight.current?.x.toFixed(2)} ${trackedFlight.current?.y.toFixed(2)}`);
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
      return value.includes(`${trackedFlight.originPoint?.x.toFixed(2)} ${trackedFlight.originPoint?.y.toFixed(2)}`)
        && value.includes(`${trackedFlight.current?.x.toFixed(2)} ${trackedFlight.current?.y.toFixed(2)}`);
    });

    expect(routePath?.getAttribute('d')).toMatch(/[CQ]/);
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

    const projection = geoNaturalEarth1();
    projection.fitSize([map.viewBox.width, map.viewBox.height], { type: 'Sphere' } as never);
    const departureCoordinates = projection([-87.9073, 41.9742]);

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

    const projection = geoNaturalEarth1();
    projection.fitSize([map.viewBox.width, map.viewBox.height], { type: 'Sphere' } as never);
    const departureCoordinates = projection([selectedFlightDetails.departureAirport!.longitude!, selectedFlightDetails.departureAirport!.latitude!]);
    const arrivalCoordinates = projection([selectedFlightDetails.arrivalAirport!.longitude!, selectedFlightDetails.arrivalAirport!.latitude!]);

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
      return value.includes(`${trackedFlight.originPoint?.x.toFixed(2)} ${trackedFlight.originPoint?.y.toFixed(2)}`)
        && value.includes(`${trackedFlight.current?.x.toFixed(2)} ${trackedFlight.current?.y.toFixed(2)}`);
    });

    const nonSelectedRoute = Array.from(container.querySelectorAll('path')).find((path) => {
      const value = path.getAttribute('d') ?? '';
      return value.includes(`${secondaryFlight.originPoint?.x.toFixed(2)} ${secondaryFlight.originPoint?.y.toFixed(2)}`)
        && value.includes(`${secondaryFlight.current?.x.toFixed(2)} ${secondaryFlight.current?.y.toFixed(2)}`);
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

    expect(markerTransforms.at(-1)).toBe(`translate(${trackedFlight.current?.x} ${trackedFlight.current?.y}) scale(1)`);
  });

  it('repositions the selected label away from the map edge when the flight is near the boundary', () => {
    const edgeFlight: TrackedFlight = {
      ...trackedFlight,
      current: {
        ...trackedFlight.current!,
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

    expect(labelContainer).toHaveAttribute('transform', expect.stringMatching(/translate\(-\d+(?:\.\d+)?\s+\d+(?:\.\d+)?\)/));
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

  it('shows the dashed forecast route even before takeoff when the flight is still at departure', () => {
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
