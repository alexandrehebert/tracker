import { render, screen } from '@testing-library/react';
import { zoomIdentity } from 'd3-zoom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorldMapPayload } from '~/lib/server/worldMap';
import { TrackerMapProvider } from '~/components/tracker/contexts/TrackerMapContext';
import FlightMap2D from '~/components/tracker/flight/FlightMap2D';
import type { TrackedFlight } from '~/components/tracker/flight/types';

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

describe('FlightMap2D', () => {
  beforeEach(() => {
    mockUseTrackerLayout.mockReset();
  });

  function renderMap(
    isMobile: boolean,
    {
      flights = [],
      selectedIcao24 = null,
      mapTransform = zoomIdentity,
    }: {
      flights?: TrackedFlight[];
      selectedIcao24?: string | null;
      mapTransform?: typeof zoomIdentity;
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
          svgRef: { current: null },
          mapTransform,
          zoomBy: vi.fn(),
          resetZoom: vi.fn(),
          focusBounds: vi.fn(),
        }}
      >
        <FlightMap2D map={map} flights={flights} selectedIcao24={selectedIcao24} />
      </TrackerMapProvider>,
    );
  }

  it('uses slice preserveAspectRatio on mobile so the map fills the screen height', () => {
    renderMap(true);

    expect(screen.getByRole('img', { name: /interactive world map/i })).toHaveAttribute('preserveAspectRatio', 'xMidYMid slice');
  });

  it('keeps the full map framed on desktop', () => {
    renderMap(false);

    expect(screen.getByRole('img', { name: /interactive world map/i })).toHaveAttribute('preserveAspectRatio', 'xMidYMid meet');
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
