import type { FlightFetchSnapshot, FlightMapPoint, TrackedFlight } from '~/components/tracker/flight/types';

interface GeoPoint {
  latitude: number;
  longitude: number;
}

interface InterpolatedGeoPoint extends GeoPoint {
  altitude?: number | null;
  heading?: number | null;
}

interface WaybackConfigFriend {
  flights: Array<{
    departureTime: string;
  }>;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function toRadians(value: number): number {
  return value * (Math.PI / 180);
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

function normalizeLongitude(value: number): number {
  const normalized = ((value + 180) % 360 + 360) % 360 - 180;
  return normalized === -180 ? 180 : normalized;
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

function interpolateNullableNumber(
  start: number | null | undefined,
  end: number | null | undefined,
  progress: number,
): number | null {
  if (start == null && end == null) {
    return null;
  }

  if (start == null) {
    return end ?? null;
  }

  if (end == null) {
    return start;
  }

  return start + ((end - start) * progress);
}

function interpolateHeadingDegrees(
  start: number | null | undefined,
  end: number | null | undefined,
  progress: number,
): number | null {
  if (start == null && end == null) {
    return null;
  }

  if (start == null) {
    return end ?? null;
  }

  if (end == null) {
    return start;
  }

  const delta = (((end - start) % 360) + 540) % 360 - 180;
  return normalizeHeadingDegrees(start + (delta * clampNumber(progress, 0, 1)));
}

export function getFlightPointTimeMs(point: FlightMapPoint | null | undefined): number | null {
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
  from: InterpolatedGeoPoint,
  to: InterpolatedGeoPoint,
  progress: number,
  timeMs: number,
  onGround: boolean,
): FlightMapPoint {
  const clampedProgress = clampNumber(progress, 0, 1);
  const startLongitude = from.longitude;
  const endLongitude = unwrapLongitude(to.longitude, startLongitude);
  const fallbackHeading = computeAirportBearingDegrees(from, to);

  return {
    time: Math.floor(timeMs / 1000),
    latitude: from.latitude + ((to.latitude - from.latitude) * clampedProgress),
    longitude: normalizeLongitude(startLongitude + ((endLongitude - startLongitude) * clampedProgress)),
    x: 0,
    y: 0,
    altitude: onGround
      ? 0
      : interpolateNullableNumber(from.altitude, to.altitude, clampedProgress),
    heading: interpolateHeadingDegrees(from.heading, to.heading, clampedProgress) ?? fallbackHeading,
    onGround,
  };
}

function interpolateHistoricalFlightPoint(
  points: Array<FlightMapPoint | null | undefined>,
  referenceTimeMs: number,
): FlightMapPoint | null {
  const timedPoints = sortFlightPoints(points)
    .map((point) => {
      const timeMs = getFlightPointTimeMs(point);
      return point && timeMs != null ? { point, timeMs } : null;
    })
    .filter((entry): entry is { point: FlightMapPoint; timeMs: number } => entry != null);

  if (timedPoints.length === 0) {
    return null;
  }

  let previousEntry: { point: FlightMapPoint; timeMs: number } | null = null;

  for (const entry of timedPoints) {
    if (entry.timeMs === referenceTimeMs) {
      return entry.point;
    }

    if (entry.timeMs < referenceTimeMs) {
      previousEntry = entry;
      continue;
    }

    if (previousEntry && entry.timeMs > previousEntry.timeMs) {
      const progress = (referenceTimeMs - previousEntry.timeMs) / (entry.timeMs - previousEntry.timeMs);
      return interpolateFlightPoint(
        previousEntry.point,
        entry.point,
        progress,
        referenceTimeMs,
        previousEntry.point.onGround && entry.point.onGround,
      );
    }

    break;
  }

  return previousEntry?.point ?? null;
}

export function buildHistoricalFlightView(
  flight: TrackedFlight,
  referenceTimeMs: number,
  liveTimeMs: number,
  options?: {
    returnToLiveThresholdMs?: number;
  },
): TrackedFlight | null {
  const clampedReferenceTimeMs = Math.min(referenceTimeMs, liveTimeMs);
  const returnToLiveThresholdMs = options?.returnToLiveThresholdMs ?? 0;

  if (clampedReferenceTimeMs >= liveTimeMs - returnToLiveThresholdMs) {
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

  let currentPoint = interpolateHistoricalFlightPoint(
    [
      flight.originPoint,
      ...(flight.rawTrack ?? []),
      ...flight.track,
      ...(flight.fetchHistory ?? []).map((snapshot) => snapshot.current),
      flight.current,
    ],
    clampedReferenceTimeMs,
  ) ?? pickMostRecentFlightPoint([
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
          time: Math.floor(clampedReferenceTimeMs / 1000),
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

export function computeWaybackBounds(
  friends: WaybackConfigFriend[],
  flights: TrackedFlight[],
  fallbackEndMs: number,
): { startMs: number; endMs: number } {
  const departureTimes: number[] = [];
  const observedTimes: number[] = [fallbackEndMs];

  for (const friend of friends) {
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
