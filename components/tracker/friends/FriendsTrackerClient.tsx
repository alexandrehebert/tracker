'use client';

import { useLocale } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CircleAlert,
  Clock3,
  Globe,
  Map as MapIcon,
  Plane,
  PlaneLanding,
  PlaneTakeoff,
  RefreshCw,
  Settings2,
  Users,
} from 'lucide-react';
import { Link } from '~/i18n/navigation';
import {
  applyAutoLockedFriendFlights,
  buildAirportChain,
  buildFriendFlightStatuses,
  extractFriendTrackerIdentifiers,
  getCurrentTripConfig,
  getCurrentTripLegs,
  normalizeFriendsTrackerConfig,
  parseDestinationAirportCodes,
  type FriendFlightLeg,
  type FriendFlightStatus,
  type FriendsTrackerConfig,
  type FriendTravelConfig,
} from '~/lib/friendsTracker';
import type { WorldMapPayload } from '~/lib/server/worldMap';
import TrackerShell from '../TrackerShell';
import TrackerZoomControls from '../TrackerZoomControls';
import { TrackerLayoutProvider, useTrackerLayout } from '../contexts/TrackerLayoutContext';
import FlightMap from '../flight/FlightMap';
import { getFlightMapColor } from '../flight/colors';
import { FlightMapProvider } from '../flight/contexts/FlightMapProvider';
import FlightMapViewToggle, { type TrackerMapView } from '../flight/FlightMapViewToggle';
import type {
  FlightFetchSnapshot,
  FlightMapAirportMarker,
  FlightMapPoint,
  FriendAvatarInfo,
  FriendAvatarMarker,
  TrackerApiResponse,
  TrackedFlight,
} from '../flight/types';

const AUTO_REFRESH_MS = 60_000;
const MIN_MAP_LOADING_MS = 2_000;
const TIMELINE_MIN_SEGMENT_DISTANCE_KM = 600;
const TIMELINE_FALLBACK_SEGMENT_DISTANCE_KM = 1_200;
const TIMELINE_RECENT_DEPARTURE_WINDOW_MS = 12 * 60 * 60 * 1000;
const TIMELINE_NODE_SIZE_PX = 14;
const WAYBACK_STEP_MS = 5 * 60 * 1000;
const WAYBACK_LIVE_THRESHOLD_MS = 60 * 1000;
const WAYBACK_RETURN_TO_LIVE_THRESHOLD_MS = Math.max(WAYBACK_LIVE_THRESHOLD_MS, WAYBACK_STEP_MS);

interface FriendsTrackerClientProps {
  map: WorldMapPayload;
  initialConfig: FriendsTrackerConfig;
  airportMarkers: FlightMapAirportMarker[];
}

interface FriendsTrackerDashboardProps extends FriendsTrackerClientProps {
  mapView: TrackerMapView;
  onMapViewChange: (nextView: TrackerMapView) => void;
  mapReady: boolean;
  loadingTargetView: TrackerMapView;
  onMapReady: () => void;
}

function formatRelativeSeconds(timestampSeconds: number | null, referenceTimeMs = Date.now()): string {
  if (!timestampSeconds) {
    return '—';
  }

  const diffSeconds = Math.max(0, Math.round(referenceTimeMs / 1000) - timestampSeconds);
  if (diffSeconds < 60) {
    return `${diffSeconds}s ago`;
  }

  const minutes = Math.round(diffSeconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.round(minutes / 60);
  return `${hours}h ago`;
}

function formatDateTimeMillis(timestampMs: number | null, locale: string): string {
  if (!timestampMs) {
    return '—';
  }

  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(timestampMs);
}

function getFlightPointTimeMs(point: FlightMapPoint | null | undefined): number | null {
  return typeof point?.time === 'number' && Number.isFinite(point.time)
    ? point.time * 1000
    : null;
}

function sortFlightPoints(points: Array<FlightMapPoint | null | undefined>): FlightMapPoint[] {
  const deduped = new Map<string, FlightMapPoint>();

  for (const point of points) {
    if (!point) {
      continue;
    }

    const key = point.time != null
      ? `t:${point.time}`
      : `c:${point.latitude.toFixed(4)}:${point.longitude.toFixed(4)}:${point.altitude ?? 'na'}:${point.onGround ? 'g' : 'a'}`;

    deduped.set(key, point);
  }

  return Array.from(deduped.values()).sort((first, second) => {
    const firstTimeMs = getFlightPointTimeMs(first);
    const secondTimeMs = getFlightPointTimeMs(second);

    if (firstTimeMs == null && secondTimeMs == null) {
      return 0;
    }

    if (firstTimeMs == null) {
      return -1;
    }

    if (secondTimeMs == null) {
      return 1;
    }

    return firstTimeMs - secondTimeMs;
  });
}

function pickMostRecentFlightPoint(points: Array<FlightMapPoint | null | undefined>): FlightMapPoint | null {
  let bestPoint: FlightMapPoint | null = null;
  let bestTimeMs = Number.NEGATIVE_INFINITY;

  for (const point of points) {
    if (!point) {
      continue;
    }

    const timeMs = getFlightPointTimeMs(point);
    if (timeMs != null && timeMs >= bestTimeMs) {
      bestPoint = point;
      bestTimeMs = timeMs;
      continue;
    }

    if (!bestPoint) {
      bestPoint = point;
    }
  }

  return bestPoint;
}

function getLatestHistoricalSnapshot(
  history: FlightFetchSnapshot[] | undefined,
  referenceTimeMs: number,
): FlightFetchSnapshot | null {
  return [...(history ?? [])]
    .filter((snapshot) => Number.isFinite(snapshot.capturedAt) && snapshot.capturedAt <= referenceTimeMs)
    .sort((first, second) => first.capturedAt - second.capturedAt)
    .at(-1) ?? null;
}

function interpolateFlightPoint(
  from: GeoPoint,
  to: GeoPoint,
  progress: number,
  timeMs: number,
  onGround: boolean,
): FlightMapPoint {
  const clampedProgress = clampNumber(progress, 0, 1);

  return {
    time: Math.round(timeMs / 1000),
    latitude: from.latitude + ((to.latitude - from.latitude) * clampedProgress),
    longitude: from.longitude + ((to.longitude - from.longitude) * clampedProgress),
    x: 0,
    y: 0,
    altitude: onGround ? 0 : null,
    heading: computeAirportBearingDegrees(from, to),
    onGround,
  };
}

function buildHistoricalFlightView(
  flight: TrackedFlight,
  referenceTimeMs: number,
  liveTimeMs: number,
): TrackedFlight | null {
  const clampedReferenceTimeMs = Math.min(referenceTimeMs, liveTimeMs);
  if (clampedReferenceTimeMs >= liveTimeMs - WAYBACK_RETURN_TO_LIVE_THRESHOLD_MS) {
    return flight;
  }

  const routeFirstSeenMs = flight.route.firstSeen != null ? flight.route.firstSeen * 1000 : null;
  const routeLastSeenMs = flight.route.lastSeen != null ? flight.route.lastSeen * 1000 : null;
  const latestSnapshot = getLatestHistoricalSnapshot(flight.fetchHistory, clampedReferenceTimeMs);
  const liveReferencePoint = flight.current ?? flight.track.at(-1) ?? flight.rawTrack?.at(-1) ?? flight.originPoint ?? null;
  const liveReferenceTimeMs = getFlightPointTimeMs(liveReferencePoint)
    ?? (flight.lastContact != null ? flight.lastContact * 1000 : liveTimeMs);

  const track = flight.track.filter((point) => {
    const timeMs = getFlightPointTimeMs(point);
    return timeMs == null || timeMs <= clampedReferenceTimeMs;
  });
  const rawTrack = (flight.rawTrack ?? []).filter((point) => {
    const timeMs = getFlightPointTimeMs(point);
    return timeMs == null || timeMs <= clampedReferenceTimeMs;
  });

  const liveCurrentPoint = (() => {
    const timeMs = getFlightPointTimeMs(flight.current);
    return timeMs == null || timeMs <= clampedReferenceTimeMs ? flight.current : null;
  })();

  let currentPoint = pickMostRecentFlightPoint([
    sortFlightPoints([...rawTrack, ...track, liveCurrentPoint]).at(-1) ?? null,
    latestSnapshot?.current ?? null,
  ]);

  const canForecastFromLivePoint = currentPoint == null
    && liveReferencePoint != null
    && routeFirstSeenMs != null
    && liveReferenceTimeMs > routeFirstSeenMs
    && clampedReferenceTimeMs >= routeFirstSeenMs
    && clampedReferenceTimeMs <= liveReferenceTimeMs;

  if (canForecastFromLivePoint) {
    const interpolationProgress = clampNumber(
      (clampedReferenceTimeMs - routeFirstSeenMs) / (liveReferenceTimeMs - routeFirstSeenMs),
      0.02,
      1,
    );

    currentPoint = flight.originPoint
      ? interpolateFlightPoint(
          flight.originPoint,
          liveReferencePoint,
          interpolationProgress,
          clampedReferenceTimeMs,
          interpolationProgress >= 0.999 && liveReferencePoint.onGround,
        )
      : {
          ...liveReferencePoint,
          time: Math.round(clampedReferenceTimeMs / 1000),
          onGround: false,
        };
  }

  const hasHistoricalEvidence = track.length > 0 || rawTrack.length > 0 || latestSnapshot != null || currentPoint != null;

  if (!hasHistoricalEvidence && routeFirstSeenMs != null && clampedReferenceTimeMs < routeFirstSeenMs) {
    return null;
  }

  if (!hasHistoricalEvidence) {
    return null;
  }

  const isHistoricalOnGround = latestSnapshot?.onGround === true
    || currentPoint?.onGround === true
    || (flight.onGround && routeLastSeenMs != null && clampedReferenceTimeMs >= routeLastSeenMs);

  return {
    ...flight,
    current: currentPoint,
    track,
    rawTrack,
    onGround: isHistoricalOnGround,
    lastContact: latestSnapshot?.lastContact
      ?? currentPoint?.time
      ?? (isHistoricalOnGround ? flight.route.lastSeen : null)
      ?? null,
    heading: currentPoint?.heading ?? latestSnapshot?.heading ?? flight.heading,
    velocity: latestSnapshot?.velocity ?? flight.velocity,
    geoAltitude: currentPoint?.altitude ?? latestSnapshot?.geoAltitude ?? flight.geoAltitude,
    baroAltitude: latestSnapshot?.baroAltitude ?? flight.baroAltitude,
    route: {
      ...flight.route,
      lastSeen: isHistoricalOnGround ? flight.route.lastSeen : null,
    },
    fetchHistory: (flight.fetchHistory ?? []).filter((snapshot) => snapshot.capturedAt <= clampedReferenceTimeMs),
  };
}

function computeWaybackBounds(
  config: FriendsTrackerConfig,
  flights: TrackedFlight[],
  fallbackEndMs: number,
): { startMs: number; endMs: number } {
  const departureTimes: number[] = [];
  const observedTimes: number[] = [fallbackEndMs];

  for (const friend of config.friends) {
    for (const leg of friend.flights) {
      const departureMs = Date.parse(leg.departureTime);
      if (Number.isFinite(departureMs)) {
        departureTimes.push(departureMs);
      }
    }
  }

  for (const flight of flights) {
    if (flight.route.firstSeen != null) {
      observedTimes.push(flight.route.firstSeen * 1000);
    }

    if (flight.route.lastSeen != null) {
      observedTimes.push(flight.route.lastSeen * 1000);
    }

    for (const point of [flight.originPoint, ...flight.track, ...(flight.rawTrack ?? []), flight.current]) {
      const pointTimeMs = getFlightPointTimeMs(point);
      if (pointTimeMs != null) {
        observedTimes.push(pointTimeMs);
      }
    }

    for (const snapshot of flight.fetchHistory ?? []) {
      if (Number.isFinite(snapshot.capturedAt)) {
        observedTimes.push(snapshot.capturedAt);
      }

      if (snapshot.route.firstSeen != null) {
        observedTimes.push(snapshot.route.firstSeen * 1000);
      }

      if (snapshot.route.lastSeen != null) {
        observedTimes.push(snapshot.route.lastSeen * 1000);
      }

      const pointTimeMs = getFlightPointTimeMs(snapshot.current);
      if (pointTimeMs != null) {
        observedTimes.push(pointTimeMs);
      }
    }
  }

  const finiteDepartureTimes = departureTimes.filter((value) => Number.isFinite(value));
  const finiteObservedTimes = observedTimes.filter((value) => Number.isFinite(value));
  const rawStartMs = Math.min(...(finiteDepartureTimes.length > 0 ? finiteDepartureTimes : finiteObservedTimes));
  const endMs = Math.max(...finiteObservedTimes);
  const safeEndMs = Number.isFinite(endMs) ? endMs : fallbackEndMs;
  const startMs = Number.isFinite(rawStartMs)
    ? Math.min(rawStartMs, safeEndMs)
    : safeEndMs;

  return {
    startMs,
    endMs: safeEndMs,
  };
}

function getFriendInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
  }
  return name.slice(0, 2).toUpperCase() || '?';
}

function withAlphaColor(color: string, alpha: number): string {
  const normalizedAlpha = Math.min(Math.max(alpha, 0), 1);

  if (color.startsWith('hsl(')) {
    return color.replace(/^hsl\((.*)\)$/, `hsla($1, ${normalizedAlpha})`);
  }

  if (color.startsWith('rgb(')) {
    return color.replace(/^rgb\((.*)\)$/, `rgba($1, ${normalizedAlpha})`);
  }

  return color;
}

interface GeoPoint {
  latitude: number;
  longitude: number;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function toRadians(value: number): number {
  return value * (Math.PI / 180);
}

function computeAirportDistanceKm(from: GeoPoint, to: GeoPoint): number {
  const earthRadiusKm = 6_371;
  const latitudeDelta = toRadians(to.latitude - from.latitude);
  const longitudeDelta = toRadians(to.longitude - from.longitude);
  const fromLatitude = toRadians(from.latitude);
  const toLatitude = toRadians(to.latitude);

  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(fromLatitude) * Math.cos(toLatitude) * Math.sin(longitudeDelta / 2) ** 2;

  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function normalizeHeadingDegrees(value: number): number {
  const normalized = value % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function computeAirportBearingDegrees(from: GeoPoint, to: GeoPoint): number {
  const fromLatitude = toRadians(from.latitude);
  const toLatitude = toRadians(to.latitude);
  const longitudeDelta = toRadians(to.longitude - from.longitude);

  const y = Math.sin(longitudeDelta) * Math.cos(toLatitude);
  const x = Math.cos(fromLatitude) * Math.sin(toLatitude)
    - Math.sin(fromLatitude) * Math.cos(toLatitude) * Math.cos(longitudeDelta);

  return normalizeHeadingDegrees((Math.atan2(y, x) * 180) / Math.PI);
}

function estimateTimelineSegmentWeight(distanceKm: number | null): number {
  const normalizedDistanceKm = Math.max(
    distanceKm ?? TIMELINE_FALLBACK_SEGMENT_DISTANCE_KM,
    TIMELINE_MIN_SEGMENT_DISTANCE_KM,
  );

  return Math.sqrt(normalizedDistanceKm / TIMELINE_MIN_SEGMENT_DISTANCE_KM);
}

function computeTimelineCursorFraction(cursorRaw: number | null, segmentWeights: number[]): number | null {
  if (cursorRaw == null || segmentWeights.length === 0) {
    return null;
  }

  const totalWeight = segmentWeights.reduce((sum, weight) => sum + weight, 0);
  if (!(totalWeight > 0)) {
    return null;
  }

  const clampedCursor = Math.min(Math.max(cursorRaw, 0), segmentWeights.length);
  let traversedWeight = 0;

  for (let i = 0; i < segmentWeights.length; i++) {
    const weight = segmentWeights[i] ?? 1;
    if (clampedCursor <= i + 1) {
      const segmentProgress = Math.max(0, Math.min(clampedCursor - i, 1));
      return (traversedWeight + segmentProgress * weight) / totalWeight;
    }

    traversedWeight += weight;
  }

  return 1;
}

/**
 * Estimates the cursor position (0 = first airport, airports.length - 1 = last airport)
 * for a friend's current trip timeline based on live flight data.
 */
function computeTimelineCursorPosition(
  currentTripLegs: FriendFlightLeg[],
  friendStatuses: FriendFlightStatus[],
  now: number,
  airportMarkerByCode: Map<string, FlightMapAirportMarker>,
): number | null {
  if (!currentTripLegs.length) {
    return null;
  }

  // Find the first matched leg that still looks actively in motion.
  for (let i = 0; i < currentTripLegs.length; i++) {
    const leg = currentTripLegs[i]!;
    const status = friendStatuses.find((s) => s.leg.id === leg.id);

    if (status?.status !== 'matched' || !status.flight) {
      continue;
    }

    const flight = status.flight;
    const firstSeenMs = flight.route.firstSeen != null ? flight.route.firstSeen * 1000 : null;
    const lastSeenMs = flight.route.lastSeen != null ? flight.route.lastSeen * 1000 : null;
    const currentPoint = flight.current ?? flight.track.at(-1) ?? flight.originPoint ?? null;

    const fromCode = (leg.from ?? flight.route.departureAirport ?? '').trim().toUpperCase();
    const toCode = (leg.to ?? flight.route.arrivalAirport ?? '').trim().toUpperCase();
    const fromMarker = fromCode ? airportMarkerByCode.get(fromCode) : undefined;
    const toMarker = toCode ? airportMarkerByCode.get(toCode) : undefined;

    if (currentPoint && fromMarker && toMarker) {
      const totalDistanceKm = computeAirportDistanceKm(fromMarker, toMarker);
      const distanceToDestinationKm = computeAirportDistanceKm(currentPoint, toMarker);

      if (currentPoint.onGround || flight.onGround) {
        const isNearArrival = distanceToDestinationKm <= Math.max(40, totalDistanceKm * 0.08);
        return isNearArrival ? i + 1 : i;
      }

      if (totalDistanceKm > 0) {
        const spatialProgress = clampNumber(1 - (distanceToDestinationKm / totalDistanceKm), 0.05, 0.95);
        if (Number.isFinite(spatialProgress)) {
          return i + spatialProgress;
        }
      }
    }

    if (flight.onGround) {
      if (lastSeenMs != null) {
        return i + 1;
      }

      return i;
    }

    let progress = 0.5;
    const pointTimeMs = getFlightPointTimeMs(currentPoint)
      ?? (flight.lastContact != null ? flight.lastContact * 1000 : null);

    if (firstSeenMs != null && pointTimeMs != null) {
      if (lastSeenMs != null && lastSeenMs > firstSeenMs) {
        progress = clampNumber((pointTimeMs - firstSeenMs) / (lastSeenMs - firstSeenMs), 0.05, 0.95);
      } else {
        const fallbackEndMs = Math.max(pointTimeMs + (30 * 60 * 1000), now, firstSeenMs + (60 * 60 * 1000));
        progress = clampNumber((pointTimeMs - firstSeenMs) / (fallbackEndMs - firstSeenMs), 0.05, 0.95);
      }
    }

    return i + progress;
  }

  let lastPastLegIndex = -1;
  for (let i = 0; i < currentTripLegs.length; i++) {
    const dep = Date.parse(currentTripLegs[i]!.departureTime);
    if (!Number.isNaN(dep) && dep <= now) {
      lastPastLegIndex = i;
    }
  }

  if (lastPastLegIndex >= 0) {
    const hasFutureLeg = currentTripLegs.slice(lastPastLegIndex + 1).some((leg) => {
      const departureMs = Date.parse(leg.departureTime);
      return !Number.isNaN(departureMs) && departureMs > now;
    });
    const lastPastDepartureMs = Date.parse(currentTripLegs[lastPastLegIndex]!.departureTime);

    if (
      !hasFutureLeg
      && !Number.isNaN(lastPastDepartureMs)
      && now - lastPastDepartureMs <= TIMELINE_RECENT_DEPARTURE_WINDOW_MS
    ) {
      return Math.min(lastPastLegIndex + 0.5, currentTripLegs.length - 0.1);
    }

    return lastPastLegIndex + 1;
  }

  return null;
}

function getFriendStatusReferenceTimeMs(status: FriendFlightStatus): number {
  if (status.flight?.lastContact != null) {
    return status.flight.lastContact * 1000;
  }

  if (status.flight?.route.lastSeen != null) {
    return status.flight.route.lastSeen * 1000;
  }

  if (status.flight?.route.firstSeen != null) {
    return status.flight.route.firstSeen * 1000;
  }

  const scheduledTime = Date.parse(status.leg.departureTime);
  return Number.isFinite(scheduledTime) ? scheduledTime : Number.NEGATIVE_INFINITY;
}

function pickPreferredMapStatus(friendStatuses: FriendFlightStatus[], now = Date.now()): FriendFlightStatus | null {
  if (!friendStatuses.length) {
    return null;
  }

  const matchedStatuses = friendStatuses.filter((status) => status.flight);
  if (matchedStatuses.length > 0) {
    const inFlightStatuses = matchedStatuses.filter((status) => !status.flight?.onGround);
    const candidateStatuses = inFlightStatuses.length > 0 ? inFlightStatuses : matchedStatuses;

    return candidateStatuses.reduce<FriendFlightStatus | null>((best, status) => {
      if (!best) {
        return status;
      }

      return getFriendStatusReferenceTimeMs(status) >= getFriendStatusReferenceTimeMs(best) ? status : best;
    }, null);
  }

  const upcomingStatuses = friendStatuses
    .map((status) => ({
      status,
      departureTimeMs: Date.parse(status.leg.departureTime),
    }))
    .filter(({ departureTimeMs }) => Number.isFinite(departureTimeMs) && departureTimeMs >= now)
    .sort((a, b) => a.departureTimeMs - b.departureTimeMs);

  if (upcomingStatuses.length > 0) {
    return upcomingStatuses[0]!.status;
  }

  const mostRecentPastStatus = friendStatuses
    .map((status) => ({
      status,
      departureTimeMs: Date.parse(status.leg.departureTime),
    }))
    .filter(({ departureTimeMs }) => Number.isFinite(departureTimeMs))
    .sort((a, b) => b.departureTimeMs - a.departureTimeMs)[0];

  return mostRecentPastStatus?.status ?? friendStatuses[0] ?? null;
}

function normalizeAirportCode(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim()
    ? value.trim().toUpperCase()
    : null;
}

function resolveStaticFriendMarkerAirportCode(
  status: FriendFlightStatus,
  friendStatuses: FriendFlightStatus[],
  now = Date.now(),
): string | null {
  const mostRecentPastStatus = friendStatuses
    .map((entry) => ({
      status: entry,
      departureTimeMs: Date.parse(entry.leg.departureTime),
    }))
    .filter(({ departureTimeMs }) => Number.isFinite(departureTimeMs) && departureTimeMs <= now)
    .sort((a, b) => a.departureTimeMs - b.departureTimeMs)
    .at(-1)?.status;

  if (mostRecentPastStatus) {
    return normalizeAirportCode(mostRecentPastStatus.leg.to)
      ?? normalizeAirportCode(mostRecentPastStatus.leg.from);
  }

  return normalizeAirportCode(status.leg.from)
    ?? normalizeAirportCode(status.leg.to);
}

function FriendTimelineCard({
  friend,
  friendStatuses,
  destinationAirport,
  referenceTimeMs,
  airportMarkers,
  accentColor,
}: {
  friend: FriendTravelConfig;
  friendStatuses: FriendFlightStatus[];
  destinationAirport: string | null;
  referenceTimeMs: number;
  airportMarkers: FlightMapAirportMarker[];
  accentColor: string;
}) {
  const currentTripLegs = getCurrentTripLegs(friend, friendStatuses, destinationAirport, referenceTimeMs);
  const airports = buildAirportChain(currentTripLegs);

  const airportMarkerByCode = useMemo(() => {
    return new Map(
      airportMarkers.map((marker) => [marker.code.toUpperCase().trim(), marker] as const),
    );
  }, [airportMarkers]);

  const cursorRaw = computeTimelineCursorPosition(currentTripLegs, friendStatuses, referenceTimeMs, airportMarkerByCode);

  const timelineSegments = useMemo(() => {
    return airports.slice(0, -1).map((fromAirport, index) => {
      const toAirport = airports[index + 1]!;
      const fromMarker = airportMarkerByCode.get(fromAirport);
      const toMarker = airportMarkerByCode.get(toAirport);
      const distanceKm = fromMarker && toMarker
        ? computeAirportDistanceKm(fromMarker, toMarker)
        : null;

      return {
        id: currentTripLegs[index]?.id ?? `${fromAirport}-${toAirport}-${index}`,
        fromAirport,
        toAirport,
        distanceKm,
        weight: estimateTimelineSegmentWeight(distanceKm),
      };
    });
  }, [airports, airportMarkerByCode, currentTripLegs]);

  const cursorFraction = computeTimelineCursorFraction(
    cursorRaw,
    timelineSegments.map((segment) => segment.weight),
  );

  // Determine how many airports are "completed" (friend has already passed through them).
  // Airport at index j is completed if leg j-1 is done and not currently active.
  const activeLegIndex = currentTripLegs.findIndex((leg) => {
    const s = friendStatuses.find((st) => st.leg.id === leg.id);
    return s?.status === 'matched' && !s.flight?.onGround;
  });

  const completedAirportCount = activeLegIndex >= 0
    ? activeLegIndex // airports 0..activeLegIndex-1 are fully done; activeLegIndex is departure of current leg
    : (cursorRaw != null ? Math.floor(cursorRaw) : 0);

  const clampedCursorFraction = cursorFraction == null
    ? null
    : Math.min(Math.max(cursorFraction, 0), 1);

  const cursorLeft = clampedCursorFraction == null
    ? null
    : `calc(${TIMELINE_NODE_SIZE_PX / 2}px + ${clampedCursorFraction} * (100% - ${TIMELINE_NODE_SIZE_PX}px))`;

  const cursorRotationDegrees = activeLegIndex >= 0 || (cursorRaw != null && Math.abs(cursorRaw % 1) > 0.001)
    ? 45
    : -45;
  const cursorIconMode = cursorRaw != null && cursorRaw >= Math.max(airports.length - 1, 0)
    ? 'landing'
    : cursorRaw != null && cursorRaw <= 0
    ? 'takeoff'
    : 'plane';

  // Last seen: latest lastContact among all matched legs for this friend.
  const lastContactSeconds = friendStatuses.reduce<number | null>((best, s) => {
    const contact = s.flight?.lastContact ?? null;
    if (contact == null) return best;
    return best == null || contact > best ? contact : best;
  }, null);

  // Active leg flight number to show next to cursor.
  const activeLegFlightNumber = activeLegIndex >= 0
    ? currentTripLegs[activeLegIndex]?.flightNumber ?? null
    : null;
  const cursorLegIndex = cursorRaw == null || currentTripLegs.length === 0
    ? null
    : Math.min(Math.max(Math.floor(cursorRaw), 0), currentTripLegs.length - 1);
  const cursorFlightNumber = cursorLegIndex != null
    ? currentTripLegs[cursorLegIndex]?.flightNumber ?? activeLegFlightNumber
    : activeLegFlightNumber;

  const destinationAirports = parseDestinationAirportCodes(destinationAirport);
  const hasConfiguredDestinationAirports = destinationAirports.length > 0;
  const hasArrivedAtDestination = hasConfiguredDestinationAirports
    && airports.length > 0
    && destinationAirports.includes(airports[airports.length - 1] ?? '')
    && cursorRaw != null
    && cursorRaw >= airports.length - 1;
  const hasStartedTrip = currentTripLegs.some((leg) => {
    const departureMs = Date.parse(leg.departureTime);
    return !Number.isNaN(departureMs) && departureMs <= referenceTimeMs;
  });
  const hasFutureLeg = currentTripLegs.some((leg) => {
    const departureMs = Date.parse(leg.departureTime);
    return !Number.isNaN(departureMs) && departureMs > referenceTimeMs;
  });
  const hasNotStartedTrip = !hasArrivedAtDestination && activeLegIndex < 0 && !hasStartedTrip;
  const isOnConnectionStop = !hasArrivedAtDestination && activeLegIndex < 0 && hasStartedTrip && hasFutureLeg;
  const tripProgressLabel = hasArrivedAtDestination
    ? 'arrived'
    : activeLegIndex >= 0
    ? 'in flight'
    : hasNotStartedTrip
    ? 'not started'
    : isOnConnectionStop
    ? 'connection'
    : 'outbound';

  const initials = getFriendInitials(friend.name);
  const hasAnyMatch = friendStatuses.some((s) => s.status === 'matched');

  return (
    <article className="rounded-2xl border border-white/10 bg-slate-950/55 p-3">
      {/* Header row: avatar + name + last seen */}
      <div className="flex items-center gap-3">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border p-[1.5px] text-[11px] font-bold uppercase tracking-wide text-slate-100"
          style={{
            borderColor: accentColor,
            backgroundColor: withAlphaColor(accentColor, 0.18),
            boxShadow: `0 0 0 3px ${withAlphaColor(accentColor, 0.12)}`,
          }}
        >
          {friend.avatarUrl ? (
            <img
              src={friend.avatarUrl}
              alt={friend.name}
              className="h-full w-full rounded-full object-cover"
            />
          ) : (
            <div
              aria-label={`Avatar for ${friend.name}`}
              className="flex h-full w-full items-center justify-center rounded-full bg-slate-950/35"
            >
              {initials}
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-white">{friend.name}</div>
          <div className="text-[11px] text-slate-400">
            {currentTripLegs.length} leg{currentTripLegs.length === 1 ? '' : 's'}
            {hasConfiguredDestinationAirports ? (
              <span className="ml-1 text-slate-500">
                · {tripProgressLabel}
              </span>
            ) : null}
          </div>
        </div>

        {lastContactSeconds != null ? (
          <div className="flex shrink-0 items-center gap-1 text-[11px] text-slate-400">
            <Clock3 className="h-3 w-3" />
            <span>{formatRelativeSeconds(lastContactSeconds, referenceTimeMs)}</span>
          </div>
        ) : (
          <div className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${hasAnyMatch ? 'bg-emerald-500/20 text-emerald-200' : 'bg-slate-700/60 text-slate-400'}`}>
            {hasAnyMatch ? 'live' : 'awaiting'}
          </div>
        )}
      </div>

      {/* Horizontal timeline */}
      {airports.length >= 2 ? (
        <div className="mt-3 px-1">
          <div className="relative">
            <div className="relative flex items-start">
              {timelineSegments.map((segment, index) => {
                const airport = airports[index]!;
                const isDest = destinationAirports.includes(airport);
                const isCompleted = activeLegIndex >= 0
                  ? index < completedAirportCount
                  : (cursorRaw != null && index <= cursorRaw);
                const isActive = index === completedAirportCount && activeLegIndex >= 0;
                const segmentFill = cursorRaw == null
                  ? 0
                  : Math.max(0, Math.min(cursorRaw - index, 1));

                return (
                  <div
                    key={segment.id}
                    className="flex min-w-[3.5rem] items-start"
                    style={{ flexGrow: segment.weight, flexBasis: 0 }}
                    title={segment.distanceKm != null
                      ? `${segment.fromAirport} to ${segment.toAirport} · ~${Math.round(segment.distanceKm).toLocaleString()} km`
                      : `${segment.fromAirport} to ${segment.toAirport}`}
                  >
                    <div className="relative h-8 w-[14px] shrink-0" style={{ minWidth: `${TIMELINE_NODE_SIZE_PX}px` }}>
                      <div
                        className={`h-3.5 w-3.5 rounded-full border transition-colors ${
                          isDest
                            ? 'border-amber-400 bg-amber-400/80 shadow-sm shadow-amber-400/40'
                            : isCompleted || isActive
                            ? 'border-cyan-400 bg-cyan-400'
                            : 'border-slate-500 bg-slate-800'
                        }`}
                      />
                      <span
                        className={`absolute left-1/2 top-[18px] w-10 -translate-x-1/2 truncate text-center text-[9px] leading-none ${
                          isDest
                            ? 'font-semibold text-amber-300'
                            : isCompleted || isActive
                            ? 'text-cyan-300'
                            : 'text-slate-500'
                        }`}
                        title={airport}
                      >
                        {airport}
                      </span>
                    </div>

                    <div className="relative mx-1.5 mt-[7px] h-px flex-1 bg-slate-700">
                      {segmentFill > 0 ? (
                        <div
                          className="absolute inset-y-0 left-0 bg-cyan-500/70 transition-all duration-500"
                          style={{ width: `${segmentFill * 100}%` }}
                        />
                      ) : null}
                    </div>
                  </div>
                );
              })}

              {(() => {
                const finalAirport = airports[airports.length - 1]!;
                const isDest = destinationAirports.includes(finalAirport);
                const isCompleted = activeLegIndex >= 0
                  ? airports.length - 1 < completedAirportCount
                  : (cursorRaw != null && airports.length - 1 <= cursorRaw);

                return (
                  <div className="relative h-8 w-[14px] shrink-0" style={{ minWidth: `${TIMELINE_NODE_SIZE_PX}px` }}>
                    <div
                      className={`h-3.5 w-3.5 rounded-full border transition-colors ${
                        isDest
                          ? 'border-amber-400 bg-amber-400/80 shadow-sm shadow-amber-400/40'
                          : isCompleted
                          ? 'border-cyan-400 bg-cyan-400'
                          : 'border-slate-500 bg-slate-800'
                      }`}
                    />
                    <span
                      className={`absolute left-1/2 top-[18px] w-10 -translate-x-1/2 truncate text-center text-[9px] leading-none ${
                        isDest
                          ? 'font-semibold text-amber-300'
                          : isCompleted
                          ? 'text-cyan-300'
                          : 'text-slate-500'
                      }`}
                      title={finalAirport}
                    >
                      {finalAirport}
                    </span>
                  </div>
                );
              })()}

              {/* Cursor (plane icon) — anchored directly on the current timeline position */}
              {cursorLeft != null && (
                <div
                  className="pointer-events-none absolute z-10 flex h-5 w-5 items-center justify-center rounded-full border border-cyan-300/80 bg-slate-950/90 shadow-[0_0_0_2px_rgba(8,47,73,0.45)]"
                  style={{
                    left: cursorLeft,
                    top: '7px',
                    transform: 'translate(-50%, -50%)',
                    transition: 'left 0.5s ease',
                  }}
                >
                  {cursorIconMode === 'takeoff' ? (
                    <PlaneTakeoff
                      className="h-3 w-3 text-cyan-200 drop-shadow-[0_0_4px_rgba(103,232,249,0.75)]"
                      aria-label={cursorFlightNumber ? `Flight ${cursorFlightNumber} ready for departure` : 'Departure airport'}
                    />
                  ) : cursorIconMode === 'landing' ? (
                    <PlaneLanding
                      className="h-3 w-3 text-cyan-200 drop-shadow-[0_0_4px_rgba(103,232,249,0.75)]"
                      aria-label={cursorFlightNumber ? `Flight ${cursorFlightNumber} arrived` : 'Arrival airport'}
                    />
                  ) : (
                    <Plane
                      className="h-3 w-3 text-cyan-200 drop-shadow-[0_0_4px_rgba(103,232,249,0.75)]"
                      style={{ transform: `rotate(${cursorRotationDegrees}deg)` }}
                      aria-label={cursorFlightNumber ? `Flight ${cursorFlightNumber}` : 'Current position'}
                    />
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Flight number label under cursor */}
          {cursorFlightNumber && cursorLeft != null ? (
            <div className="relative mt-1 h-3">
              <div
                className="absolute -translate-x-1/2 text-[10px] text-cyan-400"
                style={{
                  left: cursorLeft,
                  transition: 'left 0.5s ease',
                }}
              >
                {cursorFlightNumber}
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="mt-2 text-xs text-slate-500 italic">
          {airports.length === 1 ? `Origin: ${airports[0]}` : 'No airport data configured for this trip.'}
        </div>
      )}
    </article>
  );
}

function FriendsTrackerTopBar({
  tripName,
  friendCount,
  trackedCount,
  lastUpdated,
  isRefreshing,
  onRefresh,
  mapView,
  onMapViewChange,
  showWaybackButton,
  onToggleWayback,
  onCloseWayback,
  isWaybackActive,
  isWaybackMenuOpen,
  mobileWaybackDropdown,
}: {
  tripName: string | null;
  friendCount: number;
  trackedCount: number;
  lastUpdated: number | null;
  isRefreshing: boolean;
  onRefresh: () => void;
  mapView: TrackerMapView;
  onMapViewChange: (nextView: TrackerMapView) => void;
  showWaybackButton?: boolean;
  onToggleWayback?: () => void;
  onCloseWayback?: () => void;
  isWaybackActive?: boolean;
  isWaybackMenuOpen?: boolean;
  mobileWaybackDropdown?: React.ReactNode;
}) {
  const locale = useLocale();
  const { topBarRef } = useTrackerLayout();
  const waybackMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!showWaybackButton || !isWaybackMenuOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (waybackMenuRef.current?.contains(event.target as Node)) {
        return;
      }

      onCloseWayback?.();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [isWaybackMenuOpen, onCloseWayback, showWaybackButton]);

  return (
    <div ref={topBarRef} className="pointer-events-none absolute inset-x-0 top-0 z-40 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 p-3 md:p-4">
      <div className="pointer-events-auto min-w-0 max-w-full justify-self-start rounded-2xl border border-white/10 bg-slate-950/75 px-4 py-3 shadow-xl backdrop-blur-md">
        <div className="text-[11px] uppercase tracking-[0.24em] text-cyan-200">Chantal crew tracker</div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-100">
          {tripName ? (
            <span className="rounded-full border border-cyan-400/30 bg-cyan-500/10 px-2 py-0.5 text-[11px] font-semibold text-cyan-100">
              {tripName}
            </span>
          ) : null}
          <span>{friendCount} friends</span>
          <span className="text-slate-500">•</span>
          <span>{trackedCount} flights on the map</span>
        </div>
        <div className="mt-1 text-xs text-slate-400">Updated {formatDateTimeMillis(lastUpdated, locale)} UTC</div>
      </div>

      <div className="pointer-events-none relative flex flex-col items-end gap-2 md:flex-row md:flex-wrap md:items-center md:justify-end">
        <Link
          href="/chantal/config"
          className="pointer-events-auto inline-flex h-9 w-9 items-center justify-center gap-2 rounded-full border border-white/12 bg-slate-950/80 p-2 text-sm font-medium text-slate-100 shadow backdrop-blur-sm transition hover:border-white/20 hover:bg-slate-900 lg:w-auto lg:px-3"
        >
          <Settings2 className="h-4 w-4 shrink-0" />
          <span className="hidden lg:inline">Config</span>
        </Link>
        {showWaybackButton ? (
          <div ref={waybackMenuRef} className="relative pointer-events-auto">
            <button
              type="button"
              onClick={onToggleWayback}
              className={`relative inline-flex h-9 w-9 items-center justify-center gap-2 rounded-full border p-2 text-sm font-medium text-slate-100 shadow backdrop-blur-sm transition hover:border-white/20 hover:bg-slate-900 ${
                isWaybackActive
                  ? 'border-cyan-400/35 bg-cyan-500/10'
                  : 'border-white/12 bg-slate-950/80'
              }`}
              aria-label="Open wayback machine"
              aria-expanded={isWaybackMenuOpen ? 'true' : 'false'}
              aria-haspopup="dialog"
            >
              <Clock3 className="h-4 w-4 shrink-0" />
              <span
                aria-hidden="true"
                className={`absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full ${
                  isWaybackActive ? 'bg-cyan-300' : 'bg-rose-500'
                }`}
              />
            </button>
            {mobileWaybackDropdown}
          </div>
        ) : null}
        <FlightMapViewToggle mapView={mapView} onChange={onMapViewChange} />
        <TrackerZoomControls />
        <button
          type="button"
          onClick={onRefresh}
          className="pointer-events-auto inline-flex h-9 w-9 items-center justify-center gap-2 rounded-full border border-white/12 bg-slate-950/80 p-2 text-sm font-medium text-slate-100 shadow backdrop-blur-sm transition hover:border-white/20 hover:bg-slate-900 lg:w-auto lg:px-3"
        >
          <RefreshCw className={`h-4 w-4 shrink-0 ${isRefreshing ? 'animate-spin' : ''}`} />
          <span className="hidden lg:inline">Refresh</span>
        </button>
      </div>
    </div>
  );
}

function FriendsTrackerDashboard({
  map,
  initialConfig,
  airportMarkers,
  mapView,
  onMapViewChange,
  mapReady,
  loadingTargetView,
  onMapReady,
}: FriendsTrackerDashboardProps) {
  // Layout context used by child components
  const [config, setConfig] = useState(() => normalizeFriendsTrackerConfig(initialConfig));
  const [data, setData] = useState<TrackerApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const locale = useLocale();
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedTimeMs, setSelectedTimeMs] = useState<number | null>(null);
  const [isWaybackModalOpen, setIsWaybackModalOpen] = useState(false);
  const autoLockSignatureRef = useRef<string | null>(null);

  const identifiers = useMemo(() => extractFriendTrackerIdentifiers(config), [config]);
  const identifiersQuery = identifiers.join(',');
  const liveTimeMs = data?.fetchedAt ?? Date.now();

  const waybackBounds = useMemo(
    () => computeWaybackBounds(config, data?.flights ?? [], liveTimeMs),
    [config, data?.flights, liveTimeMs],
  );

  const referenceTimeMs = selectedTimeMs == null
    ? waybackBounds.endMs
    : Math.min(Math.max(selectedTimeMs, waybackBounds.startMs), waybackBounds.endMs);
  const isWaybackActive = referenceTimeMs < waybackBounds.endMs - WAYBACK_RETURN_TO_LIVE_THRESHOLD_MS;

  const displayFlights = useMemo(() => {
    if (!isWaybackActive) {
      return data?.flights ?? [];
    }

    return (data?.flights ?? []).flatMap((flight) => {
      const historicalFlight = buildHistoricalFlightView(flight, referenceTimeMs, liveTimeMs);
      return historicalFlight ? [historicalFlight] : [];
    });
  }, [data?.flights, isWaybackActive, liveTimeMs, referenceTimeMs]);

  const statuses = useMemo(
    () => buildFriendFlightStatuses(config, displayFlights, referenceTimeMs),
    [config, displayFlights, referenceTimeMs],
  );

  const mapStatuses = useMemo(() => {
    return config.friends.flatMap((friend) => {
      const friendStatuses = statuses.filter((status) => status.friend.id === friend.id);
      const preferredStatus = pickPreferredMapStatus(friendStatuses, referenceTimeMs);
      return preferredStatus ? [preferredStatus] : [];
    });
  }, [config.friends, referenceTimeMs, statuses]);

  const visibleFlights = useMemo(() => {
    const flightsByIcao24 = new Map<string, TrackedFlight>();

    for (const status of mapStatuses) {
      if (status.flight && !flightsByIcao24.has(status.flight.icao24)) {
        flightsByIcao24.set(status.flight.icao24, status.flight);
      }
    }

    return Array.from(flightsByIcao24.values());
  }, [mapStatuses]);

  const flightLabels = useMemo(() => {
    return Object.fromEntries(
      mapStatuses
        .filter((status) => status.flight)
        .map((status) => [status.flight!.icao24, status.label]),
    ) satisfies Record<string, string>;
  }, [mapStatuses]);

  const flightColorIndexMap = useMemo(() => {
    return new Map(
      mapStatuses
        .filter((status) => status.flight)
        .map((status, index) => [status.flight!.icao24, index]),
    );
  }, [mapStatuses]);

  const flightAvatars = useMemo<Record<string, FriendAvatarInfo[]>>(() => {
    const result: Record<string, FriendAvatarInfo[]> = {};

    for (const status of mapStatuses) {
      if (!status.flight) {
        continue;
      }

      const icao24 = status.flight.icao24;
      const colorIndex = flightColorIndexMap.get(icao24) ?? 0;

      if (!result[icao24]) {
        result[icao24] = [];
      }

      result[icao24]!.push({
        friendId: status.friend.id,
        name: status.friend.name || status.label,
        avatarUrl: status.friend.avatarUrl ?? null,
        color: getFlightMapColor(colorIndex, false),
      });
    }

    return result;
  }, [mapStatuses, flightColorIndexMap]);

  const staticFriendMarkers = useMemo<FriendAvatarMarker[]>(() => {
    const airportMarkerByCode = new Map(
      airportMarkers.map((marker) => [marker.code.toUpperCase().trim(), marker] as const),
    );
    const statusesByFriendId = new Map<string, FriendFlightStatus[]>();

    for (const status of statuses) {
      const existingStatuses = statusesByFriendId.get(status.friend.id);
      if (existingStatuses) {
        existingStatuses.push(status);
      } else {
        statusesByFriendId.set(status.friend.id, [status]);
      }
    }

    return mapStatuses.flatMap((status, index) => {
      if (status.flight) {
        return [];
      }

      const airportCode = resolveStaticFriendMarkerAirportCode(
        status,
        statusesByFriendId.get(status.friend.id) ?? [status],
        referenceTimeMs,
      );
      if (!airportCode) {
        return [];
      }

      const airportMarker = airportMarkerByCode.get(airportCode);
      if (!airportMarker) {
        return [];
      }

      return [{
        id: status.friend.id,
        name: status.friend.name || status.label,
        avatarUrl: status.friend.avatarUrl ?? null,
        color: getFlightMapColor(index, false),
        latitude: airportMarker.latitude,
        longitude: airportMarker.longitude,
      } satisfies FriendAvatarMarker];
    });
  }, [airportMarkers, mapStatuses, referenceTimeMs, statuses]);

  const friendAccentColors = useMemo(() => {
    const result = new Map<string, string>();

    for (const avatarInfos of Object.values(flightAvatars)) {
      for (const info of avatarInfos) {
        if (!result.has(info.friendId)) {
          result.set(info.friendId, info.color);
        }
      }
    }

    for (const marker of staticFriendMarkers) {
      if (!result.has(marker.id)) {
        result.set(marker.id, marker.color);
      }
    }

    config.friends.forEach((friend, index) => {
      if (!result.has(friend.id)) {
        result.set(friend.id, getFlightMapColor(index, false));
      }
    });

    return result;
  }, [config.friends, flightAvatars, staticFriendMarkers]);

  const runSearch = useCallback(async (
    options: {
      background?: boolean;
      forceRefresh?: boolean;
    } = {},
  ) => {
    const { background = false, forceRefresh = false } = options;

    if (!identifiersQuery) {
      setData(null);
      setError(null);
      return;
    }

    setError(null);
    if (background) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }

    try {
      const searchParams = new URLSearchParams({ q: identifiersQuery });
      if (forceRefresh) {
        searchParams.set('refresh', '1');
      }

      const response = await fetch(`/api/tracker?${searchParams.toString()}`, {
        cache: 'no-store',
      });
      const payload = await response.json() as TrackerApiResponse & { error?: string };

      if (!response.ok) {
        throw new Error(payload.error || 'Unable to fetch the Chantal crew flights.');
      }

      setData(payload);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to fetch the Chantal crew flights.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [identifiersQuery]);

  useEffect(() => {
    void runSearch();
  }, [runSearch]);

  useEffect(() => {
    if (!identifiersQuery) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void runSearch({ background: true });
    }, AUTO_REFRESH_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [identifiersQuery, runSearch]);

  useEffect(() => {
    if (!data?.flights.length) {
      return;
    }

    const nextState = applyAutoLockedFriendFlights(config, data.flights);
    if (!nextState.changed) {
      return;
    }

    const signature = JSON.stringify(nextState.config.friends.map((friend) => ({
      id: friend.id,
      flights: friend.flights.map((leg) => ({
        id: leg.id,
        resolvedIcao24: leg.resolvedIcao24,
      })),
    })));

    if (autoLockSignatureRef.current === signature) {
      return;
    }

    autoLockSignatureRef.current = signature;
    setConfig(normalizeFriendsTrackerConfig(nextState.config));

    void fetch('/api/chantal/config', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        updatedBy: 'chantal map auto-lock',
        cronEnabled: nextState.config.cronEnabled,
        friends: nextState.config.friends,
      }),
    })
      .then(async (response) => {
        if (!response.ok) {
          return;
        }

        const payload = await response.json() as FriendsTrackerConfig;
        setConfig(normalizeFriendsTrackerConfig(payload));
      })
      .catch(() => undefined);
  }, [config, data?.flights]);

  useEffect(() => {
    if (selectedTimeMs == null) {
      return;
    }

    if (selectedTimeMs < waybackBounds.startMs) {
      setSelectedTimeMs(waybackBounds.startMs);
      return;
    }

    if (selectedTimeMs >= waybackBounds.endMs - WAYBACK_RETURN_TO_LIVE_THRESHOLD_MS) {
      setSelectedTimeMs(null);
    }
  }, [selectedTimeMs, waybackBounds.endMs, waybackBounds.startMs]);

  const { isMobile } = useTrackerLayout();
  const currentTrip = getCurrentTripConfig(config);
  const totalFriends = config.friends.length;
  const destinationAirport = config.destinationAirport ?? null;
  const sliderValue = isWaybackActive ? referenceTimeMs : waybackBounds.endMs;
  const hasWaybackRange = waybackBounds.endMs - waybackBounds.startMs >= WAYBACK_STEP_MS;

  const waybackCard = hasWaybackRange ? (
    <div className="rounded-2xl border border-white/12 bg-slate-950/72 p-4 shadow-[0_30px_90px_rgba(2,6,23,0.55)] backdrop-blur-md">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-200">
            <Clock3 className="h-4 w-4 shrink-0" />
            <span>Wayback machine</span>
          </div>
          <div className="mt-1 text-xs text-slate-300">
            {isWaybackActive ? 'Historical snapshot' : 'Live now'}
          </div>
          <div className="text-[11px] text-slate-400">
            {formatDateTimeMillis(sliderValue, locale)} UTC
          </div>
        </div>

        <button
          type="button"
          onClick={() => setSelectedTimeMs(null)}
          disabled={!isWaybackActive}
          className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${
            isWaybackActive
              ? 'border-cyan-400/40 bg-cyan-500/10 text-cyan-100 hover:bg-cyan-500/15'
              : 'border-rose-400/35 bg-rose-500/10 text-rose-100'
          }`}
        >
          <span className="inline-flex items-center gap-1.5">
            {!isWaybackActive ? (
              <span aria-hidden="true" className="h-2 w-2 rounded-full bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.8)]" />
            ) : null}
            <span>Live</span>
          </span>
        </button>
      </div>

      <label htmlFor="chantal-wayback-slider" className="sr-only">Wayback machine</label>
      <input
        id="chantal-wayback-slider"
        aria-label="Wayback machine"
        type="range"
        min={waybackBounds.startMs}
        max={waybackBounds.endMs}
        step={WAYBACK_STEP_MS}
        value={sliderValue}
        onChange={(event) => {
          const nextValue = Number.parseInt(event.currentTarget.value, 10);
          if (!Number.isFinite(nextValue)) {
            return;
          }

          if (nextValue >= waybackBounds.endMs - WAYBACK_RETURN_TO_LIVE_THRESHOLD_MS) {
            setSelectedTimeMs(null);
            return;
          }

          setSelectedTimeMs(nextValue);
        }}
        className="mt-3 w-full accent-cyan-400"
      />

      <div className="mt-2 flex items-center justify-between gap-3 text-[10px] text-slate-500">
        <span>{formatDateTimeMillis(waybackBounds.startMs, locale)}</span>
        <span>Live</span>
      </div>

      <p className="mt-2 text-[11px] text-slate-400">
        Stored provider telemetry is used first, then itinerary timing fills any gaps.
      </p>
    </div>
  ) : null;

  useEffect(() => {
    if (!isMobile || !hasWaybackRange) {
      setIsWaybackModalOpen(false);
    }
  }, [hasWaybackRange, isMobile]);

  const mobileWaybackPopup = isMobile && hasWaybackRange && isWaybackModalOpen ? (
    <div className="absolute right-0 top-full z-10 mt-2 w-[min(calc(100vw-1.5rem),24rem)] md:hidden">
      <div className="max-h-[calc(100dvh-6rem)] overflow-y-auto rounded-2xl border border-white/10 bg-slate-950/95 shadow-[0_20px_60px_rgba(2,6,23,0.45)] backdrop-blur-md">
        {waybackCard}
      </div>
    </div>
  ) : null;

  const sidebarContent = (
    <div className="space-y-3">
      {/* Compact crew overview header */}
      <div className="flex items-center justify-between gap-3 px-1">
        <div className="flex items-center gap-2 text-xs uppercase tracking-[0.22em] text-slate-400">
          <Users className="h-3.5 w-3.5" />
          <span>{totalFriends} crew member{totalFriends === 1 ? '' : 's'}</span>
        </div>
        {destinationAirport ? (
          <div className="flex items-center gap-1.5 rounded-full border border-amber-400/30 bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold text-amber-200">
            <Plane className="h-3 w-3 -rotate-45" />
            {destinationAirport}
          </div>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 p-3 text-sm text-rose-100">
          <div className="mb-1 flex items-center gap-2 font-semibold">
            <CircleAlert className="h-4 w-4" />
            Unable to refresh the crew map
          </div>
          <p className="text-xs">{error}</p>
        </div>
      ) : null}

      {data?.notFoundIdentifiers.length ? (
        <div className="rounded-2xl border border-cyan-400/30 bg-cyan-500/10 p-3 text-xs text-cyan-100">
          <div className="mb-1 flex items-center gap-2 font-semibold">
            <Clock3 className="h-4.5 w-4.5 shrink-0" />
            Awaiting telemetry: {data.notFoundIdentifiers.join(', ')}
          </div>
        </div>
      ) : null}

      {!identifiers.length ? (
        <div className="rounded-2xl border border-dashed border-white/10 bg-slate-950/35 p-4 text-sm text-slate-400">
          No friend itineraries are configured yet. Add the crew details on the config page first.
        </div>
      ) : null}

      {config.friends.map((friend, index) => {
        const friendStatuses = statuses.filter((status) => status.friend.id === friend.id);
        return (
          <FriendTimelineCard
            key={friend.id}
            friend={friend}
            friendStatuses={friendStatuses}
            destinationAirport={destinationAirport}
            referenceTimeMs={referenceTimeMs}
            airportMarkers={airportMarkers}
            accentColor={friendAccentColors.get(friend.id) ?? getFlightMapColor(index, false)}
          />
        );
      })}
    </div>
  );

  return (
    <TrackerShell
      topBar={
        <FriendsTrackerTopBar
          tripName={currentTrip?.name ?? null}
          friendCount={totalFriends}
          trackedCount={visibleFlights.length}
          lastUpdated={data?.fetchedAt ?? null}
          isRefreshing={isRefreshing}
          onRefresh={() => {
            void runSearch({ background: true, forceRefresh: true });
          }}
          mapView={mapView}
          onMapViewChange={onMapViewChange}
          showWaybackButton={isMobile && hasWaybackRange}
          onToggleWayback={() => setIsWaybackModalOpen((current) => !current)}
          onCloseWayback={() => setIsWaybackModalOpen(false)}
          isWaybackActive={isWaybackActive}
          isWaybackMenuOpen={isWaybackModalOpen}
          mobileWaybackDropdown={mobileWaybackPopup}
        />
      }
      showBackgroundGrid
      mapContent={
        <div className="relative h-[100dvh] w-full">
          <FlightMap
            map={map}
            flights={visibleFlights}
            mapView={mapView}
            selectedIcao24={null}
            selectionMode="all"
            flightLabels={flightLabels}
            flightAvatars={flightAvatars}
            staticFriendMarkers={staticFriendMarkers}
            airportMarkers={airportMarkers}
            emptyOverlayMessage={null}
            onInitialZoomEnd={onMapReady}
          />
        </div>
      }
      sidebarContent={sidebarContent}
      sidebarFooter={!isMobile ? waybackCard : null}
      isLoading={isLoading || !mapReady}
      loadingContent={
        loadingTargetView === 'globe'
          ? <Globe className="animate-spin text-sky-400" size={64} strokeWidth={2.5} />
          : <MapIcon className="animate-spin text-sky-400" size={64} strokeWidth={2.5} />
      }
    />
  );
}

export default function FriendsTrackerClient({ map, initialConfig, airportMarkers }: FriendsTrackerClientProps) {
  const [mapView, setMapView] = useState<TrackerMapView>('flat');
  const [mapReady, setMapReady] = useState(false);
  const [loadingTargetView, setLoadingTargetView] = useState<TrackerMapView>('flat');
  const mapReadyRef = useRef(false);
  const isMapTransitioningRef = useRef(true);
  const mapTransitionStartedAtRef = useRef<number | null>(null);
  const mapReadyTimeoutRef = useRef<number | null>(null);

  const handleMapLoadingStart = useCallback((targetView?: TrackerMapView) => {
    if (mapReadyTimeoutRef.current !== null) {
      window.clearTimeout(mapReadyTimeoutRef.current);
      mapReadyTimeoutRef.current = null;
    }

    if (targetView) {
      setLoadingTargetView(targetView);
    }

    isMapTransitioningRef.current = true;
    mapTransitionStartedAtRef.current = Date.now();
    mapReadyRef.current = false;
    setMapReady(false);
  }, []);

  const handleMapReady = useCallback(() => {
    if (mapReadyTimeoutRef.current !== null) {
      window.clearTimeout(mapReadyTimeoutRef.current);
      mapReadyTimeoutRef.current = null;
    }

    const startedAt = mapTransitionStartedAtRef.current;
    if (startedAt !== null) {
      const elapsed = Date.now() - startedAt;
      const remaining = MIN_MAP_LOADING_MS - elapsed;

      if (remaining > 0) {
        mapReadyTimeoutRef.current = window.setTimeout(() => {
          mapReadyTimeoutRef.current = null;
          mapTransitionStartedAtRef.current = null;
          isMapTransitioningRef.current = false;
          mapReadyRef.current = true;
          setMapReady(true);
        }, remaining);
        return;
      }
    }

    if (!isMapTransitioningRef.current && mapReadyRef.current) {
      return;
    }

    mapTransitionStartedAtRef.current = null;
    isMapTransitioningRef.current = false;
    mapReadyRef.current = true;
    setMapReady(true);
  }, []);

  const handleMapViewChange = useCallback((nextView: TrackerMapView) => {
    if (nextView === mapView) {
      return;
    }

    handleMapLoadingStart(nextView);
    setMapView(nextView);
  }, [handleMapLoadingStart, mapView]);

  useEffect(() => {
    handleMapLoadingStart(mapView);
  }, [handleMapLoadingStart, mapView]);

  useEffect(() => {
    return () => {
      if (mapReadyTimeoutRef.current !== null) {
        window.clearTimeout(mapReadyTimeoutRef.current);
      }
    };
  }, []);

  return (
    <TrackerLayoutProvider>
      <FlightMapProvider mapView={mapView}>
        <FriendsTrackerDashboard
          map={map}
          initialConfig={initialConfig}
          airportMarkers={airportMarkers}
          mapView={mapView}
          onMapViewChange={handleMapViewChange}
          mapReady={mapReady}
          loadingTargetView={loadingTargetView}
          onMapReady={handleMapReady}
        />
      </FlightMapProvider>
    </TrackerLayoutProvider>
  );
}
