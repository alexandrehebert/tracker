'use client';

import { geoNaturalEarth1 } from 'd3-geo';
import { useEffect, useMemo, useRef, useState } from 'react';
import { buildSmoothRoutePath } from '~/lib/utils/routePath';
import { getFriendInitials } from '~/lib/utils/friendInitials';
import type { WorldMapPayload } from '~/lib/server/worldMap';
import { useTrackerLayout } from '../contexts/TrackerLayoutContext';
import { useTrackerMap } from '../contexts/TrackerMapContext';
import { getFlightMapColor, getReadableTextColor } from './colors';
import type { FlightMapAirportMarker, FlightMapPoint, FriendAvatarInfo, FriendAvatarMarker, SelectedFlightDetails, TrackedFlight } from './types';

interface FlightMap2DProps {
  map: WorldMapPayload;
  flights: TrackedFlight[];
  selectedIcao24: string | null;
  selectedFlightDetails?: SelectedFlightDetails | null;
  airportMarkers?: FlightMapAirportMarker[];
  onSelectFlight?: (icao24: string) => void;
  onInitialZoomEnd?: () => void;
  selectionMode?: 'single' | 'all';
  flightLabels?: Record<string, string>;
  flightAvatars?: Record<string, FriendAvatarInfo[]>;
  staticFriendMarkers?: FriendAvatarMarker[];
  emptyOverlayMessage?: string | null;
}

const OCEAN_FILL = '#061729';
const GRID_STROKE = 'rgba(125,211,252,0.09)';
const HALO_PRIMARY = 'rgba(56,189,248,0.18)';
const HALO_SECONDARY = 'rgba(168,85,247,0.12)';
const COUNTRY_FILL = 'rgba(12,38,66,0.68)';
const COUNTRY_STROKE = 'rgba(147,197,253,0.24)';
const FORECAST_SHADOW_COLOR = 'rgba(8,17,32,0.7)';
const AIRPORT_MARKER_COLOR = '#a855f7';
const ROUTE_POINT_DUPLICATE_DISTANCE_KM = 12;
const ROUTE_WRAP_SEGMENT_BREAK_RATIO = 0.5;

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

function getRoutePointVisitKey(point: FlightMapPoint): string {
  return `${point.latitude.toFixed(2)}:${point.longitude.toFixed(2)}:${point.onGround ? 'g' : 'a'}`;
}

function getWrappedRouteEdgePoints(
  previousPoint: FlightMapPoint,
  point: FlightMapPoint,
  viewBoxWidth: number,
): { edgeFrom: FlightMapPoint; edgeTo: FlightMapPoint } | null {
  if (!(viewBoxWidth > 0)) {
    return null;
  }

  const deltaX = point.x - previousPoint.x;
  if (Math.abs(deltaX) <= viewBoxWidth * ROUTE_WRAP_SEGMENT_BREAK_RATIO) {
    return null;
  }

  const wrapsRightEdge = point.x < previousPoint.x;
  const adjustedPointX = wrapsRightEdge ? point.x + viewBoxWidth : point.x - viewBoxWidth;
  const edgeFromX = wrapsRightEdge ? viewBoxWidth : 0;
  const edgeToX = wrapsRightEdge ? 0 : viewBoxWidth;
  const denominator = adjustedPointX - previousPoint.x;

  if (Math.abs(denominator) < 0.01) {
    return null;
  }

  const t = clamp((edgeFromX - previousPoint.x) / denominator, 0, 1);
  const edgeY = previousPoint.y + (point.y - previousPoint.y) * t;

  return {
    edgeFrom: {
      ...previousPoint,
      x: edgeFromX,
      y: edgeY,
    },
    edgeTo: {
      ...point,
      x: edgeToX,
      y: edgeY,
    },
  };
}

function buildRoutePath(
  points: FlightMapPoint[],
  {
    viewBoxWidth,
    breakOnTelemetryGaps = true,
  }: {
    viewBoxWidth?: number;
    breakOnTelemetryGaps?: boolean;
  } = {},
): string {
  if (points.length === 0) {
    return '';
  }

  const segments: FlightMapPoint[][] = [];
  let currentSegment: FlightMapPoint[] = [points[0]!];

  for (let index = 1; index < points.length; index += 1) {
    const previousPoint = points[index - 1]!;
    const point = points[index]!;
    const wrappedRouteEdgePoints = viewBoxWidth != null
      ? getWrappedRouteEdgePoints(previousPoint, point, viewBoxWidth)
      : null;

    if (wrappedRouteEdgePoints) {
      currentSegment.push(wrappedRouteEdgePoints.edgeFrom);

      if (currentSegment.length > 1) {
        segments.push(currentSegment);
      }

      currentSegment = [wrappedRouteEdgePoints.edgeTo, point];
      continue;
    }

    const shouldBreakSegment = breakOnTelemetryGaps
      ? (() => {
          const distanceKm = getPointDistanceKm(previousPoint, point);
          const timeDeltaSeconds = point.time != null && previousPoint.time != null
            ? Math.max(0, point.time - previousPoint.time)
            : null;
          const impliedSpeedKmh = timeDeltaSeconds && timeDeltaSeconds > 0
            ? distanceKm / (timeDeltaSeconds / 3600)
            : null;

          return distanceKm > 1_200 || (impliedSpeedKmh != null && impliedSpeedKmh > 1_200);
        })()
      : false;

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
  return dedupeRoutePoints([flight.originPoint, ...flight.track, flight.current]);
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
  const orderedPoints = points.filter((point): point is FlightMapPoint => Boolean(point));
  const deduped: FlightMapPoint[] = [];
  const seenVisitKeys = new Set<string>();

  orderedPoints.forEach((point, index) => {
    const isEndpoint = index === 0 || index === orderedPoints.length - 1;
    const previous = deduped.at(-1) ?? null;

    if (!isEndpoint && previous && getPointDistanceKm(previous, point) <= ROUTE_POINT_DUPLICATE_DISTANCE_KM) {
      return;
    }

    const visitKey = getRoutePointVisitKey(point);
    if (!isEndpoint && seenVisitKeys.has(visitKey)) {
      return;
    }

    seenVisitKeys.add(visitKey);
    deduped.push(point);
  });

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

function createFlightMapPointProjector(map: WorldMapPayload) {
  const projection = geoNaturalEarth1();

  projection
    .scale(map.projection.scale)
    .translate([...map.projection.translate]);

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

function reprojectFlightPoint(
  point: FlightMapPoint | null | undefined,
  projectPoint: ReturnType<typeof createFlightMapPointProjector>,
): FlightMapPoint | null {
  if (!point) {
    return null;
  }

  return projectPoint({
    latitude: point.latitude,
    longitude: point.longitude,
    time: point.time,
    altitude: point.altitude,
    heading: point.heading,
    onGround: point.onGround,
  });
}

function reprojectTrackedFlight(
  flight: TrackedFlight,
  projectPoint: ReturnType<typeof createFlightMapPointProjector>,
): TrackedFlight {
  return {
    ...flight,
    current: reprojectFlightPoint(flight.current, projectPoint),
    originPoint: reprojectFlightPoint(flight.originPoint, projectPoint),
    track: flight.track
      .map((point) => reprojectFlightPoint(point, projectPoint))
      .filter((point): point is FlightMapPoint => Boolean(point)),
    rawTrack: flight.rawTrack
      ?.map((point) => reprojectFlightPoint(point, projectPoint))
      .filter((point): point is FlightMapPoint => Boolean(point)),
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

interface FriendSvgMarker {
  key: string;
  friendId: string;
  name: string;
  avatarUrl: string | null;
  color: string;
  x: number;
  y: number;
  icao24?: string;
  isStale?: boolean;
}

interface FriendSvgCluster {
  x: number;
  y: number;
  members: FriendSvgMarker[];
}

const FRIEND_CLUSTER_RADIUS_PX = 40;
const FRIEND_CLUSTER_FALLBACK_FILL = 'rgba(15,23,42,0.94)';
const FRIEND_CLUSTER_DIVIDER_STROKE = 'rgba(255,255,255,0.42)';

type FriendClusterLayout = 'single' | 'split-2' | 'split-3' | 'split-4' | 'overflow';

type FriendClusterSegmentDefinition = {
  x: number;
  y: number;
  width: number;
  height: number;
};

function getFriendClusterLayout(memberCount: number): FriendClusterLayout {
  if (memberCount <= 1) {
    return 'single';
  }

  if (memberCount === 2) {
    return 'split-2';
  }

  if (memberCount === 3) {
    return 'split-3';
  }

  if (memberCount === 4) {
    return 'split-4';
  }

  return 'overflow';
}

function getFriendClusterSegmentDefinitions(
  layout: Exclude<FriendClusterLayout, 'single'>,
  innerRadius: number,
): FriendClusterSegmentDefinition[] {
  if (layout === 'split-2') {
    return [
      { x: -innerRadius, y: -innerRadius, width: innerRadius, height: innerRadius * 2 },
      { x: 0, y: -innerRadius, width: innerRadius, height: innerRadius * 2 },
    ];
  }

  if (layout === 'split-3') {
    return [
      { x: -innerRadius, y: -innerRadius, width: innerRadius, height: innerRadius },
      { x: -innerRadius, y: 0, width: innerRadius, height: innerRadius },
      { x: 0, y: -innerRadius, width: innerRadius, height: innerRadius * 2 },
    ];
  }

  return [
    { x: -innerRadius, y: -innerRadius, width: innerRadius, height: innerRadius },
    { x: 0, y: -innerRadius, width: innerRadius, height: innerRadius },
    { x: -innerRadius, y: 0, width: innerRadius, height: innerRadius },
    { x: 0, y: 0, width: innerRadius, height: innerRadius },
  ];
}

function renderFriendClusterSegmentFill(
  member: FriendSvgMarker | undefined,
  x: number,
  y: number,
  width: number,
  height: number,
  key: string,
) {
  const fill = member?.color ?? FRIEND_CLUSTER_FALLBACK_FILL;

  return (
    <g key={key}>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill={fill}
      />
      {member?.avatarUrl ? (
        <image
          href={member.avatarUrl}
          x={x}
          y={y}
          width={width}
          height={height}
          preserveAspectRatio="xMidYMid slice"
        />
      ) : null}
    </g>
  );
}

function clusterFriendSvgMarkers(markers: FriendSvgMarker[], clusterRadiusPx: number, zoomScale: number): FriendSvgCluster[] {
  if (markers.length === 0) {
    return [];
  }

  const svgRadius = zoomScale > 0 ? clusterRadiusPx / zoomScale : clusterRadiusPx;
  const clusters: FriendSvgCluster[] = [];
  const assigned = new Set<string>();

  for (const marker of markers) {
    if (assigned.has(marker.key)) {
      continue;
    }

    const members: FriendSvgMarker[] = [marker];
    assigned.add(marker.key);

    for (const other of markers) {
      if (other.key === marker.key || assigned.has(other.key)) {
        continue;
      }

      const dist = Math.hypot(marker.x - other.x, marker.y - other.y);
      if (dist <= svgRadius) {
        members.push(other);
        assigned.add(other.key);
      }
    }

    const cx = members.reduce((sum, m) => sum + m.x, 0) / members.length;
    const cy = members.reduce((sum, m) => sum + m.y, 0) / members.length;
    clusters.push({ x: cx, y: cy, members });
  }

  return clusters;
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

interface ProjectedAirportMarker extends FlightMapAirportMarker {
  point: FlightMapPoint;
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
  airportMarkers = [],
  onSelectFlight,
  onInitialZoomEnd,
  selectionMode = 'single',
  flightLabels,
  flightAvatars,
  staticFriendMarkers,
  emptyOverlayMessage = 'Search one or more live flight identifiers to draw their route, origin, and current position on the map.',
}: FlightMap2DProps) {
  const { isMobile } = useTrackerLayout();
  const { svgRef, mapTransform, focusBounds } = useTrackerMap();
  const preserveAspectRatio = 'xMidYMid slice';
  const lastAutoFocusedFlightRef = useRef<string | null>(null);
  const [hoveredAirportId, setHoveredAirportId] = useState<string | null>(null);
  const [hoveredClusterKey, setHoveredClusterKey] = useState<string | null>(null);

  const projectPoint = useMemo(
    () => createFlightMapPointProjector(map),
    [map],
  );

  const projectedFlights = useMemo(
    () => flights.map((flight) => reprojectTrackedFlight(flight, projectPoint)),
    [flights, projectPoint],
  );

  const selectedFlight = useMemo(() => {
    if (selectionMode !== 'single') {
      return null;
    }

    return projectedFlights.find((flight) => flight.icao24 === selectedIcao24) ?? projectedFlights[0] ?? null;
  }, [projectedFlights, selectedIcao24, selectionMode]);

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

  const projectedAirportMarkers = useMemo(() => {
    return airportMarkers.flatMap<ProjectedAirportMarker>((airport) => {
      const point = projectPoint({
        latitude: airport.latitude,
        longitude: airport.longitude,
        altitude: 0,
        onGround: true,
      });

      return point ? [{ ...airport, point }] : [];
    });
  }, [airportMarkers, projectPoint]);

  const hoveredAirport = useMemo(
    () => projectedAirportMarkers.find((airport) => airport.id === hoveredAirportId) ?? null,
    [projectedAirportMarkers, hoveredAirportId],
  );

  const hoveredAirportLabelWidth = hoveredAirport
    ? Math.max(34, Math.ceil(hoveredAirport.code.length * 7.5) + 14)
    : 0;

  const allFriendSvgMarkers = useMemo<FriendSvgMarker[]>(() => {
    const markers: FriendSvgMarker[] = [];

    if (flightAvatars) {
      for (const flight of projectedFlights) {
        const avatarInfos = flightAvatars[flight.icao24];
        if (!avatarInfos?.length) {
          continue;
        }

        const currentPoint = flight.current ?? flight.track.at(-1) ?? flight.originPoint;
        if (!currentPoint) {
          continue;
        }

        for (const info of avatarInfos) {
          markers.push({
            key: `fly-${info.friendId}-${flight.icao24}`,
            friendId: info.friendId,
            name: info.name,
            avatarUrl: info.avatarUrl,
            color: info.color,
            x: currentPoint.x,
            y: currentPoint.y,
            icao24: flight.icao24,
            isStale: info.isStale === true,
          });
        }
      }
    }

    if (staticFriendMarkers) {
      for (const marker of staticFriendMarkers) {
        const point = projectPoint({
          latitude: marker.latitude,
          longitude: marker.longitude,
          altitude: 0,
          onGround: true,
        });

        if (!point) {
          continue;
        }

        markers.push({
          key: `static-${marker.id}`,
          friendId: marker.id,
          name: marker.name,
          avatarUrl: marker.avatarUrl,
          color: marker.color,
          x: point.x,
          y: point.y,
          isStale: marker.isStale === true,
        });
      }
    }

    return markers;
  }, [flightAvatars, projectedFlights, staticFriendMarkers, projectPoint]);

  const friendSvgClusters = useMemo<FriendSvgCluster[]>(() => {
    return clusterFriendSvgMarkers(allFriendSvgMarkers, FRIEND_CLUSTER_RADIUS_PX, mapTransform.k);
  }, [allFriendSvgMarkers, mapTransform.k]);

  const orderedFriendSvgClusters = useMemo(() => {
    const clustersWithKeys = friendSvgClusters.map((cluster) => ({
      cluster,
      clusterKey: cluster.members.map((member) => member.key).join('|'),
    }));

    if (!hoveredClusterKey) {
      return clustersWithKeys;
    }

    const hoveredCluster = clustersWithKeys.find((entry) => entry.clusterKey === hoveredClusterKey);
    if (!hoveredCluster) {
      return clustersWithKeys;
    }

    return [
      ...clustersWithKeys.filter((entry) => entry.clusterKey !== hoveredClusterKey),
      hoveredCluster,
    ];
  }, [friendSvgClusters, hoveredClusterKey]);

  const friendIcao24Set = useMemo(() => {
    return new Set(allFriendSvgMarkers.map((m) => m.icao24).filter(Boolean) as string[]);
  }, [allFriendSvgMarkers]);

  const renderedFlights = useMemo(() => {
    if (!selectedFlight) {
      return projectedFlights;
    }

    return [
      ...projectedFlights.filter((flight) => flight.icao24 !== selectedFlight.icao24),
      selectedFlight,
    ];
  }, [projectedFlights, selectedFlight]);

  const flightColorIndexes = useMemo(() => {
    return new Map(projectedFlights.map((flight, index) => [flight.icao24, index]));
  }, [projectedFlights]);

  const labelObstacles = useMemo(() => {
    return projectedFlights.flatMap<LabelObstacle>((flight) => {
      const obstacles: LabelObstacle[] = [];

      if (flight.originPoint) {
        obstacles.push({ x: flight.originPoint.x, y: flight.originPoint.y, radius: 8 });
      }

      if (flight.current) {
        obstacles.push({ x: flight.current.x, y: flight.current.y, radius: 10 });
      }

      return obstacles;
    });
  }, [projectedFlights]);

  useEffect(() => {
    if (!onInitialZoomEnd) {
      return;
    }

    const timeoutId = window.setTimeout(onInitialZoomEnd, 350);
    return () => window.clearTimeout(timeoutId);
  }, [onInitialZoomEnd]);

  useEffect(() => {
    if (selectionMode !== 'single' || !selectedFlight || !focusBounds) {
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
  }, [focusBounds, selectedFlight, selectedRoutePoints, selectionMode]);

  const gridSize = isMobile ? 22 : 26;
  const gridOverscan = Math.max(map.viewBox.width, map.viewBox.height) * 6;
  const gridBounds = {
    x: -gridOverscan,
    y: -gridOverscan,
    width: map.viewBox.width + (gridOverscan * 2),
    height: map.viewBox.height + (gridOverscan * 2),
  };

  return (
    <div className="absolute inset-0">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${map.viewBox.width} ${map.viewBox.height}`}
        preserveAspectRatio={preserveAspectRatio}
        className="h-full w-full touch-none select-none"
        style={{
          background: OCEAN_FILL,
        }}
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
          <radialGradient id="tracker-map-halo-primary" cx="28%" cy="22%" r="62%">
            <stop offset="0%" stopColor={HALO_PRIMARY} />
            <stop offset="42%" stopColor="rgba(56,189,248,0.08)" />
            <stop offset="100%" stopColor="rgba(56,189,248,0)" />
          </radialGradient>
          <radialGradient id="tracker-map-halo-secondary" cx="78%" cy="80%" r="58%">
            <stop offset="0%" stopColor={HALO_SECONDARY} />
            <stop offset="38%" stopColor="rgba(168,85,247,0.06)" />
            <stop offset="100%" stopColor="rgba(168,85,247,0)" />
          </radialGradient>
          <clipPath id="tracker-map-land-clip">
            {map.countries.map((country) => (
              <path key={`clip-${country.code}`} d={country.path} />
            ))}
          </clipPath>
          <pattern id="tracker-map-grid" width={gridSize} height={gridSize} patternUnits="userSpaceOnUse">
            <path d={`M ${gridSize} 0 L 0 0 0 ${gridSize}`} fill="none" stroke={GRID_STROKE} strokeWidth="1" />
          </pattern>
        </defs>

        <rect
          x="0"
          y="0"
          width={map.viewBox.width}
          height={map.viewBox.height}
          fill={OCEAN_FILL}
        />
        <rect
          x="0"
          y="0"
          width={map.viewBox.width}
          height={map.viewBox.height}
          fill="url(#tracker-map-halo-primary)"
        />
        <rect
          x="0"
          y="0"
          width={map.viewBox.width}
          height={map.viewBox.height}
          fill="url(#tracker-map-halo-secondary)"
        />

        <g transform={mapTransform.toString()}>
          <rect
            x={gridBounds.x}
            y={gridBounds.y}
            width={gridBounds.width}
            height={gridBounds.height}
            fill="url(#tracker-map-grid)"
          />
          {map.countries.map((country) => (
            <path
              key={country.code}
              d={country.path}
              fill={COUNTRY_FILL}
              stroke={COUNTRY_STROKE}
              strokeWidth="0.85"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          <rect
            x={gridBounds.x}
            y={gridBounds.y}
            width={gridBounds.width}
            height={gridBounds.height}
            fill="url(#tracker-map-grid)"
            opacity="0.22"
            clipPath="url(#tracker-map-land-clip)"
          />

          {projectedAirportMarkers.map((airport) => {
            const markerTransform = getFixedSizeTransform(airport.point, mapTransform.k);
            const isHovered = hoveredAirportId === airport.id;
            const airportTitle = `${airport.label} (${airport.code})`;

            return (
              <g
                key={airport.id}
                transform={markerTransform}
                opacity="0.98"
                onMouseEnter={() => setHoveredAirportId(airport.id)}
                onMouseLeave={() => setHoveredAirportId((current) => (current === airport.id ? null : current))}
              >
                <title>{airportTitle}</title>
                <circle
                  cx="0"
                  cy="0"
                  r={isHovered ? 5.4 : 4.8}
                  fill={AIRPORT_MARKER_COLOR}
                  stroke="rgba(255,255,255,0.92)"
                  strokeWidth="1.2"
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            );
          })}

          {renderedFlights.map((flight, index) => {
            const isSelected = selectionMode === 'single' && flight.icao24 === selectedFlight?.icao24;
            const isHighlighted = selectionMode === 'all' || isSelected;
            const shouldShowRoute = selectionMode === 'all' || isSelected;
            const shouldShowForecast = selectionMode === 'all' || isSelected;
            const visibleRoutePoints = getVisibleRoutePoints(flight);
            const routePoints = shouldShowRoute ? (isSelected ? selectedRoutePoints : visibleRoutePoints) : [];
            const routePath = buildRoutePath(routePoints, {
              viewBoxWidth: map.viewBox.width,
              breakOnTelemetryGaps: true,
            });
            const routeStartPoint = routePoints[0] ?? flight.originPoint;
            const groundFallbackPoint = flight.onGround ? (routePoints.at(-1) ?? null) : null;
            const routeCurrentPoint = flight.current
              ?? visibleRoutePoints.at(-1)
              ?? groundFallbackPoint
              ?? routeStartPoint;
            const colorIndex = flightColorIndexes.get(flight.icao24) ?? index;
            const strokeColor = selectionMode === 'all'
              ? getFlightMapColor(colorIndex, false)
              : getFlightMapColor(colorIndex, isSelected);
            const activeSelectedFlightDetails = isHighlighted && selectedFlightDetails?.icao24 === flight.icao24
              ? selectedFlightDetails
              : null;
            const forecastRoutePoints = shouldShowForecast
              ? getForecastRoutePoints({
                  flight,
                  selectedFlightDetails: activeSelectedFlightDetails,
                  projectPoint,
                })
              : [];
            const forecastRoutePath = forecastRoutePoints.length > 1
              ? buildRoutePath(forecastRoutePoints, {
                  viewBoxWidth: map.viewBox.width,
                  breakOnTelemetryGaps: false,
                })
              : '';
            const forecastGradientId = `selected-flight-forecast-gradient-${flight.icao24}`;
            const forecastShadowGradientId = `selected-flight-forecast-shadow-gradient-${flight.icao24}`;
            const forecastStartPoint = forecastRoutePoints[0] ?? null;
            const forecastEndPoint = forecastRoutePoints.at(-1) ?? null;
            const labelPoint = routeCurrentPoint ?? routeStartPoint;
            const markerTransform = routeCurrentPoint ? getFixedSizeTransform(routeCurrentPoint, mapTransform.k) : null;
            const originTransform = routeStartPoint ? getFixedSizeTransform(routeStartPoint, mapTransform.k) : null;
            const labelTransform = labelPoint ? getFixedSizeTransform(labelPoint, mapTransform.k) : null;
            const displayCallsign = flightLabels?.[flight.icao24]?.trim() || flight.callsign.trim() || flight.icao24.toUpperCase();
            const labelWidth = getCallsignLabelWidth(displayCallsign);
            const labelHeight = 26;
            const hasFriendAvatar = friendIcao24Set.has(flight.icao24);
            const labelPlacement = isHighlighted && labelPoint && !hasFriendAvatar
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
                    strokeOpacity={isHighlighted ? 0.95 : 0.68}
                    strokeWidth={isHighlighted ? 3.5 : 2.2}
                    vectorEffect="non-scaling-stroke"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    filter={isHighlighted ? 'url(#tracker-map-glow)' : undefined}
                    className="cursor-pointer"
                    onClick={() => onSelectFlight?.(flight.icao24)}
                  />
                ) : null}

                {forecastRoutePath && forecastStartPoint && forecastEndPoint ? (
                  <>
                    <defs>
                      <linearGradient
                        id={forecastShadowGradientId}
                        gradientUnits="userSpaceOnUse"
                        x1={forecastStartPoint.x}
                        y1={forecastStartPoint.y}
                        x2={forecastEndPoint.x}
                        y2={forecastEndPoint.y}
                      >
                        <stop offset="0%" stopColor={FORECAST_SHADOW_COLOR} stopOpacity="0.62" />
                        <stop offset="55%" stopColor={FORECAST_SHADOW_COLOR} stopOpacity="0.24" />
                        <stop offset="100%" stopColor={FORECAST_SHADOW_COLOR} stopOpacity="0" />
                      </linearGradient>
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
                      stroke={`url(#${forecastShadowGradientId})`}
                      strokeWidth={4.2}
                      strokeDasharray="8 8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                      className="cursor-pointer"
                      onClick={() => onSelectFlight?.(flight.icao24)}
                    />
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
                      r={isHighlighted ? 2.1 : 1.7}
                      fill={strokeColor}
                      fillOpacity={0.92}
                      stroke="rgba(255,255,255,0.82)"
                      strokeWidth="0.8"
                      vectorEffect="non-scaling-stroke"
                    />
                  </g>
                ) : null}

                {routeCurrentPoint && markerTransform && !hasFriendAvatar ? (
                  <g
                    transform={markerTransform}
                    className="cursor-pointer"
                    onClick={() => onSelectFlight?.(flight.icao24)}
                  >
                    <circle
                      cx="0"
                      cy="0"
                      r={isHighlighted ? 4.2 : 3.2}
                      fill={strokeColor}
                      fillOpacity={0.1}
                      stroke="none"
                    />
                    <circle
                      cx="0"
                      cy="0"
                      r={isHighlighted ? 2.3 : 1.8}
                      fill={strokeColor}
                      stroke="rgba(255,255,255,0.92)"
                      strokeWidth="0.9"
                      vectorEffect="non-scaling-stroke"
                    />
                  </g>
                ) : null}

                {isHighlighted && labelPoint && labelTransform && labelPlacement && !hasFriendAvatar ? (
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

          {orderedFriendSvgClusters.map(({ cluster, clusterKey }) => {
            const safeClusterKey = clusterKey.replace(/[^a-zA-Z0-9_-]/g, '-');
            const isHovered = hoveredClusterKey === clusterKey;
            const isSingle = cluster.members.length === 1;
            const firstMember = cluster.members[0]!;
            const outerRadius = isSingle ? 17 : 20;
            const innerRadius = isSingle ? 14 : 17;
            const clusterLayout = getFriendClusterLayout(cluster.members.length);
            const clusterTransform = `translate(${cluster.x} ${cluster.y}) scale(${mapTransform.k > 0 ? 1 / mapTransform.k : 1})`;
            const staleMemberCount = cluster.members.filter((member) => member.isStale).length;
            const hasStaleMembers = staleMemberCount > 0;
            const isFullyStale = staleMemberCount === cluster.members.length;
            const memberLabels = cluster.members.map((member) => member.isStale ? `${member.name} (last known)` : member.name);
            const labelText = isSingle
              ? memberLabels[0] ?? firstMember.name
              : cluster.members.length <= 4
                ? memberLabels.join(', ')
                : `${memberLabels.slice(0, 4).join(', ')} +${cluster.members.length - 4}`;
            const estimatedLabelWidth = Math.max(60, labelText.length * 7 + 20);
            const clusterFillClipId = `friend-cluster-fill-${safeClusterKey}`;
            const segmentDefinitions = clusterLayout === 'single'
              ? []
              : getFriendClusterSegmentDefinitions(clusterLayout, innerRadius);
            const overflowCount = Math.max(0, cluster.members.length - 4);
            const overflowSegment = clusterLayout === 'overflow'
              ? segmentDefinitions[3] ?? null
              : null;

            return (
              <g
                key={clusterKey}
                transform={clusterTransform}
                data-cluster-layout={clusterLayout}
                data-cluster-size={cluster.members.length}
                data-cluster-stale={isFullyStale ? 'all' : hasStaleMembers ? 'partial' : 'none'}
              >
                <title>{isSingle ? firstMember.name : `${cluster.members.length} friends: ${labelText}`}</title>
                {isSingle ? (
                  <>
                    <defs>
                      <clipPath id={`friend-avatar-clip-${firstMember.key}`}>
                        <circle cx="0" cy="0" r={innerRadius} />
                      </clipPath>
                    </defs>
                    <g>
                      <circle cx="0" cy="0" r={outerRadius} fill={firstMember.color} fillOpacity="0.22" />
                      <circle cx="0" cy="0" r={innerRadius} fill={firstMember.color} />
                      {firstMember.avatarUrl ? (
                        <image
                          href={firstMember.avatarUrl}
                          x={-innerRadius}
                          y={-innerRadius}
                          width={innerRadius * 2}
                          height={innerRadius * 2}
                          clipPath={`url(#friend-avatar-clip-${firstMember.key})`}
                          preserveAspectRatio="xMidYMid slice"
                        />
                      ) : (
                        <text
                          x="0"
                          y="0"
                          textAnchor="middle"
                          dominantBaseline="middle"
                          fill={getReadableTextColor(firstMember.color, { light: '#ffffff' })}
                          fontSize="11"
                          fontWeight="700"
                          fontFamily="ui-sans-serif, system-ui, sans-serif"
                        >
                          {getFriendInitials(firstMember.name)}
                        </text>
                      )}
                      <circle
                        cx="0"
                        cy="0"
                        r={innerRadius}
                        fill="none"
                        stroke="white"
                        strokeWidth="2"
                        vectorEffect="non-scaling-stroke"
                      />
                    </g>
                  </>
                ) : (
                  <>
                    <defs>
                      <clipPath id={clusterFillClipId}>
                        <circle cx="0" cy="0" r={innerRadius} />
                      </clipPath>
                    </defs>
                    <circle
                      cx="0"
                      cy="0"
                      r={outerRadius}
                      fill={isHovered ? 'rgba(56,189,248,0.24)' : 'rgba(15,23,42,0.24)'}
                    />
                    <g clipPath={`url(#${clusterFillClipId})`}>
                      {segmentDefinitions.length > 0 ? (
                        <>
                          {segmentDefinitions.map((segment, segmentIndex) => renderFriendClusterSegmentFill(
                            cluster.members[segmentIndex],
                            segment.x,
                            segment.y,
                            segment.width,
                            segment.height,
                            `${safeClusterKey}-segment-${segmentIndex}`,
                          ))}
                          {overflowSegment && overflowCount > 0 ? (
                            <g>
                              <rect
                                x={overflowSegment.x}
                                y={overflowSegment.y}
                                width={overflowSegment.width}
                                height={overflowSegment.height}
                                fill="rgba(2,6,23,0.58)"
                              />
                              <text
                                x={overflowSegment.x + (overflowSegment.width / 2)}
                                y={overflowSegment.y + (overflowSegment.height / 2)}
                                textAnchor="middle"
                                dominantBaseline="middle"
                                fill="white"
                                fontSize="10"
                                fontWeight="800"
                                fontFamily="ui-sans-serif, system-ui, sans-serif"
                              >
                                +{overflowCount}
                              </text>
                            </g>
                          ) : null}
                        </>
                      ) : (
                        <circle cx="0" cy="0" r={innerRadius} fill="rgba(2,6,23,0.9)" />
                      )}
                    </g>

                    {clusterLayout === 'split-2' ? (
                      <line
                        x1="0"
                        y1={-innerRadius}
                        x2="0"
                        y2={innerRadius}
                        stroke={FRIEND_CLUSTER_DIVIDER_STROKE}
                        strokeWidth="1.2"
                        vectorEffect="non-scaling-stroke"
                      />
                    ) : clusterLayout === 'split-3' ? (
                      <>
                        <line
                          x1="0"
                          y1={-innerRadius}
                          x2="0"
                          y2={innerRadius}
                          stroke={FRIEND_CLUSTER_DIVIDER_STROKE}
                          strokeWidth="1.2"
                          vectorEffect="non-scaling-stroke"
                        />
                        <line
                          x1={-innerRadius}
                          y1="0"
                          x2="0"
                          y2="0"
                          stroke={FRIEND_CLUSTER_DIVIDER_STROKE}
                          strokeWidth="1.2"
                          vectorEffect="non-scaling-stroke"
                        />
                      </>
                    ) : clusterLayout === 'split-4' || clusterLayout === 'overflow' ? (
                      <>
                        <line
                          x1="0"
                          y1={-innerRadius}
                          x2="0"
                          y2={innerRadius}
                          stroke={FRIEND_CLUSTER_DIVIDER_STROKE}
                          strokeWidth="1.2"
                          vectorEffect="non-scaling-stroke"
                        />
                        <line
                          x1={-innerRadius}
                          y1="0"
                          x2={innerRadius}
                          y2="0"
                          stroke={FRIEND_CLUSTER_DIVIDER_STROKE}
                          strokeWidth="1.2"
                          vectorEffect="non-scaling-stroke"
                        />
                      </>
                    ) : (
                      <text
                        x="0"
                        y="0"
                        textAnchor="middle"
                        dominantBaseline="middle"
                        fill="white"
                        fontSize="10"
                        fontWeight="700"
                        fontFamily="ui-sans-serif, system-ui, sans-serif"
                      >
                        {cluster.members.length}
                      </text>
                    )}

                    <circle
                      cx="0"
                      cy="0"
                      r={innerRadius}
                      fill="none"
                      stroke="white"
                      strokeWidth="2"
                      vectorEffect="non-scaling-stroke"
                    />
                  </>
                )}

                {isHovered ? (
                  <g transform={`translate(${-(estimatedLabelWidth / 2)} ${-(outerRadius + 22)})`} pointerEvents="none">
                    <rect
                      x="0"
                      y="0"
                      width={estimatedLabelWidth}
                      height="20"
                      rx="10"
                      fill="rgba(2,6,23,0.92)"
                      stroke="rgba(56,189,248,0.65)"
                      strokeWidth="1"
                      vectorEffect="non-scaling-stroke"
                    />
                    <text
                      x={estimatedLabelWidth / 2}
                      y="10"
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fill="#e2e8f0"
                      fontSize="10"
                      fontWeight="700"
                      fontFamily="ui-sans-serif, system-ui, sans-serif"
                    >
                      {labelText}
                    </text>
                  </g>
                ) : null}

                <circle
                  cx="0"
                  cy="0"
                  r={outerRadius + 4}
                  fill="transparent"
                  style={{ cursor: firstMember.icao24 ? 'pointer' : 'default' }}
                  onMouseEnter={() => setHoveredClusterKey(clusterKey)}
                  onMouseLeave={() => setHoveredClusterKey(null)}
                  onClick={() => {
                    const icao24 = firstMember.icao24;
                    if (icao24) {
                      onSelectFlight?.(icao24);
                    }
                  }}
                />
              </g>
            );
          })}

          {hoveredAirport ? (
            <g
              transform={getFixedSizeTransform(hoveredAirport.point, mapTransform.k)}
              pointerEvents="none"
            >
              <g transform={`translate(${-(hoveredAirportLabelWidth / 2)} -24)`}>
                <rect
                  x="0"
                  y="0"
                  width={hoveredAirportLabelWidth}
                  height="18"
                  rx="9"
                  fill="rgba(2,6,23,0.88)"
                  stroke={AIRPORT_MARKER_COLOR}
                  strokeWidth="0.9"
                  vectorEffect="non-scaling-stroke"
                />
                <text
                  x={hoveredAirportLabelWidth / 2}
                  y="9"
                  fill="#e2e8f0"
                  fontSize="9.5"
                  fontWeight="700"
                  fontFamily="ui-sans-serif, system-ui, sans-serif"
                  textAnchor="middle"
                  dominantBaseline="middle"
                >
                  {hoveredAirport.code}
                </text>
              </g>
            </g>
          ) : null}
        </g>
      </svg>

      {flights.length === 0 && emptyOverlayMessage ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6">
          <div className="max-w-md rounded-2xl border border-white/10 bg-slate-950/70 px-5 py-4 text-center text-sm text-slate-300 backdrop-blur-sm">
            {emptyOverlayMessage}
          </div>
        </div>
      ) : null}
    </div>
  );
}
