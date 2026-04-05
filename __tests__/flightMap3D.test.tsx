import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TrackerMapProvider } from '~/components/tracker/contexts/TrackerMapContext';
import FlightMap3D from '~/components/tracker/flight/FlightMap3D';
import type { SelectedFlightDetails, TrackedFlight } from '~/components/tracker/flight/types';

const mockUseTrackerLayout = vi.fn();
const globeFactory = vi.fn();

vi.mock('~/components/tracker/contexts/TrackerLayoutContext', () => ({
  useTrackerLayout: () => mockUseTrackerLayout(),
}));

vi.mock('globe.gl', () => ({
  default: globeFactory,
}));

const trackedFlight: TrackedFlight = {
  icao24: 'grounded1',
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
    altitude: 0,
    heading: 45,
    onGround: true,
  },
  originPoint: {
    time: 1_699_999_000,
    latitude: 43.6047,
    longitude: 1.4442,
    x: 80,
    y: 160,
    altitude: 0,
    heading: null,
    onGround: true,
  },
  track: [],
  onGround: true,
  velocity: 0,
  heading: 45,
  verticalRate: 0,
  geoAltitude: 0,
  baroAltitude: 0,
  squawk: '1234',
  category: null,
  route: {
    departureAirport: 'LFBO',
    arrivalAirport: 'LFPG',
    firstSeen: 1_699_999_000,
    lastSeen: 1_700_000_000,
  },
};

const airborneFlight: TrackedFlight = {
  ...trackedFlight,
  icao24: 'airborne1',
  callsign: 'AIR123',
  current: {
    time: 1_700_000_060,
    latitude: 48.8566,
    longitude: 2.3522,
    x: 120,
    y: 140,
    altitude: 11_000,
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
    onGround: true,
  },
  onGround: false,
  velocity: 240,
  geoAltitude: 11_000,
  baroAltitude: 10_900,
};

const preDepartureFlight: TrackedFlight = {
  ...trackedFlight,
  icao24: 'predep1',
  callsign: 'TEST1',
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
  route: {
    departureAirport: 'LFBO',
    arrivalAirport: 'LFPG',
    firstSeen: 1_699_999_000,
    lastSeen: 1_700_000_000,
  },
};

const secondaryFlight: TrackedFlight = {
  ...trackedFlight,
  icao24: 'other02',
  callsign: 'DAL456',
  matchedBy: ['DAL456'],
  current: {
    ...trackedFlight.current!,
    time: 1_700_000_120,
    latitude: 41.9028,
    longitude: 12.4964,
    x: 300,
    y: 250,
  },
  originPoint: {
    ...trackedFlight.originPoint!,
    time: 1_699_999_100,
    latitude: 40.6413,
    longitude: -73.7781,
    x: 260,
    y: 280,
  },
  track: [
    {
      ...(trackedFlight.track[0] ?? trackedFlight.current ?? trackedFlight.originPoint)!,
      time: 1_700_000_030,
      latitude: 45.4384,
      longitude: 10.9916,
      x: 280,
      y: 260,
      altitude: 9200,
      heading: 70,
      onGround: false,
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

function createGlobeMock() {
  const globeMaterial = {
    color: { set: vi.fn() },
    emissive: { set: vi.fn() },
    specular: { set: vi.fn() },
    emissiveIntensity: 0,
    shininess: 0,
    map: 'existing-map',
    needsUpdate: false,
  };

  const globe: Record<string, any> = {
    _destructor: vi.fn(),
    pauseAnimation: vi.fn(),
    globeMaterial: vi.fn(() => globeMaterial),
  };

  const chainableMethods = [
    'globeImageUrl',
    'backgroundColor',
    'showGraticules',
    'showAtmosphere',
    'atmosphereColor',
    'atmosphereAltitude',
    'polygonsData',
    'polygonGeoJsonGeometry',
    'polygonAltitude',
    'polygonCapColor',
    'polygonSideColor',
    'polygonStrokeColor',
    'pointOfView',
    'width',
    'height',
    'pathsData',
    'pathPoints',
    'pathPointLat',
    'pathPointLng',
    'pathPointAlt',
    'pathColor',
    'pathStroke',
    'pathDashLength',
    'pathDashGap',
    'pathDashAnimateTime',
    'pathResolution',
    'pathTransitionDuration',
    'pointsData',
    'pointLat',
    'pointLng',
    'pointAltitude',
    'pointRadius',
    'pointColor',
    'pointsMerge',
    'onPointClick',
    'ringsData',
    'ringLat',
    'ringLng',
    'ringAltitude',
    'ringColor',
    'ringMaxRadius',
    'ringPropagationSpeed',
    'ringRepeatPeriod',
    'htmlElementsData',
    'htmlLat',
    'htmlLng',
    'htmlAltitude',
    'htmlElement',
  ] as const;

  for (const method of chainableMethods) {
    globe[method] = vi.fn(() => globe);
  }

  return { globe, globeMaterial };
}

describe('FlightMap3D', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockUseTrackerLayout.mockReturnValue({
      isMobile: false,
      layoutReady: true,
      sidebarOpen: true,
      setSidebarOpen: vi.fn(),
      sidebarRef: { current: null },
      sidebarToggleRef: { current: null },
      topBarRef: { current: null },
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        json: async () => ({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              properties: { name: 'France' },
              geometry: {
                type: 'Polygon',
                coordinates: [[[2, 48], [3, 48], [3, 49], [2, 48]]],
              },
            },
          ],
        }),
      })),
    );

    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('keeps the selected flight marker above the country layer, adds a route shadow, and keeps the aura on the map surface', async () => {
    const { globe } = createGlobeMock();
    globeFactory.mockReturnValue(() => globe);

    render(
      <TrackerMapProvider
        value={{
          globeRef: { current: null },
          setGlobeRef: vi.fn(),
          svgRef: { current: null },
          mapTransform: { x: 0, y: 0, k: 1, apply: vi.fn(), applyX: vi.fn(), applyY: vi.fn(), invert: vi.fn(), invertX: vi.fn(), invertY: vi.fn(), rescaleX: vi.fn(), rescaleY: vi.fn(), scale: vi.fn(), translate: vi.fn(), toString: vi.fn(() => 'translate(0,0) scale(1)') },
          zoomBy: vi.fn(),
          resetZoom: vi.fn(),
        }}
      >
        <FlightMap3D
          flights={[trackedFlight]}
          selectedIcao24={trackedFlight.icao24}
          selectedFlightDetails={null}
        />
      </TrackerMapProvider>,
    );

    await waitFor(() => {
      expect(globe.polygonAltitude).toHaveBeenCalled();
      expect(globe.pointAltitude).toHaveBeenCalled();
      expect(globe.ringAltitude).toHaveBeenCalled();
    });

    const countryAltitude = globe.polygonAltitude.mock.calls.at(-1)?.[0];
    expect(countryAltitude).toBeCloseTo(0.0035, 4);

    const pointAltitudeAccessor = globe.pointAltitude.mock.calls.at(-1)?.[0];
    const renderedPoints = globe.pointsData.mock.calls.at(-1)?.[0] ?? [];
    const selectedPoint = renderedPoints.find((point: { selected: boolean }) => point.selected);

    expect(selectedPoint).toBeDefined();
    expect(pointAltitudeAccessor(selectedPoint)).toBeGreaterThan(countryAltitude);

    const renderedPaths = globe.pathsData.mock.calls.at(-1)?.[0] ?? [];
    const shadowPath = renderedPaths.find((path: { variant?: string }) => path.variant === 'shadow');

    expect(shadowPath).toBeDefined();
    expect(shadowPath.color).toBe('#081120');
    expect(shadowPath.points.every((point: { alt: number }) => point.alt <= 0.01)).toBe(true);

    const ringAltitudeAccessor = globe.ringAltitude.mock.calls.at(-1)?.[0];
    const renderedRings = globe.ringsData.mock.calls.at(-1)?.[0] ?? [];

    expect(renderedRings).toHaveLength(1);
    expect(ringAltitudeAccessor(renderedRings[0])).toBeGreaterThanOrEqual(countryAltitude);
    expect(ringAltitudeAccessor(renderedRings[0])).toBeLessThan(pointAltitudeAccessor(selectedPoint));
  });

  it('uses a small ground dot for the plane position and a thin fading guide toward the sky', async () => {
    const { globe } = createGlobeMock();
    globeFactory.mockReturnValue(() => globe);

    render(
      <TrackerMapProvider
        value={{
          globeRef: { current: null },
          setGlobeRef: vi.fn(),
          svgRef: { current: null },
          mapTransform: { x: 0, y: 0, k: 1, apply: vi.fn(), applyX: vi.fn(), applyY: vi.fn(), invert: vi.fn(), invertX: vi.fn(), invertY: vi.fn(), rescaleX: vi.fn(), rescaleY: vi.fn(), scale: vi.fn(), translate: vi.fn(), toString: vi.fn(() => 'translate(0,0) scale(1)') },
          zoomBy: vi.fn(),
          resetZoom: vi.fn(),
        }}
      >
        <FlightMap3D
          flights={[airborneFlight]}
          selectedIcao24={airborneFlight.icao24}
          selectedFlightDetails={null}
        />
      </TrackerMapProvider>,
    );

    await waitFor(() => {
      expect(globe.pointAltitude).toHaveBeenCalled();
      expect(globe.pathsData).toHaveBeenCalled();
    });

    const pointAltitudeAccessor = globe.pointAltitude.mock.calls.at(-1)?.[0];
    const renderedPoints = globe.pointsData.mock.calls.at(-1)?.[0] ?? [];
    const selectedPoint = renderedPoints.find((point: { selected: boolean }) => point.selected);

    expect(selectedPoint).toBeDefined();
    expect(pointAltitudeAccessor(selectedPoint)).toBeLessThan(0.01);

    const renderedPaths = globe.pathsData.mock.calls.at(-1)?.[0] ?? [];
    const altitudeGuidePath = renderedPaths.find((path: { variant?: string }) => path.variant === 'guide');
    const mainPath = renderedPaths.find((path: { variant?: string }) => path.variant === 'main');

    expect(altitudeGuidePath).toBeDefined();
    expect(mainPath).toBeDefined();
    expect(Array.isArray(altitudeGuidePath.color)).toBe(true);
    expect(altitudeGuidePath.points).toHaveLength(2);
    expect(altitudeGuidePath.points[1].alt).toBeGreaterThan(altitudeGuidePath.points[0].alt);
    expect(mainPath.points.at(-1)?.alt).toBeCloseTo(altitudeGuidePath.points[1].alt, 5);
  });

  it('uses the same multi-point forecast path shape as the 2D map', async () => {
    const { globe } = createGlobeMock();
    globeFactory.mockReturnValue(() => globe);

    render(
      <TrackerMapProvider
        value={{
          globeRef: { current: null },
          setGlobeRef: vi.fn(),
          svgRef: { current: null },
          mapTransform: { x: 0, y: 0, k: 1, apply: vi.fn(), applyX: vi.fn(), applyY: vi.fn(), invert: vi.fn(), invertX: vi.fn(), invertY: vi.fn(), rescaleX: vi.fn(), rescaleY: vi.fn(), scale: vi.fn(), translate: vi.fn(), toString: vi.fn(() => 'translate(0,0) scale(1)') },
          zoomBy: vi.fn(),
          resetZoom: vi.fn(),
        }}
      >
        <FlightMap3D
          flights={[airborneFlight]}
          selectedIcao24={airborneFlight.icao24}
          selectedFlightDetails={{ ...selectedFlightDetails, icao24: airborneFlight.icao24, callsign: airborneFlight.callsign }}
        />
      </TrackerMapProvider>,
    );

    await waitFor(() => {
      expect(globe.pathsData).toHaveBeenCalled();
    });

    const renderedPaths = globe.pathsData.mock.calls.at(-1)?.[0] ?? [];
    const forecastPath = renderedPaths.find((path: { variant?: string }) => path.variant === 'forecast');

    expect(forecastPath).toBeDefined();
    expect(forecastPath.points.length).toBeGreaterThan(5);
    expect(forecastPath.points[1].lat).not.toBe(forecastPath.points.at(-1)?.lat);
  });

  it('keeps the other plane location dots visible when a flight is selected', async () => {
    const { globe } = createGlobeMock();
    globeFactory.mockReturnValue(() => globe);

    render(
      <TrackerMapProvider
        value={{
          globeRef: { current: null },
          setGlobeRef: vi.fn(),
          svgRef: { current: null },
          mapTransform: { x: 0, y: 0, k: 1, apply: vi.fn(), applyX: vi.fn(), applyY: vi.fn(), invert: vi.fn(), invertX: vi.fn(), invertY: vi.fn(), rescaleX: vi.fn(), rescaleY: vi.fn(), scale: vi.fn(), translate: vi.fn(), toString: vi.fn(() => 'translate(0,0) scale(1)') },
          zoomBy: vi.fn(),
          resetZoom: vi.fn(),
        }}
      >
        <FlightMap3D
          flights={[trackedFlight, secondaryFlight]}
          selectedIcao24={trackedFlight.icao24}
          selectedFlightDetails={selectedFlightDetails}
        />
      </TrackerMapProvider>,
    );

    await waitFor(() => {
      expect(globe.htmlElementsData).toHaveBeenCalled();
    });

    const renderedHtmlElements = globe.htmlElementsData.mock.calls.at(-1)?.[0] ?? [];
    expect(renderedHtmlElements.some((item: { type?: string; icao24?: string }) => item.type === 'plane' && item.icao24 === secondaryFlight.icao24)).toBe(true);
  });

  it('only renders route lines for the selected flight when multiple flights are tracked', async () => {
    const { globe } = createGlobeMock();
    globeFactory.mockReturnValue(() => globe);

    render(
      <TrackerMapProvider
        value={{
          globeRef: { current: null },
          setGlobeRef: vi.fn(),
          svgRef: { current: null },
          mapTransform: { x: 0, y: 0, k: 1, apply: vi.fn(), applyX: vi.fn(), applyY: vi.fn(), invert: vi.fn(), invertX: vi.fn(), invertY: vi.fn(), rescaleX: vi.fn(), rescaleY: vi.fn(), scale: vi.fn(), translate: vi.fn(), toString: vi.fn(() => 'translate(0,0) scale(1)') },
          zoomBy: vi.fn(),
          resetZoom: vi.fn(),
        }}
      >
        <FlightMap3D
          flights={[trackedFlight, secondaryFlight]}
          selectedIcao24={trackedFlight.icao24}
          selectedFlightDetails={selectedFlightDetails}
        />
      </TrackerMapProvider>,
    );

    await waitFor(() => {
      expect(globe.pathsData).toHaveBeenCalled();
    });

    const renderedPaths = globe.pathsData.mock.calls.at(-1)?.[0] ?? [];

    expect(renderedPaths.length).toBeGreaterThan(0);
    expect(renderedPaths.every((path: { id: string }) => path.id.startsWith(`${trackedFlight.icao24}:`))).toBe(true);
  });

  it('lets the user select a flight by clicking the plane marker or the departure marker', async () => {
    const { globe } = createGlobeMock();
    globeFactory.mockReturnValue(() => globe);
    const onSelectFlight = vi.fn();

    render(
      <TrackerMapProvider
        value={{
          globeRef: { current: null },
          setGlobeRef: vi.fn(),
          svgRef: { current: null },
          mapTransform: { x: 0, y: 0, k: 1, apply: vi.fn(), applyX: vi.fn(), applyY: vi.fn(), invert: vi.fn(), invertX: vi.fn(), invertY: vi.fn(), rescaleX: vi.fn(), rescaleY: vi.fn(), scale: vi.fn(), translate: vi.fn(), toString: vi.fn(() => 'translate(0,0) scale(1)') },
          zoomBy: vi.fn(),
          resetZoom: vi.fn(),
        }}
      >
        <FlightMap3D
          flights={[trackedFlight]}
          selectedIcao24={trackedFlight.icao24}
          selectedFlightDetails={selectedFlightDetails}
          onSelectFlight={onSelectFlight}
        />
      </TrackerMapProvider>,
    );

    await waitFor(() => {
      expect(globe.pointsMerge).toHaveBeenCalled();
      expect(globe.onPointClick).toHaveBeenCalled();
      expect(globe.htmlElement).toHaveBeenCalled();
    });

    expect(globe.pointsMerge).toHaveBeenLastCalledWith(false);

    const pointClickHandler = globe.onPointClick.mock.calls.at(-1)?.[0];
    const renderedPoints = globe.pointsData.mock.calls.at(-1)?.[0] ?? [];
    pointClickHandler?.(renderedPoints[0]);

    const htmlElementAccessor = globe.htmlElement.mock.calls.at(-1)?.[0];
    const renderedHtmlElements = globe.htmlElementsData.mock.calls.at(-1)?.[0] ?? [];
    const departureMarker = renderedHtmlElements.find((item: { type?: string }) => item.type === 'departure');
    const departureElement = htmlElementAccessor?.(departureMarker);
    departureElement?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onSelectFlight).toHaveBeenCalledWith(trackedFlight.icao24);
    expect(onSelectFlight).toHaveBeenCalledTimes(2);
  });

  it('renders an orange departure marker for the selected route like the 2D map', async () => {
    const { globe } = createGlobeMock();
    globeFactory.mockReturnValue(() => globe);

    render(
      <TrackerMapProvider
        value={{
          globeRef: { current: null },
          setGlobeRef: vi.fn(),
          svgRef: { current: null },
          mapTransform: { x: 0, y: 0, k: 1, apply: vi.fn(), applyX: vi.fn(), applyY: vi.fn(), invert: vi.fn(), invertX: vi.fn(), invertY: vi.fn(), rescaleX: vi.fn(), rescaleY: vi.fn(), scale: vi.fn(), translate: vi.fn(), toString: vi.fn(() => 'translate(0,0) scale(1)') },
          zoomBy: vi.fn(),
          resetZoom: vi.fn(),
        }}
      >
        <FlightMap3D
          flights={[trackedFlight]}
          selectedIcao24={trackedFlight.icao24}
          selectedFlightDetails={selectedFlightDetails}
        />
      </TrackerMapProvider>,
    );

    await waitFor(() => {
      expect(globe.htmlElementsData).toHaveBeenCalled();
    });

    const renderedHtmlElements = globe.htmlElementsData.mock.calls.at(-1)?.[0] ?? [];

    expect(
      renderedHtmlElements.some((item: { type?: string; color?: string }) => item.type === 'departure' && item.color === '#f59e0b'),
    ).toBe(true);
  });

  it('shows a dashed fading destination preview when the flight is still at departure', async () => {
    const { globe } = createGlobeMock();
    globeFactory.mockReturnValue(() => globe);

    render(
      <TrackerMapProvider
        value={{
          globeRef: { current: null },
          setGlobeRef: vi.fn(),
          svgRef: { current: null },
          mapTransform: { x: 0, y: 0, k: 1, apply: vi.fn(), applyX: vi.fn(), applyY: vi.fn(), invert: vi.fn(), invertX: vi.fn(), invertY: vi.fn(), rescaleX: vi.fn(), rescaleY: vi.fn(), scale: vi.fn(), translate: vi.fn(), toString: vi.fn(() => 'translate(0,0) scale(1)') },
          zoomBy: vi.fn(),
          resetZoom: vi.fn(),
        }}
      >
        <FlightMap3D
          flights={[preDepartureFlight]}
          selectedIcao24={preDepartureFlight.icao24}
          selectedFlightDetails={{ ...selectedFlightDetails, icao24: preDepartureFlight.icao24, callsign: preDepartureFlight.callsign }}
        />
      </TrackerMapProvider>,
    );

    await waitFor(() => {
      expect(globe.pathsData).toHaveBeenCalled();
    });

    const renderedPaths = globe.pathsData.mock.calls.at(-1)?.[0] ?? [];
    const forecastPath = renderedPaths.find((path: { variant?: string }) => path.variant === 'forecast');

    expect(forecastPath).toBeDefined();

    const dashLengthAccessor = globe.pathDashLength.mock.calls.at(-1)?.[0];
    const dashGapAccessor = globe.pathDashGap.mock.calls.at(-1)?.[0];
    const dashAnimateAccessor = globe.pathDashAnimateTime.mock.calls.at(-1)?.[0];
    const pathColorAccessor = globe.pathColor.mock.calls.at(-1)?.[0];
    const pathStrokeAccessor = globe.pathStroke.mock.calls.at(-1)?.[0];
    const mainPath = renderedPaths.find((path: { variant?: string }) => path.variant === 'main');

    expect(pathStrokeAccessor(mainPath)).toBeGreaterThan(1.35);
    expect(pathStrokeAccessor(forecastPath)).toBeGreaterThan(0.48);
    expect(dashLengthAccessor(forecastPath)).toBeLessThan(0.1);
    expect(dashGapAccessor(forecastPath)).toBeLessThan(0.12);
    expect(dashAnimateAccessor(forecastPath)).toBe(0);
    expect(dashAnimateAccessor(mainPath)).toBe(0);
    expect(pathColorAccessor(forecastPath)).toBe(pathColorAccessor(mainPath));
  });

  it('keeps a selectable departure marker for flights that have not departed yet', async () => {
    const { globe } = createGlobeMock();
    globeFactory.mockReturnValue(() => globe);
    const onSelectFlight = vi.fn();

    render(
      <TrackerMapProvider
        value={{
          globeRef: { current: null },
          setGlobeRef: vi.fn(),
          svgRef: { current: null },
          mapTransform: { x: 0, y: 0, k: 1, apply: vi.fn(), applyX: vi.fn(), applyY: vi.fn(), invert: vi.fn(), invertX: vi.fn(), invertY: vi.fn(), rescaleX: vi.fn(), rescaleY: vi.fn(), scale: vi.fn(), translate: vi.fn(), toString: vi.fn(() => 'translate(0,0) scale(1)') },
          zoomBy: vi.fn(),
          resetZoom: vi.fn(),
        }}
      >
        <FlightMap3D
          flights={[preDepartureFlight]}
          selectedIcao24={preDepartureFlight.icao24}
          selectedFlightDetails={{ ...selectedFlightDetails, icao24: preDepartureFlight.icao24, callsign: preDepartureFlight.callsign }}
          onSelectFlight={onSelectFlight}
        />
      </TrackerMapProvider>,
    );

    await waitFor(() => {
      expect(globe.htmlElementsData).toHaveBeenCalled();
      expect(globe.htmlElement).toHaveBeenCalled();
    });

    const htmlElementAccessor = globe.htmlElement.mock.calls.at(-1)?.[0];
    const renderedHtmlElements = globe.htmlElementsData.mock.calls.at(-1)?.[0] ?? [];
    const departureMarker = renderedHtmlElements.find((item: { type?: string }) => item.type === 'departure');

    expect(departureMarker).toBeDefined();

    const departureElement = htmlElementAccessor?.(departureMarker);
    departureElement?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onSelectFlight).toHaveBeenCalledWith(preDepartureFlight.icao24);
  });
});
