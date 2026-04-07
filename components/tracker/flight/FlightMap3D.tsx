'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTrackerLayout } from '../contexts/TrackerLayoutContext';
import { useTrackerMap } from '../contexts/TrackerMapContext';
import { getFlightMapColor, getReadableTextColor, SELECTED_FLIGHT_COLOR } from './colors';
import { getFriendInitials } from '~/lib/utils/friendInitials';
import type { FlightMapAirportMarker, FlightMapPoint, FriendAvatarInfo, FriendAvatarMarker, SelectedFlightDetails, TrackedFlight } from './types';

const DEFAULT_ALT = 1.65;
const MOBILE_ALT = 1.95;
const FOCUS_ALT = 1.15;
const INITIAL_LNG = -20;
const INITIAL_LAT = 15;
const OCEAN_COLOR = '#071a31';
const COUNTRY_ALTITUDE = 0.0035;
const ROUTE_SHADOW_COLOR = '#081120';
const ROUTE_SHADOW_ALTITUDE = COUNTRY_ALTITUDE + 0.0008;
const DEPARTURE_MARKER_COLOR = '#f59e0b';
const ARRIVAL_MARKER_COLOR = '#22d3ee';
const SHARED_AIRPORT_MARKER_COLOR = '#a855f7';
const DEPARTURE_MARKER_ALTITUDE = COUNTRY_ALTITUDE + 0.006;
const PATH_ALTITUDE_OFFSET = 0.006;
const FORECAST_PATH_ALTITUDE = COUNTRY_ALTITUDE + 0.0016;
const PATH_STROKE = 0.9;
const SELECTED_PATH_STROKE = 1.7;
const PATH_SHADOW_STROKE = 1.08;
const SELECTED_PATH_SHADOW_STROKE = 1.95;
const FORECAST_PATH_STROKE = 0.62;
const FORECAST_PATH_DASH_LENGTH = 0.07;
const FORECAST_PATH_DASH_GAP = 0.08;
const FORECAST_PATH_DASH_ANIMATE_TIME = 1600;
const POINT_MARKER_ALTITUDE = COUNTRY_ALTITUDE + 0.0012;
const SELECTED_POINT_MARKER_ALTITUDE = COUNTRY_ALTITUDE + 0.0016;
const POINT_ALTITUDE_OFFSET = 0.018;
const SELECTED_POINT_ALTITUDE_OFFSET = 0.03;
const ALTITUDE_GUIDE_STROKE = 0.14;
const ALTITUDE_GUIDE_TOP_OVERLAP = 0.0008;
const ALTITUDE_GUIDE_COLOR = ['rgba(255,255,255,0.82)', 'rgba(255,255,255,0.34)', 'rgba(255,255,255,0.14)'];
const PATH_POINT_DUPLICATE_DISTANCE_KM = 12;
const GROUND_RING_ALTITUDE = COUNTRY_ALTITUDE + 0.001;
const FRIEND_AVATAR_CLUSTER_DEGREES = 2.5;
const FRIEND_AVATAR_ALTITUDE = DEPARTURE_MARKER_ALTITUDE + 0.006;
const FRIEND_CLUSTER_FALLBACK_FILL = 'rgba(15,23,42,0.94)';
const FRIEND_CLUSTER_DIVIDER_STROKE = 'rgba(255,255,255,0.42)';

type FriendClusterLayout = 'single' | 'split-2' | 'split-3' | 'split-4' | 'overflow';

type FriendClusterSegmentDefinition = {
  left: number;
  top: number;
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
): FriendClusterSegmentDefinition[] {
  if (layout === 'split-2') {
    return [
      { left: 0, top: 0, width: 50, height: 100 },
      { left: 50, top: 0, width: 50, height: 100 },
    ];
  }

  if (layout === 'split-3') {
    return [
      { left: 0, top: 0, width: 50, height: 50 },
      { left: 0, top: 50, width: 50, height: 50 },
      { left: 50, top: 0, width: 50, height: 100 },
    ];
  }

  return [
    { left: 0, top: 0, width: 50, height: 50 },
    { left: 50, top: 0, width: 50, height: 50 },
    { left: 0, top: 50, width: 50, height: 50 },
    { left: 50, top: 50, width: 50, height: 50 },
  ];
}

interface FlightMap3DProps {
  flights: TrackedFlight[];
  selectedIcao24: string | null;
  selectedFlightDetails?: SelectedFlightDetails | null;
  airportMarkers?: FlightMapAirportMarker[];
  onSelectFlight?: (icao24: string) => void;
  onInitialZoomEnd?: () => void;
  selectionMode?: 'single' | 'all';
  flightColorIndexes?: ReadonlyMap<string, number>;
  flightColors?: ReadonlyMap<string, string>;
  flightLabels?: Record<string, string>;
  flightAvatars?: Record<string, FriendAvatarInfo[]>;
  staticFriendMarkers?: FriendAvatarMarker[];
}

interface GlobePointDatum {
  icao24: string;
  callsign: string;
  label: string;
  lat: number;
  lng: number;
  altitude: number;
  flightAltitude: number;
  color: string;
  selected: boolean;
}

interface GlobePathDatum {
  id: string;
  color: string | string[];
  selected: boolean;
  variant: 'main' | 'shadow' | 'forecast' | 'guide';
  points: Array<{ lat: number; lng: number; alt: number }>;
}

interface GlobeLabelDatum {
  type: 'label';
  lat: number;
  lng: number;
  altitude: number;
  text: string;
  color: string;
}

interface GlobeDepartureMarkerDatum {
  type: 'departure';
  icao24: string;
  lat: number;
  lng: number;
  altitude: number;
  color: string;
  selected: boolean;
}

interface GlobePlaneMarkerDatum {
  type: 'plane';
  icao24: string;
  lat: number;
  lng: number;
  altitude: number;
  color: string;
  selected: boolean;
}

interface GlobeAirportMarkerDatum {
  type: 'airport';
  id: string;
  code: string;
  label: string;
  lat: number;
  lng: number;
  altitude: number;
  color: string;
  usage: FlightMapAirportMarker['usage'];
}

interface GlobeFriendAvatarDatum {
  type: 'friend-avatar';
  key: string;
  lat: number;
  lng: number;
  altitude: number;
  members: Array<{ friendId: string; name: string; avatarUrl: string | null; color: string; isStale?: boolean }>;
  onSelect?: string;
}

type GlobeHtmlDatum = GlobeLabelDatum | GlobeDepartureMarkerDatum | GlobePlaneMarkerDatum | GlobeAirportMarkerDatum | GlobeFriendAvatarDatum;

interface GlobeRingDatum {
  lat: number;
  lng: number;
  color: string;
  altitude: number;
}

function getAltitudeRatio(point: FlightMapPoint | null): number {
  if (!point?.altitude || point.altitude <= 0) {
    return 0.012;
  }

  return Math.min(0.16, Math.max(0.012, point.altitude / 160_000));
}

function getFlightDisplayAltitude(point: FlightMapPoint | null, selected: boolean): number {
  if (!point || point.onGround || (point.altitude ?? 0) <= 0) {
    return selected ? SELECTED_POINT_MARKER_ALTITUDE : POINT_MARKER_ALTITUDE;
  }

  return getAltitudeRatio(point) + (selected ? SELECTED_POINT_ALTITUDE_OFFSET : POINT_ALTITUDE_OFFSET);
}

function getRoutePathAltitude(point: FlightMapPoint | null, emphasized: boolean): number {
  const altitudeOffset = emphasized ? SELECTED_POINT_ALTITUDE_OFFSET : PATH_ALTITUDE_OFFSET;
  return getAltitudeRatio(point) + altitudeOffset;
}

interface FriendGeoMarker {
  key: string;
  lat: number;
  lng: number;
  friendId: string;
  name: string;
  avatarUrl: string | null;
  color: string;
  icao24?: string;
  isStale?: boolean;
}

function clusterFriendGeoMarkers(
  markers: FriendGeoMarker[],
  radiusDegrees: number,
): Array<{ lat: number; lng: number; members: FriendGeoMarker[] }> {
  if (markers.length === 0) {
    return [];
  }

  const clusters: Array<{ lat: number; lng: number; members: FriendGeoMarker[] }> = [];
  const assigned = new Set<string>();

  for (const marker of markers) {
    if (assigned.has(marker.key)) {
      continue;
    }

    const members: FriendGeoMarker[] = [marker];
    assigned.add(marker.key);

    for (const other of markers) {
      if (other.key === marker.key || assigned.has(other.key)) {
        continue;
      }

      const dist = Math.hypot(marker.lat - other.lat, marker.lng - other.lng);
      if (dist <= radiusDegrees) {
        members.push(other);
        assigned.add(other.key);
      }
    }

    const clat = members.reduce((sum, m) => sum + m.lat, 0) / members.length;
    const clng = members.reduce((sum, m) => sum + m.lng, 0) / members.length;
    clusters.push({ lat: clat, lng: clng, members });
  }

  return clusters;
}

function getPointDistanceKm(first: FlightMapPoint | null, second: FlightMapPoint | null): number {
  if (!first || !second) {
    return Number.POSITIVE_INFINITY;
  }

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

function isPointNear(first: FlightMapPoint | null, second: FlightMapPoint | null, maxDistanceKm = 80): boolean {
  return getPointDistanceKm(first, second) <= maxDistanceKm;
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

function getRecentRouteBearing(flight: TrackedFlight, currentPoint: FlightMapPoint): number | null {
  for (let index = flight.track.length - 1; index >= 0; index -= 1) {
    const candidate = flight.track[index];
    if (candidate && getPointDistanceKm(candidate, currentPoint) > 8) {
      return getBearingBetweenPoints(candidate, currentPoint);
    }
  }

  if (flight.originPoint && getPointDistanceKm(flight.originPoint, currentPoint) > 8) {
    return getBearingBetweenPoints(flight.originPoint, currentPoint);
  }

  return null;
}

function interpolateHeadingDegrees(start: number, end: number, factor: number): number {
  const delta = (((end - start) % 360) + 540) % 360 - 180;
  return (start + delta * clamp(factor, 0, 1) + 360) % 360;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function getSharedAirportMarkerColor(): string {
  return SHARED_AIRPORT_MARKER_COLOR;
}

function unwrapLongitude(value: number, reference: number): number {
  let result = value;

  while (result - reference > 180) {
    result -= 360;
  }

  while (result - reference < -180) {
    result += 360;
  }

  return result;
}

function interpolateNullableNumber(start: number | null, end: number | null, t: number): number | null {
  if (start == null && end == null) {
    return null;
  }

  if (start == null) {
    return end;
  }

  if (end == null) {
    return start;
  }

  return start + (end - start) * t;
}

function interpolateFlightPathPoint(start: FlightMapPoint, end: FlightMapPoint, t: number): FlightMapPoint {
  const safeT = clamp(t, 0, 1);
  const startLongitude = start.longitude;
  const endLongitude = unwrapLongitude(end.longitude, startLongitude);

  return {
    time: interpolateNullableNumber(start.time, end.time, safeT),
    latitude: start.latitude + (end.latitude - start.latitude) * safeT,
    longitude: normalizeLongitude(startLongitude + (endLongitude - startLongitude) * safeT),
    x: 0,
    y: 0,
    altitude: interpolateNullableNumber(start.altitude, end.altitude, safeT),
    heading: interpolateNullableNumber(start.heading, end.heading, safeT),
    onGround: safeT < 0.5 ? start.onGround : end.onGround,
  };
}

function getPointToward(start: FlightMapPoint, end: FlightMapPoint, distanceKm: number): FlightMapPoint {
  const segmentLength = getPointDistanceKm(start, end);

  if (!Number.isFinite(segmentLength) || segmentLength < 0.01 || distanceKm <= 0) {
    return { ...start };
  }

  const ratio = Math.min(1, distanceKm / segmentLength);
  return interpolateFlightPathPoint(start, end, ratio);
}

function getQuadraticCurvePoint(start: FlightMapPoint, control: FlightMapPoint, end: FlightMapPoint, t: number): FlightMapPoint {
  const safeT = clamp(t, 0, 1);
  const inverseT = 1 - safeT;
  const startLongitude = start.longitude;
  const controlLongitude = unwrapLongitude(control.longitude, startLongitude);
  const endLongitude = unwrapLongitude(end.longitude, controlLongitude);

  return {
    time: interpolateNullableNumber(start.time, end.time, safeT),
    latitude: (inverseT ** 2 * start.latitude) + (2 * inverseT * safeT * control.latitude) + (safeT ** 2 * end.latitude),
    longitude: normalizeLongitude(
      (inverseT ** 2 * startLongitude) + (2 * inverseT * safeT * controlLongitude) + (safeT ** 2 * endLongitude),
    ),
    x: 0,
    y: 0,
    altitude: interpolateNullableNumber(start.altitude, end.altitude, safeT),
    heading: interpolateNullableNumber(start.heading, end.heading, safeT),
    onGround: safeT < 0.5 ? start.onGround : end.onGround,
  };
}

function smoothForecastPathPoints(points: FlightMapPoint[]): FlightMapPoint[] {
  if (points.length < 3) {
    return points;
  }

  const smoothed: FlightMapPoint[] = [{ ...points[0]! }];

  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1]!;
    const current = points[index]!;
    const next = points[index + 1]!;
    const incomingLength = getPointDistanceKm(previous, current);
    const outgoingLength = getPointDistanceKm(current, next);

    if (!Number.isFinite(incomingLength) || !Number.isFinite(outgoingLength) || incomingLength < 1 || outgoingLength < 1) {
      smoothed.push({ ...current });
      continue;
    }

    const easingDistance = clamp(Math.min(incomingLength, outgoingLength) * 0.22, 24, 140);
    const entry = getPointToward(current, previous, easingDistance);
    const exit = getPointToward(current, next, easingDistance);

    smoothed.push(entry);

    for (let sample = 1; sample <= 5; sample += 1) {
      smoothed.push(getQuadraticCurvePoint(entry, current, exit, sample / 6));
    }

    smoothed.push(exit);
  }

  smoothed.push({ ...points.at(-1)! });

  return smoothed.filter((point, index) => {
    const previous = smoothed[index - 1];
    return !previous
      || Math.abs(previous.latitude - point.latitude) > 0.00001
      || Math.abs(previous.longitude - point.longitude) > 0.00001;
  });
}

function createFlightPathPoint({
  latitude,
  longitude,
  time = null,
  altitude = 0,
  heading = null,
  onGround = false,
}: {
  latitude: number;
  longitude: number;
  time?: number | null;
  altitude?: number | null;
  heading?: number | null;
  onGround?: boolean;
}): FlightMapPoint | null {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return {
    time,
    latitude,
    longitude,
    x: 0,
    y: 0,
    altitude,
    heading,
    onGround,
  };
}

function projectForecastHeadingPoint({
  start,
  heading,
  distanceKm,
}: {
  start: FlightMapPoint;
  heading: number;
  distanceKm: number;
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

  return createFlightPathPoint({
    latitude: toDegrees(projectedLatitude),
    longitude: normalizeLongitude(toDegrees(projectedLongitude)),
    time: start.time,
    altitude: start.altitude,
    heading,
    onGround: false,
  });
}

function getForecastPathPoints({
  flight,
  selectedFlightDetails,
}: {
  flight: TrackedFlight;
  selectedFlightDetails: SelectedFlightDetails | null | undefined;
}): FlightMapPoint[] {
  const currentPoint = flight.current ?? flight.track.at(-1) ?? null;
  if (!currentPoint || currentPoint.onGround) {
    return [];
  }

  const arrivalAirport = selectedFlightDetails?.arrivalAirport;
  const arrivalPoint = arrivalAirport?.latitude != null && arrivalAirport?.longitude != null
    ? createFlightPathPoint({
        latitude: arrivalAirport.latitude,
        longitude: arrivalAirport.longitude,
        time: flight.route.lastSeen,
        altitude: 0,
        onGround: true,
      })
    : null;

  const distanceToArrivalKm = arrivalPoint ? getPointDistanceKm(currentPoint, arrivalPoint) : null;
  const bearingToArrival = arrivalPoint ? getBearingBetweenPoints(currentPoint, arrivalPoint) : null;
  const routeBearing = getRecentRouteBearing(flight, currentPoint);
  const liveHeading = flight.heading ?? currentPoint.heading ?? routeBearing ?? null;
  const forecastBaseHeading = routeBearing ?? liveHeading ?? bearingToArrival;
  const headingDeltaToArrival = forecastBaseHeading != null && bearingToArrival != null
    ? getHeadingDeltaDegrees(forecastBaseHeading, bearingToArrival)
    : 0;
  const arrivalBlendFactor = bearingToArrival != null && distanceToArrivalKm != null
    ? clamp(
        0.12
          + (1 - clamp(distanceToArrivalKm / 2200, 0, 1)) * 0.22
          + clamp(headingDeltaToArrival / 180, 0, 1) * 0.18,
        0.12,
        0.52,
      )
    : 0;
  const forecastHeading = forecastBaseHeading != null && bearingToArrival != null
    ? interpolateHeadingDegrees(forecastBaseHeading, bearingToArrival, arrivalBlendFactor)
    : forecastBaseHeading ?? bearingToArrival;

  if (forecastHeading == null) {
    return arrivalPoint ? [currentPoint, arrivalPoint] : [];
  }

  const speedKmh = flight.velocity != null && Number.isFinite(flight.velocity) ? flight.velocity * 3.6 : 820;
  const leadDistanceKm = clamp(speedKmh * 0.55, 260, 880);
  const guidedLeadDistanceKm = distanceToArrivalKm != null
    ? clamp(
        Math.min(leadDistanceKm, Math.max(distanceToArrivalKm * 0.7, Math.min(160, distanceToArrivalKm * 0.45))),
        14,
        leadDistanceKm,
      )
    : leadDistanceKm;
  const leadPoint = projectForecastHeadingPoint({
    start: currentPoint,
    heading: forecastHeading,
    distanceKm: guidedLeadDistanceKm,
  });

  const forecastPoints: Array<FlightMapPoint | null> = [currentPoint, leadPoint];

  if (arrivalPoint) {
    const approachHeading = bearingToArrival ?? forecastHeading;
    const approachDistanceKm = distanceToArrivalKm != null
      ? clamp(Math.min(guidedLeadDistanceKm * 0.45, Math.max(distanceToArrivalKm * 0.28, 8)), 8, 120)
      : 60;
    const approachPoint = projectForecastHeadingPoint({
      start: arrivalPoint,
      heading: (approachHeading + 180) % 360,
      distanceKm: approachDistanceKm,
    });

    forecastPoints.push(approachPoint, arrivalPoint);
  } else {
    forecastPoints.push(projectForecastHeadingPoint({
      start: leadPoint ?? currentPoint,
      heading: forecastHeading,
      distanceKm: clamp(leadDistanceKm * 0.9, 120, 420),
    }));
  }

  const seen = new Set<string>();
  return forecastPoints
    .filter((point): point is FlightMapPoint => Boolean(point))
    .filter((point) => {
      const key = `${point.time ?? 'na'}:${point.latitude.toFixed(4)}:${point.longitude.toFixed(4)}`;
      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });
}

function getFlightPointVisitKey(point: FlightMapPoint): string {
  return `${point.latitude.toFixed(2)}:${point.longitude.toFixed(2)}:${point.onGround ? 'g' : 'a'}`;
}

function dedupeFlightPoints(points: Array<FlightMapPoint | null>): FlightMapPoint[] {
  const orderedPoints = points.filter((point): point is FlightMapPoint => Boolean(point));
  const deduped: FlightMapPoint[] = [];
  const seenVisitKeys = new Set<string>();

  orderedPoints.forEach((point, index) => {
    const isEndpoint = index === 0 || index === orderedPoints.length - 1;
    const previous = deduped.at(-1) ?? null;

    if (!isEndpoint && previous && getPointDistanceKm(previous, point) <= PATH_POINT_DUPLICATE_DISTANCE_KM) {
      return;
    }

    const visitKey = getFlightPointVisitKey(point);
    if (!isEndpoint && seenVisitKeys.has(visitKey)) {
      return;
    }

    seenVisitKeys.add(visitKey);
    deduped.push(point);
  });

  return deduped;
}

function createAirportPoint(
  airport: SelectedFlightDetails['departureAirport'] | SelectedFlightDetails['arrivalAirport'] | null | undefined,
  time: number | null,
): FlightMapPoint | null {
  if (airport?.latitude == null || airport?.longitude == null) {
    return null;
  }

  return createFlightPathPoint({
    time,
    latitude: airport.latitude,
    longitude: airport.longitude,
    altitude: 0,
    heading: null,
    onGround: true,
  });
}

function buildFlightPathData(
  flight: TrackedFlight,
  details: SelectedFlightDetails | null | undefined,
  selected: boolean,
  color: string,
): GlobePathDatum[] {
  const matchingDetails = details?.icao24 === flight.icao24 ? details : null;
  const observedPoints = selected
    ? dedupeFlightPoints([flight.originPoint, ...flight.track, flight.current])
    : dedupeFlightPoints([flight.current ?? flight.track.at(-1) ?? flight.originPoint]);
  const firstObservedPoint = observedPoints[0] ?? null;
  const departurePoint = createAirportPoint(
    matchingDetails?.departureAirport,
    flight.route.firstSeen ?? (firstObservedPoint?.time != null ? firstObservedPoint.time - 1 : null),
  );
  const arrivalPoint = createAirportPoint(matchingDetails?.arrivalAirport, flight.route.lastSeen ?? flight.lastContact ?? null);

  let historyPoints = observedPoints;

  if (departurePoint) {
    if (!firstObservedPoint) {
      historyPoints = dedupeFlightPoints([departurePoint, arrivalPoint]);
    } else if (isPointNear(departurePoint, firstObservedPoint, 90)) {
      historyPoints = dedupeFlightPoints([departurePoint, ...observedPoints.slice(1)]);
    } else {
      historyPoints = dedupeFlightPoints([departurePoint, ...observedPoints]);
    }
  }

  if (!selected) {
    historyPoints = dedupeFlightPoints([departurePoint ?? flight.originPoint, flight.current ?? observedPoints.at(-1) ?? null]);
  }

  const lastObservedPoint = observedPoints.at(-1) ?? departurePoint ?? flight.current ?? flight.originPoint ?? null;
  const nearDeparture = isPointNear(lastObservedPoint, departurePoint, 90);
  const nearArrival = isPointNear(lastObservedPoint, arrivalPoint, 90);
  const showForecastPreview = Boolean(selected && lastObservedPoint && !lastObservedPoint.onGround);
  const shouldIncludeArrivalInMainPath = Boolean(arrivalPoint && flight.onGround && nearArrival && !nearDeparture);
  const mainPoints = shouldIncludeArrivalInMainPath
    ? dedupeFlightPoints([...historyPoints, arrivalPoint])
    : historyPoints;

  const paths: GlobePathDatum[] = [];

  const highlightedSegmentStartIndex = selected && lastObservedPoint && !lastObservedPoint.onGround
    ? Math.max(0, mainPoints.length - 2)
    : Number.POSITIVE_INFINITY;
  const liveRouteAltitude = lastObservedPoint && !lastObservedPoint.onGround
    ? getRoutePathAltitude(lastObservedPoint, true)
    : FORECAST_PATH_ALTITUDE;

  if (mainPoints.length >= 2) {
    paths.push(
      {
        id: `${flight.icao24}:shadow`,
        color: ROUTE_SHADOW_COLOR,
        selected,
        variant: 'shadow',
        points: mainPoints.map((point) => ({
          lat: point.latitude,
          lng: point.longitude,
          alt: ROUTE_SHADOW_ALTITUDE,
        })),
      },
      {
        id: `${flight.icao24}:main`,
        color,
        selected,
        variant: 'main',
        points: mainPoints.map((point, index) => {
          const isHighlightedAirborneSegment = index >= highlightedSegmentStartIndex && !point.onGround;

          return {
            lat: point.latitude,
            lng: point.longitude,
            alt: isHighlightedAirborneSegment ? liveRouteAltitude : getRoutePathAltitude(point, false),
          };
        }),
      },
    );
  }

  const forecastPoints = showForecastPreview
    ? getForecastPathPoints({
        flight,
        selectedFlightDetails: matchingDetails,
      })
    : [];

  if (forecastPoints.length > 1) {
    const smoothedForecastPoints = smoothForecastPathPoints(forecastPoints);
    const forecastPathAltitude = lastObservedPoint && !lastObservedPoint.onGround
      ? liveRouteAltitude
      : FORECAST_PATH_ALTITUDE;

    paths.push({
      id: `${flight.icao24}:forecast`,
      color,
      selected,
      variant: 'forecast',
      points: smoothedForecastPoints.map((point) => ({
        lat: point.latitude,
        lng: point.longitude,
        alt: forecastPathAltitude,
      })),
    });
  }

  if (selected && lastObservedPoint && !lastObservedPoint.onGround && (lastObservedPoint.altitude ?? 0) > 0) {
    const guideBaseAltitude = SELECTED_POINT_MARKER_ALTITUDE;
    const guideTopAltitude = liveRouteAltitude + ALTITUDE_GUIDE_TOP_OVERLAP;

    paths.push({
      id: `${flight.icao24}:guide`,
      color: ALTITUDE_GUIDE_COLOR,
      selected,
      variant: 'guide',
      points: [
        { lat: lastObservedPoint.latitude, lng: lastObservedPoint.longitude, alt: guideBaseAltitude },
        { lat: lastObservedPoint.latitude, lng: lastObservedPoint.longitude, alt: guideTopAltitude },
      ],
    });
  }

  return paths;
}

export default function FlightMap3D({
  flights,
  selectedIcao24,
  selectedFlightDetails,
  airportMarkers = [],
  onSelectFlight,
  onInitialZoomEnd,
  selectionMode = 'single',
  flightColorIndexes,
  flightColors,
  flightLabels,
  flightAvatars,
  staticFriendMarkers,
}: FlightMap3DProps) {
  const { isMobile } = useTrackerLayout();
  const { setGlobeRef } = useTrackerMap();
  const containerRef = useRef<HTMLDivElement>(null);
  const globeRef = useRef<any>(null);
  const lastAutoFocusKeyRef = useRef<string | null>(null);
  const setGlobeRefRef = useRef(setGlobeRef);
  const onInitialZoomEndRef = useRef(onInitialZoomEnd);
  const [globeReady, setGlobeReady] = useState(false);

  useEffect(() => {
    setGlobeRefRef.current = setGlobeRef;
  }, [setGlobeRef]);

  useEffect(() => {
    onInitialZoomEndRef.current = onInitialZoomEnd;
  }, [onInitialZoomEnd]);

  const friendIcao24Set = useMemo(() => {
    if (!flightAvatars) {
      return new Set<string>();
    }

    return new Set(Object.keys(flightAvatars));
  }, [flightAvatars]);

  const friendAvatarClusters = useMemo<GlobeFriendAvatarDatum[]>(() => {
    const geoMarkers: FriendGeoMarker[] = [];

    if (flightAvatars) {
      for (const flight of flights) {
        const avatarInfos = flightAvatars[flight.icao24];
        if (!avatarInfos?.length) {
          continue;
        }

        const currentPoint = flight.current ?? flight.track.at(-1) ?? flight.originPoint;
        if (!currentPoint) {
          continue;
        }

        for (const info of avatarInfos) {
          geoMarkers.push({
            key: `fly-${info.friendId}-${flight.icao24}`,
            lat: currentPoint.latitude,
            lng: currentPoint.longitude,
            friendId: info.friendId,
            name: info.name,
            avatarUrl: info.avatarUrl,
            color: info.color,
            icao24: flight.icao24,
            isStale: info.isStale === true,
          });
        }
      }
    }

    if (staticFriendMarkers) {
      for (const marker of staticFriendMarkers) {
        geoMarkers.push({
          key: `static-${marker.id}`,
          lat: marker.latitude,
          lng: marker.longitude,
          friendId: marker.id,
          name: marker.name,
          avatarUrl: marker.avatarUrl,
          color: marker.color,
          isStale: marker.isStale === true,
        });
      }
    }

    const clusters = clusterFriendGeoMarkers(geoMarkers, FRIEND_AVATAR_CLUSTER_DEGREES);

    return clusters.map((cluster) => ({
      type: 'friend-avatar' as const,
      key: cluster.members.map((m) => m.key).join('|'),
      lat: cluster.lat,
      lng: cluster.lng,
      altitude: FRIEND_AVATAR_ALTITUDE,
      members: cluster.members.map((m) => ({
        friendId: m.friendId,
        name: m.name,
        avatarUrl: m.avatarUrl,
        color: m.color,
        isStale: m.isStale === true,
      })),
      onSelect: cluster.members.find((m) => m.icao24)?.icao24,
    }));
  }, [flightAvatars, flights, staticFriendMarkers]);

  const pointData = useMemo(() => {
    return flights
      .map((flight, index) => {
        const currentPoint = flight.current ?? flight.track.at(-1) ?? flight.originPoint;
        if (!currentPoint) {
          return null;
        }

        const selected = selectionMode === 'single' && flight.icao24 === selectedIcao24;
        const highlighted = selectionMode === 'all' || selected;
        const flightAltitude = getFlightDisplayAltitude(currentPoint, highlighted);
        const colorIndex = flightColorIndexes?.get(flight.icao24) ?? index;
        const defaultColor = flightColors?.get(flight.icao24) ?? getFlightMapColor(colorIndex, false);

        return {
          icao24: flight.icao24,
          callsign: flight.callsign,
          label: flightLabels?.[flight.icao24]?.trim() || flight.callsign,
          lat: currentPoint.latitude,
          lng: currentPoint.longitude,
          altitude: highlighted ? SELECTED_POINT_MARKER_ALTITUDE : POINT_MARKER_ALTITUDE,
          flightAltitude,
          color: selected ? SELECTED_FLIGHT_COLOR : defaultColor,
          selected: highlighted,
        } satisfies GlobePointDatum;
      })
      .filter((point): point is GlobePointDatum => Boolean(point));
  }, [flightColorIndexes, flightColors, flightLabels, flights, selectedIcao24, selectionMode]);

  const activeRouteIcao24 = useMemo(() => {
    if (selectionMode !== 'single') {
      return null;
    }

    return flights.find((flight) => flight.icao24 === selectedIcao24)?.icao24
      ?? flights[0]?.icao24
      ?? null;
  }, [flights, selectedIcao24, selectionMode]);

  const pathData = useMemo(() => {
    if (selectionMode === 'all') {
      return flights.flatMap((flight, index) => {
        const matchingDetails = selectedFlightDetails?.icao24 === flight.icao24 ? selectedFlightDetails : null;
        const colorIndex = flightColorIndexes?.get(flight.icao24) ?? index;
        const defaultColor = flightColors?.get(flight.icao24) ?? getFlightMapColor(colorIndex, false);
        return buildFlightPathData(flight, matchingDetails, true, defaultColor);
      });
    }

    if (!activeRouteIcao24) {
      return [];
    }

    const activeFlight = flights.find((flight) => flight.icao24 === activeRouteIcao24);
    if (!activeFlight) {
      return [];
    }

    const colorIndex = flightColorIndexes?.get(activeRouteIcao24)
      ?? Math.max(0, flights.findIndex((flight) => flight.icao24 === activeRouteIcao24));
    return buildFlightPathData(activeFlight, selectedFlightDetails, true, SELECTED_FLIGHT_COLOR || getFlightMapColor(colorIndex, true));
  }, [activeRouteIcao24, flightColorIndexes, flightColors, flights, selectedFlightDetails, selectionMode]);

  const labelData = useMemo(() => {
    const labels = selectionMode === 'all'
      ? pointData.filter((point) => !friendIcao24Set.has(point.icao24))
      : pointData.filter((point) => point.selected || pointData.length === 1);

    return labels.map((point) => ({
      type: 'label' as const,
      lat: point.lat,
      lng: point.lng,
      altitude: Math.max(0.035, point.flightAltitude + 0.012),
      text: point.label,
      color: point.color,
    })) satisfies GlobeLabelDatum[];
  }, [friendIcao24Set, pointData, selectionMode]);

  const sharedAirportMarkerData = useMemo(() => {
    return airportMarkers.map((airport) => ({
      type: 'airport' as const,
      id: airport.id,
      code: airport.code,
      label: airport.label,
      lat: airport.latitude,
      lng: airport.longitude,
      altitude: DEPARTURE_MARKER_ALTITUDE + 0.003,
      color: getSharedAirportMarkerColor(),
      usage: airport.usage,
    })) satisfies GlobeAirportMarkerDatum[];
  }, [airportMarkers]);

  const departureMarkerData = useMemo(() => {
    if (selectionMode === 'all' && sharedAirportMarkerData.length) {
      return [];
    }

    return flights.flatMap((flight) => {
      const selected = selectionMode === 'all' || flight.icao24 === selectedIcao24;
      const matchingDetails = selectedFlightDetails?.icao24 === flight.icao24 ? selectedFlightDetails : null;
      const departurePoint = createAirportPoint(matchingDetails?.departureAirport, flight.route.firstSeen ?? null) ?? flight.originPoint;
      const currentPoint = flight.current ?? flight.track.at(-1) ?? flight.originPoint;

      if (!departurePoint) {
        return [];
      }

      const overlapsCurrentPoint = currentPoint
        && Math.abs(currentPoint.latitude - departurePoint.latitude) < 0.05
        && Math.abs(currentPoint.longitude - departurePoint.longitude) < 0.05;

      if (overlapsCurrentPoint && !currentPoint.onGround) {
        return [];
      }

      return [{
        type: 'departure' as const,
        icao24: flight.icao24,
        lat: departurePoint.latitude,
        lng: departurePoint.longitude,
        altitude: DEPARTURE_MARKER_ALTITUDE + (selected ? 0.002 : 0),
        color: DEPARTURE_MARKER_COLOR,
        selected,
      }] satisfies GlobeDepartureMarkerDatum[];
    });
  }, [flights, selectedFlightDetails, selectedIcao24, selectionMode, sharedAirportMarkerData.length]);

  const planeMarkerData = useMemo(() => {
    return pointData
      .filter((point) => !friendIcao24Set.has(point.icao24))
      .map((point) => ({
        type: 'plane' as const,
        icao24: point.icao24,
        lat: point.lat,
        lng: point.lng,
        altitude: point.altitude,
        color: point.color,
        selected: point.selected,
      })) satisfies GlobePlaneMarkerDatum[];
  }, [friendIcao24Set, pointData]);

  const htmlOverlayData = useMemo(() => {
    return [...sharedAirportMarkerData, ...departureMarkerData, ...planeMarkerData, ...labelData, ...friendAvatarClusters] satisfies GlobeHtmlDatum[];
  }, [departureMarkerData, friendAvatarClusters, labelData, planeMarkerData, sharedAirportMarkerData]);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    let mounted = true;
    lastAutoFocusKeyRef.current = null;
    setGlobeReady(false);
    let removeResizeListener: (() => void) | null = null;
    const container = containerRef.current;

    const init = async () => {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });

      const geoData: GeoJSON.FeatureCollection = await fetch('/maps/world-countries-110m.geojson').then((response) => response.json());
      if (!mounted) {
        return;
      }

      const features = (geoData.features ?? []).filter((feature) => feature.geometry);
      const { default: Globe } = await import('globe.gl');
      if (!mounted || !containerRef.current) {
        return;
      }

      const globe = (Globe as any)({
        animateIn: false,
        waitForGlobeReady: false,
        rendererConfig: { antialias: true, alpha: true },
      })(container);

      globe
        .globeImageUrl('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mPgldYCAACLAFN4VUZsAAAAAElFTkSuQmCC')
        .backgroundColor('rgba(0,0,0,0)')
        .showGraticules(true)
        .showAtmosphere(true)
        .atmosphereColor('#67e8f9')
        .atmosphereAltitude(0.14)
        .polygonsData(features)
        .polygonGeoJsonGeometry((feature: any) => feature.geometry)
        .polygonAltitude(COUNTRY_ALTITUDE)
        .polygonCapColor(() => 'rgba(12,38,66,0.84)')
        .polygonSideColor(() => '#081427')
        .polygonStrokeColor(() => 'rgba(147,197,253,0.28)');

      const globeMaterial = globe.globeMaterial?.();
      if (globeMaterial) {
        globeMaterial.color?.set?.(OCEAN_COLOR);
        globeMaterial.emissive?.set?.(OCEAN_COLOR);
        globeMaterial.emissiveIntensity = 0.2;
        globeMaterial.specular?.set?.('#0b1220');
        globeMaterial.shininess = 2;
        globeMaterial.map = null;
        globeMaterial.needsUpdate = true;
      }

      globe.pointOfView({ lat: INITIAL_LAT, lng: INITIAL_LNG, altitude: isMobile ? MOBILE_ALT : DEFAULT_ALT }, 0);
      globe.width(container.clientWidth).height(container.clientHeight);

      const onResize = () => {
        if (containerRef.current) {
          globe.width(containerRef.current.clientWidth).height(containerRef.current.clientHeight);
        }
      };
      window.addEventListener('resize', onResize);
      removeResizeListener = () => window.removeEventListener('resize', onResize);

      globeRef.current = globe;
      setGlobeRefRef.current(globe);
      setGlobeReady(true);

      window.setTimeout(() => {
        if (mounted) {
          onInitialZoomEndRef.current?.();
        }
      }, 450);
    };

    init().catch(console.error);

    return () => {
      mounted = false;
      removeResizeListener?.();
      setGlobeReady(false);

      if (globeRef.current) {
        const globeInstance = globeRef.current as any;
        globeInstance.pauseAnimation?.();
        globeInstance._destructor?.();
      }

      globeRef.current = null;
      setGlobeRefRef.current(null);

      if (containerRef.current) {
        containerRef.current.replaceChildren();
      }
    };
  }, [isMobile]);

  useEffect(() => {
    if (!globeReady || !globeRef.current) {
      return;
    }

    const globe = globeRef.current as any;

    globe
      .pathsData(pathData)
      .pathPoints((path: GlobePathDatum) => path.points)
      .pathPointLat((point: { lat: number }) => point.lat)
      .pathPointLng((point: { lng: number }) => point.lng)
      .pathPointAlt((point: { alt: number }) => point.alt)
      .pathColor((path: GlobePathDatum) => path.color)
      .pathStroke((path: GlobePathDatum) => {
        if (path.variant === 'shadow') {
          return path.selected ? SELECTED_PATH_SHADOW_STROKE : PATH_SHADOW_STROKE;
        }

        if (path.variant === 'forecast') {
          return FORECAST_PATH_STROKE;
        }

        if (path.variant === 'guide') {
          return ALTITUDE_GUIDE_STROKE;
        }

        return path.selected ? SELECTED_PATH_STROKE : PATH_STROKE;
      })
      .pathDashLength((path: GlobePathDatum) => {
        if (path.variant === 'shadow' || path.variant === 'guide') {
          return 1;
        }

        if (path.variant === 'forecast') {
          return FORECAST_PATH_DASH_LENGTH;
        }

        return path.selected ? 0.96 : 0.84;
      })
      .pathDashGap((path: GlobePathDatum) => {
        if (path.variant === 'shadow' || path.variant === 'guide') {
          return 0;
        }

        if (path.variant === 'forecast') {
          return FORECAST_PATH_DASH_GAP;
        }

        return path.selected ? 0.04 : 0.12;
      })
      .pathDashAnimateTime(() => 0)
      .pathResolution(2)
      .pathTransitionDuration(0);

    globe
      .pointsData(pointData)
      .pointLat((point: GlobePointDatum) => point.lat)
      .pointLng((point: GlobePointDatum) => point.lng)
      .pointAltitude((point: GlobePointDatum) => point.altitude)
      .pointRadius((point: GlobePointDatum) => (point.selected ? 0.26 : 0.18))
      .pointColor((point: GlobePointDatum) => point.color)
      .pointsMerge(false)
      .onPointClick((point: GlobePointDatum | null) => {
        if (point?.icao24) {
          onSelectFlight?.(point.icao24);
        }
      });

    const selectedPoint = selectionMode === 'single'
      ? pointData.find((point) => point.selected) ?? null
      : null;
    const ringData: GlobeRingDatum[] = selectedPoint
      ? [{
          lat: selectedPoint.lat,
          lng: selectedPoint.lng,
          color: selectedPoint.color,
          altitude: GROUND_RING_ALTITUDE,
        }]
      : [];

    globe
      .ringsData(ringData)
      .ringLat((ring: GlobeRingDatum) => ring.lat)
      .ringLng((ring: GlobeRingDatum) => ring.lng)
      .ringAltitude((ring: GlobeRingDatum) => ring.altitude)
      .ringColor((ring: GlobeRingDatum) => () => ring.color)
      .ringMaxRadius(4.2)
      .ringPropagationSpeed(1.6)
      .ringRepeatPeriod(1200);

    globe
      .htmlElementsData(htmlOverlayData)
      .htmlLat((item: GlobeHtmlDatum) => item.lat)
      .htmlLng((item: GlobeHtmlDatum) => item.lng)
      .htmlAltitude((item: GlobeHtmlDatum) => item.altitude)
      .htmlElement((item: GlobeHtmlDatum) => {
        const element = document.createElement('div');

        if (item.type === 'airport') {
          element.style.pointerEvents = 'auto';
          element.style.position = 'relative';
          element.style.width = '0';
          element.style.height = '0';
          element.style.cursor = 'default';
          element.style.transform = 'translate(-50%, -50%)';
          element.style.zIndex = '20';
          element.title = `${item.label} (${item.code})`;

          const marker = document.createElement('div');
          marker.style.position = 'absolute';
          marker.style.left = '0';
          marker.style.top = '0';
          marker.style.width = '10px';
          marker.style.height = '10px';
          marker.style.background = item.color;
          marker.style.border = '2px solid rgba(255,255,255,0.9)';
          marker.style.boxShadow = '0 0 0 4px rgba(14,116,144,0.14), 0 6px 16px rgba(2,6,23,0.35)';
          marker.style.borderRadius = '999px';
          marker.style.transform = 'translate(-50%, -50%)';

          const badge = document.createElement('div');
          badge.textContent = item.code;
          badge.style.pointerEvents = 'none';
          badge.style.position = 'absolute';
          badge.style.left = '0';
          badge.style.top = '-12px';
          badge.style.whiteSpace = 'nowrap';
          badge.style.padding = '2px 8px';
          badge.style.borderRadius = '999px';
          badge.style.fontSize = '10px';
          badge.style.fontWeight = '700';
          badge.style.color = 'rgba(226,232,240,0.96)';
          badge.style.background = 'rgba(2,6,23,0.84)';
          badge.style.border = `1px solid ${item.color}`;
          badge.style.boxShadow = '0 6px 16px rgba(2,6,23,0.28)';
          badge.style.transform = 'translate(-50%, -100%) scale(0.96)';
          badge.style.transformOrigin = 'center bottom';
          badge.style.opacity = '0';
          badge.style.transition = 'opacity 140ms ease, transform 140ms ease';

          element.addEventListener('mouseenter', () => {
            element.style.zIndex = '40';
            badge.style.opacity = '1';
            badge.style.transform = 'translate(-50%, -100%) scale(1)';
          });
          element.addEventListener('mouseleave', () => {
            element.style.zIndex = '20';
            badge.style.opacity = '0';
            badge.style.transform = 'translate(-50%, -100%) scale(0.96)';
          });

          element.append(marker, badge);
          return element;
        }

        if (item.type === 'departure') {
          element.style.pointerEvents = 'auto';
          element.style.cursor = 'pointer';
          element.style.width = item.selected ? '12px' : '10px';
          element.style.height = item.selected ? '12px' : '10px';
          element.style.borderRadius = '999px';
          element.style.background = item.color;
          element.style.border = '2px solid rgba(255,255,255,0.85)';
          element.style.boxShadow = '0 0 0 4px rgba(245,158,11,0.16), 0 6px 16px rgba(2,6,23,0.35)';
          element.style.transform = 'translate(-50%, -50%)';
          element.title = `Select ${item.icao24}`;
          element.addEventListener('click', (event) => {
            event.stopPropagation();
            onSelectFlight?.(item.icao24);
          });
          return element;
        }

        if (item.type === 'plane') {
          element.style.pointerEvents = 'auto';
          element.style.cursor = 'pointer';
          element.style.width = item.selected ? '11px' : '8px';
          element.style.height = item.selected ? '11px' : '8px';
          element.style.borderRadius = '999px';
          element.style.background = item.color;
          element.style.border = item.selected ? '2px solid rgba(255,255,255,0.95)' : '1.5px solid rgba(255,255,255,0.82)';
          element.style.boxShadow = item.selected
            ? `0 0 0 4px color-mix(in srgb, ${item.color} 26%, transparent), 0 6px 16px rgba(2,6,23,0.35)`
            : `0 0 0 2px color-mix(in srgb, ${item.color} 18%, transparent), 0 4px 10px rgba(2,6,23,0.28)`;
          element.style.transform = 'translate(-50%, -50%)';
          element.title = `Select ${item.icao24}`;
          element.addEventListener('click', (event) => {
            event.stopPropagation();
            onSelectFlight?.(item.icao24);
          });
          return element;
        }

        if (item.type === 'friend-avatar') {
          const isSingle = item.members.length === 1;
          const firstMember = item.members[0]!;
          const size = isSingle ? 30 : 36;
          const halfSize = size / 2;
          const staleCount = item.members.filter((member) => member.isStale).length;
          const hasStaleMembers = staleCount > 0;
          const isFullyStale = staleCount === item.members.length;

          element.style.pointerEvents = 'auto';
          element.style.cursor = 'pointer';
          element.style.width = `${size}px`;
          element.style.height = `${size}px`;
          element.style.borderRadius = '50%';
          element.style.transform = 'translate(-50%, -50%)';
          element.style.zIndex = '30';
          element.style.position = 'relative';
          element.style.flexShrink = '0';

          const nameBadge = document.createElement('div');
          nameBadge.style.position = 'absolute';
          nameBadge.style.left = '50%';
          nameBadge.style.top = `-${halfSize + 6}px`;
          nameBadge.style.transform = 'translate(-50%, -100%) scale(0.92)';
          nameBadge.style.transformOrigin = 'center bottom';
          nameBadge.style.whiteSpace = 'nowrap';
          nameBadge.style.padding = '3px 10px';
          nameBadge.style.borderRadius = '999px';
          nameBadge.style.fontSize = '10px';
          nameBadge.style.fontWeight = '700';
          nameBadge.style.color = 'rgba(226,232,240,0.96)';
          nameBadge.style.background = 'rgba(2,6,23,0.92)';
          nameBadge.style.border = '1px solid rgba(56,189,248,0.65)';
          nameBadge.style.boxShadow = '0 4px 12px rgba(2,6,23,0.35)';
          nameBadge.style.pointerEvents = 'none';
          nameBadge.style.opacity = '0';
          nameBadge.style.transition = 'opacity 140ms ease, transform 140ms ease';

          if (isSingle) {
            nameBadge.textContent = firstMember.isStale ? `${firstMember.name} • last known` : firstMember.name;

            const bubble = document.createElement('div');
            bubble.style.width = `${size}px`;
            bubble.style.height = `${size}px`;
            bubble.style.borderRadius = '50%';
            bubble.style.overflow = 'hidden';
            bubble.style.background = firstMember.color;
            bubble.style.border = '2.5px solid rgba(255,255,255,0.95)';
            bubble.style.boxShadow = `0 0 0 3px color-mix(in srgb, ${firstMember.color} 22%, transparent), 0 6px 16px rgba(2,6,23,0.4)`;
            bubble.style.display = 'flex';
            bubble.style.filter = 'none';
            bubble.style.alignItems = 'center';
            bubble.style.justifyContent = 'center';

            if (firstMember.avatarUrl) {
              const img = document.createElement('img');
              img.src = firstMember.avatarUrl;
              img.style.width = '100%';
              img.style.height = '100%';
              img.style.objectFit = 'cover';
              img.alt = firstMember.name;
              bubble.appendChild(img);
            } else {
              const initials = document.createElement('span');
              const initialsColor = getReadableTextColor(firstMember.color, { light: '#ffffff' });
              initials.textContent = getFriendInitials(firstMember.name);
              initials.style.color = initialsColor;
              initials.style.textShadow = initialsColor.startsWith('rgba(15, 23, 42')
                ? '0 1px 1px rgba(255,255,255,0.22)'
                : '0 1px 1px rgba(2,6,23,0.4)';
              initials.style.fontSize = '11px';
              initials.style.fontWeight = '700';
              initials.style.fontFamily = 'ui-sans-serif, system-ui, sans-serif';
              bubble.appendChild(initials);
            }

            element.appendChild(bubble);
          } else {
            const clusterLayout = getFriendClusterLayout(item.members.length);
            const memberLabels = item.members.map((member) => member.isStale ? `${member.name} (last known)` : member.name);
            const clusterNames = item.members.length <= 4
              ? memberLabels.join(', ')
              : `${memberLabels.slice(0, 4).join(', ')} +${item.members.length - 4}`;
            nameBadge.textContent = hasStaleMembers ? `${clusterNames} • ${staleCount} stale` : clusterNames;

            const clusterContainer = document.createElement('div');
            clusterContainer.dataset.clusterLayout = clusterLayout;
            clusterContainer.dataset.clusterSize = String(item.members.length);
            clusterContainer.dataset.clusterStale = isFullyStale ? 'all' : hasStaleMembers ? 'partial' : 'none';
            clusterContainer.style.width = `${size}px`;
            clusterContainer.style.height = `${size}px`;
            clusterContainer.style.borderRadius = '50%';
            clusterContainer.style.position = 'relative';
            clusterContainer.style.background = 'rgba(15,23,42,0.24)';
            clusterContainer.style.border = '2.5px solid rgba(255,255,255,0.95)';
            clusterContainer.style.boxShadow = '0 0 0 3px rgba(15,23,42,0.24), 0 6px 16px rgba(2,6,23,0.4)';
            clusterContainer.style.overflow = 'hidden';
            clusterContainer.style.filter = 'none';

            const fillLayer = document.createElement('div');
            fillLayer.style.position = 'absolute';
            fillLayer.style.inset = '0';
            fillLayer.style.borderRadius = '50%';
            fillLayer.style.overflow = 'hidden';
            fillLayer.style.background = 'rgba(2,6,23,0.9)';

            const segmentDefinitions = getFriendClusterSegmentDefinitions(clusterLayout === 'single' ? 'split-2' : clusterLayout);
            const overflowCount = Math.max(0, item.members.length - 4);
            const overflowSegment = clusterLayout === 'overflow'
              ? segmentDefinitions[3] ?? null
              : null;

            segmentDefinitions.forEach((segment, segmentIndex) => {
              const member = item.members[segmentIndex];
              const segmentElement = document.createElement('div');
              segmentElement.dataset.friendClusterSegment = `${segmentIndex}`;
              segmentElement.style.position = 'absolute';
              segmentElement.style.left = `${segment.left}%`;
              segmentElement.style.top = `${segment.top}%`;
              segmentElement.style.width = `${segment.width}%`;
              segmentElement.style.height = `${segment.height}%`;
              segmentElement.style.background = member?.color ?? FRIEND_CLUSTER_FALLBACK_FILL;
              segmentElement.style.overflow = 'hidden';

              if (member?.avatarUrl) {
                const img = document.createElement('img');
                img.src = member.avatarUrl;
                img.alt = member.name;
                img.style.width = '100%';
                img.style.height = '100%';
                img.style.objectFit = 'cover';
                segmentElement.appendChild(img);
              }

              if (member) {
                const initSpan = document.createElement('span');
                const initialsColor = getReadableTextColor(member.color, { light: '#ffffff' });
                initSpan.textContent = getFriendInitials(member.name).slice(0, 1);
                initSpan.style.position = 'absolute';
                initSpan.style.left = '50%';
                initSpan.style.top = '50%';
                initSpan.style.transform = 'translate(-50%, -50%)';
                initSpan.style.color = initialsColor;
                initSpan.style.textShadow = initialsColor.startsWith('rgba(15, 23, 42')
                  ? '0 1px 1px rgba(255,255,255,0.22)'
                  : '0 1px 1px rgba(2,6,23,0.4)';
                initSpan.style.fontSize = segment.width < 100 || segment.height < 100 ? '8px' : '10px';
                initSpan.style.fontWeight = '800';
                initSpan.style.fontFamily = 'ui-sans-serif, system-ui, sans-serif';
                initSpan.style.pointerEvents = 'none';

                if (member.avatarUrl) {
                  initSpan.style.background = 'rgba(2,6,23,0.68)';
                  initSpan.style.borderRadius = '999px';
                  initSpan.style.padding = '0 3px';
                  initSpan.style.left = 'auto';
                  initSpan.style.right = '2px';
                  initSpan.style.top = 'auto';
                  initSpan.style.bottom = '1px';
                  initSpan.style.transform = 'none';
                  initSpan.style.fontSize = '7px';
                  initSpan.style.lineHeight = '1.2';
                }

                segmentElement.appendChild(initSpan);
              }

              fillLayer.appendChild(segmentElement);
            });

            if (overflowSegment && overflowCount > 0) {
              const overflowOverlay = document.createElement('div');
              overflowOverlay.style.position = 'absolute';
              overflowOverlay.style.left = `${overflowSegment.left}%`;
              overflowOverlay.style.top = `${overflowSegment.top}%`;
              overflowOverlay.style.width = `${overflowSegment.width}%`;
              overflowOverlay.style.height = `${overflowSegment.height}%`;
              overflowOverlay.style.background = 'rgba(2,6,23,0.58)';
              overflowOverlay.style.display = 'flex';
              overflowOverlay.style.alignItems = 'center';
              overflowOverlay.style.justifyContent = 'center';
              overflowOverlay.style.color = 'white';
              overflowOverlay.style.fontSize = '10px';
              overflowOverlay.style.fontWeight = '800';
              overflowOverlay.style.fontFamily = 'ui-sans-serif, system-ui, sans-serif';
              overflowOverlay.textContent = `+${overflowCount}`;
              fillLayer.appendChild(overflowOverlay);
            }

            const dividerLayer = document.createElement('div');
            dividerLayer.style.position = 'absolute';
            dividerLayer.style.inset = '0';
            dividerLayer.style.pointerEvents = 'none';

            const addDivider = (left: string, top: string, width: string, height: string) => {
              const divider = document.createElement('div');
              divider.style.position = 'absolute';
              divider.style.left = left;
              divider.style.top = top;
              divider.style.width = width;
              divider.style.height = height;
              divider.style.background = FRIEND_CLUSTER_DIVIDER_STROKE;
              dividerLayer.appendChild(divider);
            };

            if (clusterLayout === 'split-2') {
              addDivider('50%', '0', '1.2px', '100%');
            } else if (clusterLayout === 'split-3') {
              addDivider('50%', '0', '1.2px', '100%');
              addDivider('0', '50%', '50%', '1.2px');
            } else {
              addDivider('50%', '0', '1.2px', '100%');
              addDivider('0', '50%', '100%', '1.2px');
            }

            clusterContainer.append(fillLayer, dividerLayer);
            element.appendChild(clusterContainer);
          }

          element.appendChild(nameBadge);

          element.addEventListener('mouseenter', () => {
            element.style.zIndex = '50';
            nameBadge.style.opacity = '1';
            nameBadge.style.transform = 'translate(-50%, -100%) scale(1)';
          });
          element.addEventListener('mouseleave', () => {
            element.style.zIndex = '30';
            nameBadge.style.opacity = '0';
            nameBadge.style.transform = 'translate(-50%, -100%) scale(0.92)';
          });
          element.addEventListener('click', (event) => {
            event.stopPropagation();
            if (item.onSelect) {
              onSelectFlight?.(item.onSelect);
            }
          });

          return element;
        }

        element.textContent = item.text;
        element.style.pointerEvents = 'none';
        element.style.whiteSpace = 'nowrap';
        element.style.padding = '4px 10px';
        element.style.borderRadius = '999px';
        element.style.fontSize = '12px';
        element.style.fontWeight = '600';
        element.style.color = 'rgba(226,232,240,0.96)';
        element.style.background = 'rgba(2,6,23,0.72)';
        element.style.border = `1px solid ${item.color}`;
        element.style.boxShadow = '0 6px 16px rgba(2,6,23,0.35)';
        element.style.transform = 'translate(-50%, -120%)';
        return element;
      });
  }, [globeReady, htmlOverlayData, onSelectFlight, pathData, pointData, selectionMode]);

  useEffect(() => {
    if (!globeReady || !globeRef.current) {
      return;
    }

    const focusPoint = selectionMode === 'single'
      ? pointData.find((point) => point.selected) ?? pointData[0] ?? null
      : pointData[0] ?? null;
    const autoFocusKey = selectionMode === 'single'
      ? `single:${selectedIcao24 ?? focusPoint?.icao24 ?? 'none'}:${isMobile ? 'mobile' : 'desktop'}`
      : `all:${focusPoint ? 'ready' : 'empty'}:${isMobile ? 'mobile' : 'desktop'}`;

    if (lastAutoFocusKeyRef.current === autoFocusKey) {
      return;
    }

    lastAutoFocusKeyRef.current = autoFocusKey;
    const globe = globeRef.current as any;

    if (!focusPoint) {
      globe.pointOfView({ lat: INITIAL_LAT, lng: INITIAL_LNG, altitude: isMobile ? MOBILE_ALT : DEFAULT_ALT }, 500);
      return;
    }

    globe.pointOfView(
      {
        lat: focusPoint.lat,
        lng: focusPoint.lng,
        altitude: selectionMode === 'single' && focusPoint.selected ? FOCUS_ALT : (isMobile ? MOBILE_ALT : DEFAULT_ALT),
      },
      800,
    );
  }, [globeReady, isMobile, pointData, selectedIcao24, selectionMode]);

  return (
    <div className="absolute inset-0 z-10">
      <div ref={containerRef} className="absolute inset-0" />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background: 'radial-gradient(circle at 50% 50%, rgba(2,6,23,0) 62%, rgba(2,6,23,0.42) 86%, rgba(2,6,23,0.62) 100%)',
        }}
      />
    </div>
  );
}
