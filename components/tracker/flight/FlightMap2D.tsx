'use client';

import { geoNaturalEarth1 } from 'd3-geo';
import { useEffect, useMemo, useRef } from 'react';
import { buildSmoothRoutePath } from '~/lib/utils/routePath';
import type { WorldMapPayload } from '~/lib/server/worldMap';
import { useTrackerLayout } from '../contexts/TrackerLayoutContext';
import { useTrackerMap } from '../contexts/TrackerMapContext';
import { getFlightMapColor } from './colors';
import type { FlightMapPoint, SelectedFlightDetails, TrackedFlight } from './types';

interface FlightMap2DProps {
  map: WorldMapPayload;
  flights: TrackedFlight[];
  selectedIcao24: string | null;
  selectedFlightDetails?: SelectedFlightDetails | null;
  onSelectFlight?: (icao24: string) => void;
}

function getPointDistanceKm(first: FlightMapPoint, second: FlightMapPoint): number {
  const earthRadiusKm = 6371;
  const toRadians = (value: number) => value * (Math.PI / 180);
  const latitudeDelta = toRadians(second.latitude - first.latitude);
  const longitudeDelta = toRadians(second.longitude - first.longitude);
  const startLatitude = toRadians(first.latitude);
  const endLatitude = toRadians(second.latitude);

  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(startLatitude) * Math.cos(endLatitude) * Math.sin(longitudeDelta / 2) ** 2;

  return 2 * earthRadiusKm * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function buildRoutePath(points: FlightMapPoint[]): string {
  if (points.length === 0) {
    return '';
  }

  const segments: FlightMapPoint[][] = [];
  let currentSegment: FlightMapPoint[] = [points[0]!];

  for (let index = 1; index < points.length; index += 1) {
    const previousPoint = points[index - 1]!;
    const point = points[index]!;
    const distanceKm = getPointDistanceKm(previousPoint, point);
    const timeDeltaSeconds = point.time != null && previousPoint.time != null
      ? Math.max(0, point.time - previousPoint.time)
      : null;
    const impliedSpeedKmh = timeDeltaSeconds && timeDeltaSeconds > 0
      ? distanceKm / (timeDeltaSeconds / 3600)
      : null;
    const shouldBreakSegment = distanceKm > 1_200
      || (impliedSpeedKmh != null && impliedSpeedKmh > 1_200);

    if (shouldBreakSegment) {
      if (currentSegment.length > 1) {
        segments.push(currentSegment);
      }

      currentSegment = [previousPoint, point];
      continue;
    }

    currentSegment.push(point);
  }

  if (currentSegment.length > 1 || segments.length === 0) {
    segments.push(currentSegment);
  }

  return segments
    .map((segment) => buildSmoothRoutePath(segment))
    .filter(Boolean)
    .join(' ');
}

function getVisibleRoutePoints(flight: TrackedFlight): FlightMapPoint[] {
  const seen = new Set<string>();

  return [flight.originPoint, ...flight.track, flight.current]
    .filter((point): point is FlightMapPoint => Boolean(point))
    .sort((first, second) => {
      if (first.time == null && second.time == null) {
        return 0;
      }

      if (first.time == null) {
        return 1;
      }

      if (second.time == null) {
        return -1;
      }

      return first.time - second.time;
    })
    .filter((point) => {
      const key = `${point.time ?? 'na'}:${point.x.toFixed(2)}:${point.y.toFixed(2)}`;
      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });
}

function getAirportRoutePoint({
  airport,
  projectPoint,
  time,
}: {
  airport: SelectedFlightDetails['departureAirport'] | SelectedFlightDetails['arrivalAirport'] | null | undefined;
  projectPoint: ReturnType<typeof createFlightMapPointProjector>;
  time: number | null;
}): FlightMapPoint | null {
  if (airport?.latitude == null || airport?.longitude == null) {
    return null;
  }

  return projectPoint({
    latitude: airport.latitude,
    longitude: airport.longitude,
    time,
    altitude: 0,
    onGround: true,
  });
}

function dedupeRoutePoints(points: Array<FlightMapPoint | null>): FlightMapPoint[] {
  const deduped: FlightMapPoint[] = [];

  for (const point of points) {
    if (!point) {
      continue;
    }

    const previous = deduped.at(-1) ?? null;
    if (
      previous
      && Math.abs(previous.x - point.x) <= 0.01
      && Math.abs(previous.y - point.y) <= 0.01
      && (previous.time ?? null) === (point.time ?? null)
    ) {
      continue;
    }

    deduped.push(point);
  }

  return deduped;
}

function getSelectedRoutePoints({
  flight,
  selectedFlightDetails,
  projectPoint,
}: {
  flight: TrackedFlight;
  selectedFlightDetails: SelectedFlightDetails | null | undefined;
  projectPoint: ReturnType<typeof createFlightMapPointProjector>;
}): FlightMapPoint[] {
  const visibleRoutePoints = getVisibleRoutePoints(flight);
  const matchedDetails = selectedFlightDetails?.icao24 === flight.icao24 ? selectedFlightDetails : null;
  const firstVisiblePoint = visibleRoutePoints[0] ?? null;
  const lastVisiblePoint = visibleRoutePoints.at(-1) ?? null;
  const departureTime = flight.route.firstSeen ?? (firstVisiblePoint?.time != null ? firstVisiblePoint.time - 1 : null);
  const departurePoint = getAirportRoutePoint({
    airport: matchedDetails?.departureAirport,
    projectPoint,
    time: departureTime,
  });
  const arrivalPoint = getAirportRoutePoint({
    airport: matchedDetails?.arrivalAirport,
    projectPoint,
    time: flight.route.lastSeen ?? lastVisiblePoint?.time ?? firstVisiblePoint?.time ?? null,
  });

  if (!departurePoint && !arrivalPoint) {
    return visibleRoutePoints;
  }

  if (!firstVisiblePoint) {
    return dedupeRoutePoints([departurePoint, arrivalPoint]);
  }

  if (!departurePoint) {
    return visibleRoutePoints;
  }

  return getPointDistanceKm(departurePoint, firstVisiblePoint) <= 80
    ? dedupeRoutePoints([departurePoint, ...visibleRoutePoints.slice(1)])
    : dedupeRoutePoints([departurePoint, ...visibleRoutePoints]);
}

function toDegrees(value: number): number {
  return value * (180 / Math.PI);
}

function normalizeLongitude(value: number): number {
  const normalized = ((value + 180) % 360 + 360) % 360 - 180;
  return normalized === -180 ? 180 : normalized;
}

function getBearingBetweenPoints(start: FlightMapPoint, end: FlightMapPoint): number {
  const startLatitude = (start.latitude * Math.PI) / 180;
  const endLatitude = (end.latitude * Math.PI) / 180;
  const longitudeDelta = ((end.longitude - start.longitude) * Math.PI) / 180;
  const y = Math.sin(longitudeDelta) * Math.cos(endLatitude);
  const x = Math.cos(startLatitude) * Math.sin(endLatitude)
    - Math.sin(startLatitude) * Math.cos(endLatitude) * Math.cos(longitudeDelta);

  return (toDegrees(Math.atan2(y, x)) + 360) % 360;
}

function getHeadingDeltaDegrees(first: number, second: number): number {
  return Math.abs((((first - second) % 360) + 540) % 360 - 180);
}

function createFlightMapPointProjector(viewBox: { width: number; height: number }) {
  const projection = geoNaturalEarth1();
  projection.fitSize([viewBox.width, viewBox.height], { type: 'Sphere' } as never);

  return ({
    latitude,
    longitude,
    time = null,
    altitude = null,
    heading = null,
    onGround = false,
  }: {
    latitude: number;
    longitude: number;
    time?: number | null;
    altitude?: number | null;
    heading?: number | null;
    onGround?: boolean;
  }): FlightMapPoint | null => {
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return null;
    }

    const coordinates = projection([longitude, latitude]);
    if (!coordinates) {
      return null;
    }

    return {
      time,
      latitude,
      longitude,
      x: coordinates[0],
      y: coordinates[1],
      altitude,
      heading,
      onGround,
    };
  };
}

function projectForecastHeadingPoint({
  start,
  heading,
  distanceKm,
  projectPoint,
}: {
  start: FlightMapPoint;
  heading: number;
  distanceKm: number;
  projectPoint: ReturnType<typeof createFlightMapPointProjector>;
}): FlightMapPoint | null {
  const earthRadiusKm = 6371;
  const angularDistance = Math.max(distanceKm, 1) / earthRadiusKm;
  const headingRadians = (heading * Math.PI) / 180;
  const startLatitude = (start.latitude * Math.PI) / 180;
  const startLongitude = (start.longitude * Math.PI) / 180;
  const projectedLatitude = Math.asin(
    Math.sin(startLatitude) * Math.cos(angularDistance)
      + Math.cos(startLatitude) * Math.sin(angularDistance) * Math.cos(headingRadians),
  );
  const projectedLongitude = startLongitude + Math.atan2(
    Math.sin(headingRadians) * Math.sin(angularDistance) * Math.cos(startLatitude),
    Math.cos(angularDistance) - Math.sin(startLatitude) * Math.sin(projectedLatitude),
  );

  return projectPoint({
    latitude: toDegrees(projectedLatitude),
    longitude: normalizeLongitude(toDegrees(projectedLongitude)),
    time: start.time,
    altitude: start.altitude,
    heading,
    onGround: false,
  });
}

function getForecastRoutePoints({
  flight,
  selectedFlightDetails,
  projectPoint,
}: {
  flight: TrackedFlight;
  selectedFlightDetails: SelectedFlightDetails | null | undefined;
  projectPoint: ReturnType<typeof createFlightMapPointProjector>;
}): FlightMapPoint[] {
  const currentPoint = flight.current ?? flight.track.at(-1) ?? null;
  if (!currentPoint || currentPoint.onGround) {
    return [];
  }

  const arrivalAirport = selectedFlightDetails?.arrivalAirport;
  const arrivalPoint = arrivalAirport?.latitude != null && arrivalAirport?.longitude != null
    ? projectPoint({
        latitude: arrivalAirport.latitude,
        longitude: arrivalAirport.longitude,
        time: flight.route.lastSeen,
        altitude: 0,
        onGround: true,
      })
    : null;

  const bearingToArrival = arrivalPoint ? getBearingBetweenPoints(currentPoint, arrivalPoint) : null;
  const liveHeading = flight.heading ?? currentPoint.heading ?? null;
  const forecastHeading = liveHeading != null && bearingToArrival != null && getHeadingDeltaDegrees(liveHeading, bearingToArrival) > 105
    ? bearingToArrival
    : liveHeading ?? bearingToArrival;

  if (forecastHeading == null) {
    return arrivalPoint ? [currentPoint, arrivalPoint] : [];
  }

  const speedKmh = flight.velocity != null && Number.isFinite(flight.velocity) ? flight.velocity * 3.6 : 820;
  const leadDistanceKm = clamp(speedKmh * 0.35, 180, 540);
  const distanceToArrivalKm = arrivalPoint ? getPointDistanceKm(currentPoint, arrivalPoint) : null;
  const guidedLeadDistanceKm = distanceToArrivalKm != null
    ? clamp(Math.min(leadDistanceKm, distanceToArrivalKm * 0.55), 90, leadDistanceKm)
    : leadDistanceKm;
  const leadPoint = projectForecastHeadingPoint({
    start: currentPoint,
    heading: forecastHeading,
    distanceKm: guidedLeadDistanceKm,
    projectPoint,
  });

  const forecastPoints = [currentPoint, leadPoint];

  if (arrivalPoint && (distanceToArrivalKm ?? 0) > 18) {
    forecastPoints.push(arrivalPoint);
  } else if (!arrivalPoint) {
    forecastPoints.push(projectForecastHeadingPoint({
      start: currentPoint,
      heading: forecastHeading,
      distanceKm: leadDistanceKm * 1.7,
      projectPoint,
    }));
  }

  const seen = new Set<string>();
  return forecastPoints
    .filter((point): point is FlightMapPoint => Boolean(point))
    .filter((point) => {
      const key = `${point.x.toFixed(2)}:${point.y.toFixed(2)}`;
      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });
}

function getRouteBounds(points: FlightMapPoint[]) {
  if (points.length === 0) {
    return null;
  }

  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const padding = 36;

  return {
    x: minX - padding,
    y: minY - padding,
    width: Math.max(72, maxX - minX + padding * 2),
    height: Math.max(72, maxY - minY + padding * 2),
  };
}

function getFixedSizeTransform(point: FlightMapPoint, zoomScale: number): string {
  const safeScale = zoomScale > 0 ? 1 / zoomScale : 1;
  return `translate(${point.x} ${point.y}) scale(${safeScale})`;
}

function getCallsignLabelWidth(callsign: string): number {
  const normalizedCallsign = callsign.trim();

  if (!normalizedCallsign) {
    return 96;
  }

  const estimatedTextWidth = Array.from(normalizedCallsign).reduce((width, character) => {
    if (/[MW@#%&]/.test(character)) {
      return width + 11;
    }

    if (/[A-Z]/.test(character)) {
      return width + 9.6;
    }

    if (/[0-9]/.test(character)) {
      return width + 8.6;
    }

    if (/[\s/-]/.test(character)) {
      return width + 5.2;
    }

    return width + 8.8;
  }, 0);

  return Math.max(96, Math.ceil(estimatedTextWidth + 27));
}

interface LabelObstacle {
  x: number;
  y: number;
  radius: number;
}

interface LabelPlacement {
  offsetX: number;
  offsetY: number;
  connectorX: number;
  connectorY: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function getPointToRectDistance(x: number, y: number, rect: { x: number; y: number; width: number; height: number }): number {
  const dx = x < rect.x ? rect.x - x : x > rect.x + rect.width ? x - (rect.x + rect.width) : 0;
  const dy = y < rect.y ? rect.y - y : y > rect.y + rect.height ? y - (rect.y + rect.height) : 0;

  return Math.hypot(dx, dy);
}

function getDistanceToSegment(
  pointX: number,
  pointY: number,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
): number {
  const deltaX = endX - startX;
  const deltaY = endY - startY;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;

  if (lengthSquared === 0) {
    return Math.hypot(pointX - startX, pointY - startY);
  }

  const projection = clamp(
    ((pointX - startX) * deltaX + (pointY - startY) * deltaY) / lengthSquared,
    0,
    1,
  );

  return Math.hypot(pointX - (startX + deltaX * projection), pointY - (startY + deltaY * projection));
}

function getRouteSegmentPenalty(
  rect: { x: number; y: number; width: number; height: number },
  start: FlightMapPoint,
  end: FlightMapPoint,
  safeScale: number,
): number {
  const padding = 8 * safeScale;
  const minX = Math.min(start.x, end.x);
  const maxX = Math.max(start.x, end.x);
  const minY = Math.min(start.y, end.y);
  const maxY = Math.max(start.y, end.y);

  const intersectsExpandedBounds = maxX >= rect.x - padding
    && minX <= rect.x + rect.width + padding
    && maxY >= rect.y - padding
    && minY <= rect.y + rect.height + padding;

  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;
  const corners = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x, y: rect.y + rect.height },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: centerX, y: centerY },
  ];

  const minimumDistance = Math.min(
    ...corners.map((corner) => getDistanceToSegment(corner.x, corner.y, start.x, start.y, end.x, end.y)),
  );

  let penalty = intersectsExpandedBounds ? 180 : 0;
  const desiredClearance = 14 * safeScale;

  if (minimumDistance < desiredClearance) {
    penalty += (desiredClearance - minimumDistance) * 55;
  }

  return penalty;
}

function getConnectorTarget(offsetX: number, offsetY: number, labelWidth: number, labelHeight: number) {
  const centerX = offsetX + labelWidth / 2;
  const centerY = offsetY + labelHeight / 2;
  const halfWidth = labelWidth / 2;
  const halfHeight = labelHeight / 2;
  const scale = Math.max(
    Math.abs(centerX) > 0 ? Math.abs(centerX) / halfWidth : 0,
    Math.abs(centerY) > 0 ? Math.abs(centerY) / halfHeight : 0,
    1,
  );

  const connectorX = centerX - centerX / scale;
  const connectorY = centerY - centerY / scale;

  return { connectorX, connectorY };
}

function getSelectedLabelPlacement({
  point,
  labelWidth,
  labelHeight,
  zoomScale,
  viewBox,
  routePoints,
  obstacles,
}: {
  point: FlightMapPoint;
  labelWidth: number;
  labelHeight: number;
  zoomScale: number;
  viewBox: { width: number; height: number };
  routePoints: FlightMapPoint[];
  obstacles: LabelObstacle[];
}): LabelPlacement {
  const safeScale = zoomScale > 0 ? 1 / zoomScale : 1;
  const candidates = [
    { offsetX: 12, offsetY: -(labelHeight + 10), preference: 0 },
    { offsetX: 12, offsetY: 10, preference: 1.5 },
    { offsetX: -(labelWidth + 12), offsetY: -(labelHeight + 10), preference: 3 },
    { offsetX: -(labelWidth + 12), offsetY: 10, preference: 4.5 },
    { offsetX: -(labelWidth / 2), offsetY: -(labelHeight + 14), preference: 6 },
    { offsetX: -(labelWidth / 2), offsetY: 14, preference: 7.5 },
  ];

  const previousPoint = routePoints.at(-2) ?? null;
  let bestCandidate = candidates[0]!;
  let bestPenalty = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    const rect = {
      x: point.x + candidate.offsetX * safeScale,
      y: point.y + candidate.offsetY * safeScale,
      width: labelWidth * safeScale,
      height: labelHeight * safeScale,
    };

    const edgePadding = 10 * safeScale;
    const overflow = Math.max(0, edgePadding - rect.x)
      + Math.max(0, edgePadding - rect.y)
      + Math.max(0, rect.x + rect.width - (viewBox.width - edgePadding))
      + Math.max(0, rect.y + rect.height - (viewBox.height - edgePadding));

    let penalty = candidate.preference + overflow * 260;

    const selfClearance = getPointToRectDistance(point.x, point.y, rect);
    if (selfClearance < 10 * safeScale) {
      penalty += (10 * safeScale - selfClearance) * 80;
    }

    for (const obstacle of obstacles) {
      if (Math.abs(obstacle.x - point.x) < 0.01 && Math.abs(obstacle.y - point.y) < 0.01) {
        continue;
      }

      const distance = getPointToRectDistance(obstacle.x, obstacle.y, rect);
      const desiredClearance = (obstacle.radius + 8) * safeScale;
      if (distance < desiredClearance) {
        penalty += (desiredClearance - distance) * 70;
      }
    }

    for (let index = 1; index < routePoints.length; index += 1) {
      penalty += getRouteSegmentPenalty(rect, routePoints[index - 1]!, routePoints[index]!, safeScale);
    }

    if (previousPoint) {
      const incomingX = point.x - previousPoint.x;
      const incomingY = point.y - previousPoint.y;
      const incomingMagnitude = Math.hypot(incomingX, incomingY);

      if (incomingMagnitude > 0) {
        const centerOffsetX = rect.x + rect.width / 2 - point.x;
        const centerOffsetY = rect.y + rect.height / 2 - point.y;
        const directionalBias = (centerOffsetX * incomingX + centerOffsetY * incomingY) / incomingMagnitude;
        penalty -= directionalBias * 0.2;
      }
    }

    if (penalty < bestPenalty) {
      bestPenalty = penalty;
      bestCandidate = candidate;
    }
  }

  return {
    offsetX: bestCandidate.offsetX,
    offsetY: bestCandidate.offsetY,
    ...getConnectorTarget(bestCandidate.offsetX, bestCandidate.offsetY, labelWidth, labelHeight),
  };
}

export default function FlightMap2D({
  map,
  flights,
  selectedIcao24,
  selectedFlightDetails,
  onSelectFlight,
}: FlightMap2DProps) {
  const { isMobile } = useTrackerLayout();
  const { svgRef, mapTransform, focusBounds } = useTrackerMap();
  const preserveAspectRatio = isMobile ? 'xMidYMid slice' : 'xMidYMid meet';
  const lastAutoFocusedFlightRef = useRef<string | null>(null);

  const projectPoint = useMemo(
    () => createFlightMapPointProjector(map.viewBox),
    [map.viewBox.height, map.viewBox.width],
  );

  const selectedFlight = useMemo(() => {
    return flights.find((flight) => flight.icao24 === selectedIcao24) ?? flights[0] ?? null;
  }, [flights, selectedIcao24]);

  const selectedRoutePoints = useMemo(() => {
    if (!selectedFlight) {
      return [];
    }

    return getSelectedRoutePoints({
      flight: selectedFlight,
      selectedFlightDetails: selectedFlightDetails?.icao24 === selectedFlight.icao24 ? selectedFlightDetails : null,
      projectPoint,
    });
  }, [projectPoint, selectedFlight, selectedFlightDetails]);


  const renderedFlights = useMemo(() => {
    if (!selectedFlight) {
      return flights;
    }

    return [
      ...flights.filter((flight) => flight.icao24 !== selectedFlight.icao24),
      selectedFlight,
    ];
  }, [flights, selectedFlight]);

  const flightColorIndexes = useMemo(() => {
    return new Map(flights.map((flight, index) => [flight.icao24, index]));
  }, [flights]);

  const labelObstacles = useMemo(() => {
    return flights.flatMap<LabelObstacle>((flight) => {
      const obstacles: LabelObstacle[] = [];

      if (flight.originPoint) {
        obstacles.push({ x: flight.originPoint.x, y: flight.originPoint.y, radius: 8 });
      }

      if (flight.current) {
        obstacles.push({ x: flight.current.x, y: flight.current.y, radius: 10 });
      }

      return obstacles;
    });
  }, [flights]);

  useEffect(() => {
    if (!selectedFlight || !focusBounds) {
      lastAutoFocusedFlightRef.current = null;
      return;
    }

    if (lastAutoFocusedFlightRef.current === selectedFlight.icao24) {
      return;
    }

    const bounds = getRouteBounds(selectedRoutePoints);
    if (!bounds) {
      return;
    }

    focusBounds(bounds);
    lastAutoFocusedFlightRef.current = selectedFlight.icao24;
  }, [focusBounds, selectedFlight, selectedRoutePoints]);

  return (
    <div className="absolute inset-0">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${map.viewBox.width} ${map.viewBox.height}`}
        preserveAspectRatio={preserveAspectRatio}
        className="h-full w-full touch-none select-none"
        role="img"
        aria-label="Interactive world map showing live tracked flight paths"
      >
        <defs>
          <filter id="tracker-map-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <g transform={mapTransform.toString()}>
          {map.countries.map((country) => (
            <path
              key={country.code}
              d={country.path}
              fill="#081120"
              stroke="rgba(148, 163, 184, 0.32)"
              strokeWidth="0.8"
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {renderedFlights.map((flight, index) => {
            const isSelected = flight.icao24 === selectedFlight?.icao24;
            const visibleRoutePoints = getVisibleRoutePoints(flight);
            const routePoints = isSelected ? selectedRoutePoints : visibleRoutePoints;
            const routePath = isSelected ? buildRoutePath(routePoints) : '';
            const routeStartPoint = routePoints[0] ?? flight.originPoint;
            const routeCurrentPoint = flight.current
              ?? visibleRoutePoints.at(-1)
              ?? (flight.onGround ? routePoints.at(-1) ?? null : null)
              ?? routeStartPoint;
            const colorIndex = flightColorIndexes.get(flight.icao24) ?? index;
            const strokeColor = getFlightMapColor(colorIndex, isSelected);
            const activeSelectedFlightDetails = isSelected && selectedFlightDetails?.icao24 === flight.icao24
              ? selectedFlightDetails
              : null;
            const forecastRoutePoints = isSelected
              ? getForecastRoutePoints({
                  flight,
                  selectedFlightDetails: activeSelectedFlightDetails,
                  projectPoint,
                })
              : [];
            const forecastRoutePath = forecastRoutePoints.length > 1 ? buildSmoothRoutePath(forecastRoutePoints) : '';
            const forecastGradientId = `selected-flight-forecast-gradient-${flight.icao24}`;
            const forecastStartPoint = forecastRoutePoints[0] ?? null;
            const forecastEndPoint = forecastRoutePoints.at(-1) ?? null;
            const labelPoint = routeCurrentPoint ?? routeStartPoint;
            const markerTransform = routeCurrentPoint ? getFixedSizeTransform(routeCurrentPoint, mapTransform.k) : null;
            const originTransform = routeStartPoint ? getFixedSizeTransform(routeStartPoint, mapTransform.k) : null;
            const labelTransform = labelPoint ? getFixedSizeTransform(labelPoint, mapTransform.k) : null;
            const displayCallsign = flight.callsign.trim() || flight.icao24.toUpperCase();
            const labelWidth = getCallsignLabelWidth(displayCallsign);
            const labelHeight = 26;
            const labelPlacement = isSelected && labelPoint
              ? getSelectedLabelPlacement({
                  point: labelPoint,
                  labelWidth,
                  labelHeight,
                  zoomScale: mapTransform.k,
                  viewBox: map.viewBox,
                  routePoints,
                  obstacles: labelObstacles,
                })
              : null;

            return (
              <g key={flight.icao24}>
                {routePath ? (
                  <path
                    d={routePath}
                    fill="none"
                    stroke={strokeColor}
                    strokeOpacity={isSelected ? 0.95 : 0.68}
                    strokeWidth={isSelected ? 3.5 : 2.2}
                    vectorEffect="non-scaling-stroke"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    filter={isSelected ? 'url(#tracker-map-glow)' : undefined}
                    className="cursor-pointer"
                    onClick={() => onSelectFlight?.(flight.icao24)}
                  />
                ) : null}

                {forecastRoutePath && forecastStartPoint && forecastEndPoint ? (
                  <>
                    <defs>
                      <linearGradient
                        id={forecastGradientId}
                        gradientUnits="userSpaceOnUse"
                        x1={forecastStartPoint.x}
                        y1={forecastStartPoint.y}
                        x2={forecastEndPoint.x}
                        y2={forecastEndPoint.y}
                      >
                        <stop offset="0%" stopColor={strokeColor} stopOpacity="0.9" />
                        <stop offset="55%" stopColor={strokeColor} stopOpacity="0.38" />
                        <stop offset="100%" stopColor={strokeColor} stopOpacity="0" />
                      </linearGradient>
                    </defs>
                    <path
                      d={forecastRoutePath}
                      fill="none"
                      stroke={`url(#${forecastGradientId})`}
                      strokeWidth={2.4}
                      strokeDasharray="8 8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                      filter="url(#tracker-map-glow)"
                      className="cursor-pointer"
                      onClick={() => onSelectFlight?.(flight.icao24)}
                    />
                  </>
                ) : null}

                {routeStartPoint && originTransform ? (
                  <g
                    transform={originTransform}
                    className="cursor-pointer"
                    onClick={() => onSelectFlight?.(flight.icao24)}
                  >
                    <circle
                      cx="0"
                      cy="0"
                      r={isSelected ? 5.5 : 4.2}
                      fill="#f59e0b"
                      stroke="rgba(255,255,255,0.85)"
                      strokeWidth="1.3"
                      vectorEffect="non-scaling-stroke"
                    />
                  </g>
                ) : null}

                {routeCurrentPoint && markerTransform ? (
                  <g
                    transform={markerTransform}
                    className="cursor-pointer"
                    onClick={() => onSelectFlight?.(flight.icao24)}
                  >
                    <circle
                      cx="0"
                      cy="0"
                      r={isSelected ? 8.5 : 6.6}
                      fill={strokeColor}
                      fillOpacity={0.22}
                      stroke="none"
                    />
                    <circle
                      cx="0"
                      cy="0"
                      r={isSelected ? 4.8 : 3.8}
                      fill={strokeColor}
                      stroke="rgba(255,255,255,0.95)"
                      strokeWidth="1.3"
                      vectorEffect="non-scaling-stroke"
                    />
                  </g>
                ) : null}

                {isSelected && labelPoint && labelTransform && labelPlacement ? (
                  <g transform={labelTransform} pointerEvents="none">
                    <line
                      x1="0"
                      y1="0"
                      x2={labelPlacement.connectorX}
                      y2={labelPlacement.connectorY}
                      stroke="rgba(56,189,248,0.45)"
                      strokeWidth="1.2"
                      strokeLinecap="round"
                      vectorEffect="non-scaling-stroke"
                    />
                    <g transform={`translate(${labelPlacement.offsetX} ${labelPlacement.offsetY})`}>
                      <rect
                        x="0"
                        y="0"
                        width={labelWidth}
                        height={labelHeight}
                        rx="12"
                        fill="rgba(2,6,23,0.88)"
                        stroke="rgba(56,189,248,0.6)"
                        strokeWidth="1"
                        vectorEffect="non-scaling-stroke"
                      />
                      <text
                        x={labelWidth / 2}
                        y={labelHeight / 2}
                        fill="#e2e8f0"
                        fontSize="11"
                        fontWeight="700"
                        fontFamily="ui-sans-serif, system-ui, sans-serif"
                        textAnchor="middle"
                        dominantBaseline="middle"
                      >
                        {displayCallsign}
                      </text>
                    </g>
                  </g>
                ) : null}
              </g>
            );
          })}
        </g>
      </svg>

      {flights.length === 0 ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6">
          <div className="max-w-md rounded-2xl border border-white/10 bg-slate-950/70 px-5 py-4 text-center text-sm text-slate-300 backdrop-blur-sm">
            Search one or more live flight identifiers to draw their route, origin, and current position on the map.
          </div>
        </div>
      ) : null}
    </div>
  );
}
