'use client';

import { scaleLinear } from 'd3-scale';
import { curveMonotoneX, line as d3Line } from 'd3-shape';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ChevronDown,
  CircleAlert,
  Clock3,
  Gauge,
  Globe,
  Map as MapIcon,
  MapPin,
  Plane,
  Radar,
  RefreshCw,
  Route,
  Search,
  X,
} from 'lucide-react';
import type { WorldMapPayload } from '~/lib/server/worldMap';
import TrackerShell from '../TrackerShell';
import TrackerZoomControls from '../TrackerZoomControls';
import { TrackerLayoutProvider, useTrackerLayout } from '../contexts/TrackerLayoutContext';
import { FlightMapProvider } from './contexts/FlightMapProvider';
import FlightMap from './FlightMap';
import FlightMapViewToggle, { type TrackerMapView } from './FlightMapViewToggle';
import { getFlightMapColor } from './colors';
import type {
  AirportDetails,
  FlightDataSource,
  FlightFetchSnapshot,
  FlightFetchTrigger,
  FlightMapPoint,
  FlightSourceDetail,
  FlightSourceName,
  SelectedFlightDetails as SelectedFlightDetailsPayload,
  TrackerApiResponse,
  TrackedFlight,
  TrackedFlightRoute,
} from './types';

const AUTO_REFRESH_MS = 60_000;
const MIN_MAP_LOADING_MS = 2_000;
const STORAGE_KEY = 'tracker:last-query';
const URL_QUERY_KEY = 'q';
const TRACKER_SOURCES: FlightSourceName[] = ['opensky', 'aviationstack', 'flightaware', 'aerodatabox'];

function formatSourceLabel(source: FlightSourceName): string {
  switch (source) {
    case 'flightaware':
      return 'FlightAware';
    case 'aviationstack':
      return 'Aviationstack';
    case 'aerodatabox':
      return 'AeroDataBox';
    default:
      return 'OpenSky';
  }
}

interface FlightTrackerClientProps {
  map: WorldMapPayload;
}

interface FlightTrackerDashboardProps extends FlightTrackerClientProps {
  mapView: TrackerMapView;
  onMapViewChange: (nextView: TrackerMapView) => void;
  mapReady: boolean;
  loadingTargetView: TrackerMapView;
  onMapReady: () => void;
}

function formatTimestamp(timestampMs: number | null): string {
  if (!timestampMs) {
    return '—';
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(timestampMs);
}

function formatRelativeSeconds(timestampSeconds: number | null): string {
  if (!timestampSeconds) {
    return '—';
  }

  const diffSeconds = Math.max(0, Math.round(Date.now() / 1000) - timestampSeconds);
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

function formatDateTimeSeconds(timestampSeconds: number | null): string {
  if (!timestampSeconds) {
    return '—';
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(timestampSeconds * 1000);
}

function sanitizeObservedTimestamp(timestampSeconds: number | null, latestAllowedTimestampSeconds: number | null): number | null {
  if (timestampSeconds == null) {
    return null;
  }

  if (latestAllowedTimestampSeconds != null && timestampSeconds > latestAllowedTimestampSeconds) {
    return null;
  }

  return timestampSeconds;
}

function formatAltitude(value: number | null): string {
  return value == null ? '—' : `${Math.round(value).toLocaleString()} m`;
}

function formatSpeed(value: number | null): string {
  return value == null ? '—' : `${Math.round(value * 3.6).toLocaleString()} km/h`;
}

function formatDataSourceLabel(
  dataSource: FlightDataSource | undefined,
  sourceDetails?: FlightSourceDetail[] | null,
): string {
  const usedSources = (sourceDetails ?? [])
    .filter((detail) => detail.usedInResult)
    .map((detail) => detail.source);
  const uniqueUsedSources = Array.from(new Set(usedSources));

  if (uniqueUsedSources.length > 1) {
    return uniqueUsedSources.map((source) => formatSourceLabel(source)).join(' + ');
  }

  if (uniqueUsedSources.length === 1) {
    return formatSourceLabel(uniqueUsedSources[0]!);
  }

  if (dataSource === 'hybrid') {
    return 'Multiple sources';
  }

  if (dataSource === 'flightaware') {
    return 'FlightAware';
  }

  if (dataSource === 'aerodatabox') {
    return 'AeroDataBox';
  }

  return dataSource === 'aviationstack' ? 'Aviationstack' : 'OpenSky';
}

function formatDateTimeMillis(timestampMs: number | null): string {
  if (!timestampMs) {
    return '—';
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(timestampMs);
}

function formatFetchTriggerLabel(trigger: FlightFetchTrigger): string {
  switch (trigger) {
    case 'manual-refresh':
      return 'Manual refresh';
    case 'auto-refresh':
      return 'Auto refresh';
    default:
      return 'Search';
  }
}

function formatSourceStatusLabel(status: FlightSourceDetail['status']): string {
  switch (status) {
    case 'used':
      return 'Used';
    case 'error':
      return 'Error';
    case 'no-data':
      return 'No data';
    default:
      return 'Skipped';
  }
}

function getSourceStatusClassName(status: FlightSourceDetail['status']): string {
  switch (status) {
    case 'used':
      return 'border-emerald-400/30 bg-emerald-500/10 text-emerald-100';
    case 'error':
      return 'border-rose-400/30 bg-rose-500/10 text-rose-100';
    case 'no-data':
      return 'border-amber-400/30 bg-amber-500/10 text-amber-50';
    default:
      return 'border-slate-500/30 bg-slate-800/80 text-slate-200';
  }
}

function mergeSourceDetails(
  previous: FlightSourceDetail[] | undefined,
  next: FlightSourceDetail[] | undefined,
): FlightSourceDetail[] | undefined {
  const merged = new Map<FlightSourceDetail['source'], FlightSourceDetail>();

  for (const detail of [...(previous ?? []), ...(next ?? [])]) {
    const existing = merged.get(detail.source);
    if (!existing) {
      merged.set(detail.source, detail);
      continue;
    }

    const priority = { used: 4, error: 3, 'no-data': 2, skipped: 1 } as const;
    const shouldUseIncomingStatus = priority[detail.status] >= priority[existing.status];

    merged.set(detail.source, {
      ...existing,
      ...detail,
      status: shouldUseIncomingStatus ? detail.status : existing.status,
      usedInResult: existing.usedInResult || detail.usedInResult,
      reason: detail.reason || existing.reason,
      raw: detail.raw ?? existing.raw ?? null,
    });
  }

  return merged.size > 0 ? Array.from(merged.values()) : undefined;
}

function normalizeHistoryIdentifier(value: string | null | undefined): string {
  return typeof value === 'string' ? value.replace(/\s+/g, '').trim().toUpperCase() : '';
}

function mergeUniqueStrings(...lists: Array<string[] | undefined>): string[] {
  return Array.from(
    new Set(
      lists.flatMap((list) => (list ?? []).map((value) => value.trim()).filter(Boolean)),
    ),
  );
}

const MAX_RECONCILED_TRACK_POINTS = 120;

function chooseMostRecentPoint(next: FlightMapPoint | null, previous: FlightMapPoint | null): FlightMapPoint | null {
  if (!next) {
    return previous;
  }

  if (!previous) {
    return next;
  }

  if (next.time != null && previous.time != null) {
    return next.time >= previous.time ? next : previous;
  }

  if (next.time != null) {
    return next;
  }

  return previous.time != null ? previous : next;
}

function chooseEarliestPoint(next: FlightMapPoint | null, previous: FlightMapPoint | null): FlightMapPoint | null {
  if (!next) {
    return previous;
  }

  if (!previous) {
    return next;
  }

  if (next.time != null && previous.time != null) {
    return next.time <= previous.time ? next : previous;
  }

  if (next.time != null) {
    return next;
  }

  return previous.time != null ? previous : next;
}

function limitTrackPoints(points: FlightMapPoint[]): FlightMapPoint[] {
  if (points.length <= MAX_RECONCILED_TRACK_POINTS) {
    return points;
  }

  const lastIndex = points.length - 1;

  return Array.from({ length: MAX_RECONCILED_TRACK_POINTS }, (_, sampleIndex) => {
    const pointIndex = Math.floor((sampleIndex * lastIndex) / (MAX_RECONCILED_TRACK_POINTS - 1));
    return points[pointIndex] ?? null;
  }).filter((point): point is FlightMapPoint => Boolean(point));
}

function mergeTrackPoints(previous: FlightMapPoint[] = [], next: FlightMapPoint[] = []): FlightMapPoint[] {
  const merged = new Map<string, FlightMapPoint>();

  for (const point of [...previous, ...next]) {
    const key = point.time != null
      ? `t:${point.time}`
      : `c:${point.latitude.toFixed(4)}:${point.longitude.toFixed(4)}:${point.altitude ?? 'na'}`;

    merged.set(key, point);
  }

  const sortedPoints = Array.from(merged.values())
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
    });

  return limitTrackPoints(sortedPoints);
}

function mergeRouteValues(
  previous: TrackedFlightRoute | null | undefined,
  next: TrackedFlightRoute | null | undefined,
): TrackedFlightRoute {
  return {
    departureAirport: next?.departureAirport ?? previous?.departureAirport ?? null,
    arrivalAirport: next?.arrivalAirport ?? previous?.arrivalAirport ?? null,
    firstSeen: next?.firstSeen ?? previous?.firstSeen ?? null,
    lastSeen: next?.lastSeen ?? previous?.lastSeen ?? null,
  };
}

function mergeDataSource(
  previous: FlightDataSource | undefined,
  next: FlightDataSource | undefined,
): FlightDataSource | undefined {
  if (previous && next && previous !== next) {
    return 'hybrid';
  }

  return next ?? previous;
}

function reconcileTrackedFlight(previous: TrackedFlight | undefined, next: TrackedFlight): TrackedFlight {
  if (!previous) {
    return next;
  }

  const mergedCurrent = chooseMostRecentPoint(next.current, previous.current);
  const mergedTrack = mergeTrackPoints(previous.track, next.track);
  const mergedRawTrack = mergeTrackPoints(previous.rawTrack ?? previous.track, next.rawTrack ?? next.track);
  const mergedOriginPoint = chooseEarliestPoint(
    chooseEarliestPoint(mergedTrack[0] ?? null, next.originPoint),
    previous.originPoint,
  ) ?? mergedCurrent;
  const previousLastContact = previous.lastContact ?? Number.NEGATIVE_INFINITY;
  const nextLastContact = next.lastContact ?? Number.NEGATIVE_INFINITY;
  const mergedLastContact = Number.isFinite(Math.max(previousLastContact, nextLastContact))
    ? Math.max(previousLastContact, nextLastContact)
    : (next.lastContact ?? previous.lastContact ?? null);

  return {
    ...previous,
    ...next,
    callsign: next.callsign || previous.callsign,
    originCountry: next.originCountry !== 'Unknown' ? next.originCountry : previous.originCountry,
    matchedBy: mergeUniqueStrings(previous.matchedBy, next.matchedBy),
    lastContact: mergedLastContact,
    current: mergedCurrent,
    originPoint: mergedOriginPoint,
    track: mergedTrack.length ? mergedTrack : (next.track.length ? next.track : previous.track),
    rawTrack: mergedRawTrack.length ? mergedRawTrack : (next.rawTrack ?? previous.rawTrack ?? []),
    onGround: nextLastContact >= previousLastContact ? next.onGround : previous.onGround,
    velocity: next.velocity ?? previous.velocity,
    heading: next.heading ?? previous.heading ?? mergedCurrent?.heading ?? null,
    verticalRate: next.verticalRate ?? previous.verticalRate,
    geoAltitude: next.geoAltitude ?? next.current?.altitude ?? previous.geoAltitude ?? previous.current?.altitude ?? null,
    baroAltitude: next.baroAltitude ?? previous.baroAltitude,
    squawk: next.squawk ?? previous.squawk,
    category: next.category ?? previous.category,
    route: mergeRouteValues(previous.route, next.route),
    flightNumber: next.flightNumber ?? previous.flightNumber,
    airline: next.airline ?? previous.airline,
    aircraft: next.aircraft ?? previous.aircraft,
    dataSource: mergeDataSource(previous.dataSource, next.dataSource),
    sourceDetails: mergeSourceDetails(previous.sourceDetails, next.sourceDetails),
    fetchHistory: next.fetchHistory ?? previous.fetchHistory,
  };
}

function reconcileSelectedFlightDetails(
  previous: SelectedFlightDetailsPayload | null,
  next: SelectedFlightDetailsPayload,
): SelectedFlightDetailsPayload {
  if (!previous || previous.icao24 !== next.icao24) {
    return next;
  }

  return {
    ...previous,
    ...next,
    fetchedAt: Math.max(previous.fetchedAt, next.fetchedAt),
    route: mergeRouteValues(previous.route, next.route),
    departureAirport: next.departureAirport ?? previous.departureAirport,
    arrivalAirport: next.arrivalAirport ?? previous.arrivalAirport,
    flightNumber: next.flightNumber ?? previous.flightNumber,
    airline: next.airline ?? previous.airline,
    aircraft: next.aircraft ?? previous.aircraft,
    dataSource: mergeDataSource(previous.dataSource, next.dataSource),
    sourceDetails: mergeSourceDetails(previous.sourceDetails, next.sourceDetails),
    fetchHistory: next.fetchHistory ?? previous.fetchHistory,
  };
}

function buildFlightFetchSnapshot(
  flight: TrackedFlight,
  capturedAt: number,
  trigger: FlightFetchTrigger,
  details?: SelectedFlightDetailsPayload | null,
): FlightFetchSnapshot {
  return {
    id: `${flight.icao24}:${trigger}:${capturedAt}`,
    capturedAt,
    trigger,
    dataSource: details?.dataSource ?? flight.dataSource ?? 'opensky',
    matchedBy: mergeUniqueStrings(flight.matchedBy),
    route: details?.route ?? flight.route,
    current: flight.current,
    onGround: flight.onGround,
    lastContact: flight.lastContact,
    velocity: flight.velocity,
    heading: flight.heading,
    geoAltitude: flight.geoAltitude ?? flight.current?.altitude ?? null,
    baroAltitude: flight.baroAltitude,
    flightNumber: details?.flightNumber ?? flight.flightNumber ?? null,
    airline: details?.airline ?? flight.airline ?? null,
    aircraft: details?.aircraft ?? flight.aircraft ?? null,
    departureAirport: details?.departureAirport ?? null,
    arrivalAirport: details?.arrivalAirport ?? null,
    sourceDetails: mergeSourceDetails(flight.sourceDetails, details?.sourceDetails) ?? [],
  };
}

function buildSnapshotMaterialKey(snapshot: FlightFetchSnapshot): string {
  const sourceStates = (snapshot.sourceDetails ?? [])
    .map((detail) => `${detail.source}:${detail.status}:${detail.usedInResult ? 'used' : 'unused'}`)
    .sort();

  return JSON.stringify({
    dataSource: snapshot.dataSource,
    route: {
      departureAirport: snapshot.route.departureAirport ?? null,
      arrivalAirport: snapshot.route.arrivalAirport ?? null,
    },
    onGround: snapshot.onGround,
    velocity: snapshot.velocity ?? null,
    geoAltitude: snapshot.geoAltitude ?? null,
    flightNumber: snapshot.flightNumber ?? null,
    airline: snapshot.airline?.name ?? null,
    aircraft: snapshot.aircraft
      ? {
          registration: snapshot.aircraft.registration ?? null,
          icao: snapshot.aircraft.icao ?? null,
          iata: snapshot.aircraft.iata ?? null,
          model: snapshot.aircraft.model ?? null,
        }
      : null,
    sourceStates,
  });
}

function mergeFlightFetchHistory(
  history: FlightFetchSnapshot[] | undefined,
  snapshot: FlightFetchSnapshot,
): FlightFetchSnapshot[] {
  const nextHistory = [...(history ?? [])];
  const existingIndex = nextHistory.findIndex((entry) => entry.id === snapshot.id);

  if (existingIndex >= 0) {
    const current = nextHistory[existingIndex]!;
    const currentLastContact = current.lastContact ?? Number.NEGATIVE_INFINITY;
    const snapshotLastContact = snapshot.lastContact ?? Number.NEGATIVE_INFINITY;
    const preferIncomingTelemetry = snapshotLastContact >= currentLastContact;

    nextHistory[existingIndex] = {
      ...current,
      ...snapshot,
      matchedBy: mergeUniqueStrings(current.matchedBy, snapshot.matchedBy),
      route: mergeRouteValues(current.route, snapshot.route),
      current: preferIncomingTelemetry
        ? chooseMostRecentPoint(snapshot.current, current.current)
        : chooseMostRecentPoint(current.current, snapshot.current),
      onGround: preferIncomingTelemetry ? snapshot.onGround : current.onGround,
      lastContact: Number.isFinite(Math.max(currentLastContact, snapshotLastContact))
        ? Math.max(currentLastContact, snapshotLastContact)
        : (snapshot.lastContact ?? current.lastContact),
      velocity: preferIncomingTelemetry ? (snapshot.velocity ?? current.velocity) : (current.velocity ?? snapshot.velocity),
      heading: preferIncomingTelemetry ? (snapshot.heading ?? current.heading) : (current.heading ?? snapshot.heading),
      geoAltitude: preferIncomingTelemetry ? (snapshot.geoAltitude ?? current.geoAltitude) : (current.geoAltitude ?? snapshot.geoAltitude),
      baroAltitude: preferIncomingTelemetry ? (snapshot.baroAltitude ?? current.baroAltitude) : (current.baroAltitude ?? snapshot.baroAltitude),
      flightNumber: snapshot.flightNumber ?? current.flightNumber,
      airline: snapshot.airline ?? current.airline,
      aircraft: snapshot.aircraft ?? current.aircraft,
      departureAirport: snapshot.departureAirport ?? current.departureAirport,
      arrivalAirport: snapshot.arrivalAirport ?? current.arrivalAirport,
      sourceDetails: mergeSourceDetails(current.sourceDetails, snapshot.sourceDetails),
      dataSource: mergeDataSource(current.dataSource, snapshot.dataSource) ?? 'opensky',
    };

    return nextHistory;
  }

  const lastEntry = nextHistory.at(-1);
  const previousComparable = lastEntry ? buildSnapshotMaterialKey(lastEntry) : null;
  const snapshotComparable = buildSnapshotMaterialKey(snapshot);

  if (lastEntry?.trigger === snapshot.trigger && previousComparable === snapshotComparable) {
    return nextHistory;
  }

  nextHistory.push(snapshot);
  return nextHistory.slice(-8);
}

function mergeFetchHistorySources(...lists: Array<FlightFetchSnapshot[] | undefined>): FlightFetchSnapshot[] {
  return lists.reduce<FlightFetchSnapshot[]>((merged, history) => {
    let nextMerged = merged;

    for (const snapshot of history ?? []) {
      nextMerged = mergeFlightFetchHistory(nextMerged, snapshot);
    }

    return nextMerged;
  }, []);
}

function reconcileTrackerPayload(
  previous: TrackerApiResponse | null,
  incoming: TrackerApiResponse,
  trigger: FlightFetchTrigger,
  historyByFlight: Map<string, FlightFetchSnapshot[]>,
  background: boolean,
): TrackerApiResponse {
  const previousByIcao24 = new Map((previous?.flights ?? []).map((flight) => [flight.icao24, flight]));
  const mergedFlights = incoming.flights.map((flight) => reconcileTrackedFlight(previousByIcao24.get(flight.icao24), flight));

  if (background && previous && normalizeHistoryIdentifier(previous.query) === normalizeHistoryIdentifier(incoming.query)) {
    const unresolvedIdentifiers = new Set(incoming.notFoundIdentifiers.map((identifier) => normalizeHistoryIdentifier(identifier)));

    for (const previousFlight of previous.flights) {
      if (mergedFlights.some((flight) => flight.icao24 === previousFlight.icao24)) {
        continue;
      }

      const shouldPreserve = previousFlight.matchedBy.some((value) => unresolvedIdentifiers.has(normalizeHistoryIdentifier(value)))
        || unresolvedIdentifiers.has(normalizeHistoryIdentifier(previousFlight.callsign))
        || unresolvedIdentifiers.has(normalizeHistoryIdentifier(previousFlight.icao24));
      if (shouldPreserve) {
        mergedFlights.push(previousFlight);
      }
    }
  }

  mergedFlights.sort((first, second) => first.callsign.localeCompare(second.callsign));

  return {
    ...incoming,
    flights: mergedFlights.map((flight) => {
      const snapshot = buildFlightFetchSnapshot(flight, incoming.fetchedAt, trigger);
      const fetchHistory = mergeFlightFetchHistory(
        mergeFetchHistorySources(
          historyByFlight.get(flight.icao24),
          previousByIcao24.get(flight.icao24)?.fetchHistory,
          flight.fetchHistory,
        ),
        snapshot,
      );
      historyByFlight.set(flight.icao24, fetchHistory);

      return {
        ...flight,
        fetchHistory,
      };
    }),
  };
}

function summarizeSnapshotChanges(
  snapshot: FlightFetchSnapshot,
  previousSnapshot: FlightFetchSnapshot | null,
): Array<{ label: string; value: string }> {
  if (!previousSnapshot) {
    return [{ label: 'Diff', value: 'Initial capture' }];
  }

  const changes: Array<{ label: string; value: string }> = [];
  const currentRoute = `${snapshot.route.departureAirport ?? '—'} → ${snapshot.route.arrivalAirport ?? '—'}`;
  const previousRoute = `${previousSnapshot.route.departureAirport ?? '—'} → ${previousSnapshot.route.arrivalAirport ?? '—'}`;

  if (snapshot.dataSource !== previousSnapshot.dataSource) {
    changes.push({
      label: 'Source',
      value: `${formatDataSourceLabel(previousSnapshot.dataSource)} → ${formatDataSourceLabel(snapshot.dataSource)}`,
    });
  }

  for (const source of TRACKER_SOURCES) {
    const currentSourceDetail = snapshot.sourceDetails?.find((detail) => detail.source === source);
    const previousSourceDetail = previousSnapshot.sourceDetails?.find((detail) => detail.source === source);
    const currentStatus = currentSourceDetail?.status ?? 'skipped';
    const previousStatus = previousSourceDetail?.status ?? 'skipped';

    if (currentStatus !== previousStatus) {
      changes.push({
        label: formatSourceLabel(source),
        value: `${formatSourceStatusLabel(previousStatus)} → ${formatSourceStatusLabel(currentStatus)}`,
      });
    }
  }

  if (currentRoute !== previousRoute) {
    changes.push({ label: 'Route', value: `${previousRoute} → ${currentRoute}` });
  }

  if ((snapshot.geoAltitude ?? null) !== (previousSnapshot.geoAltitude ?? null)) {
    changes.push({
      label: 'Altitude',
      value: `${formatAltitude(previousSnapshot.geoAltitude)} → ${formatAltitude(snapshot.geoAltitude)}`,
    });
  }

  if ((snapshot.velocity ?? null) !== (previousSnapshot.velocity ?? null)) {
    changes.push({
      label: 'Speed',
      value: `${formatSpeed(previousSnapshot.velocity)} → ${formatSpeed(snapshot.velocity)}`,
    });
  }

  if (snapshot.onGround !== previousSnapshot.onGround) {
    changes.push({
      label: 'Status',
      value: `${previousSnapshot.onGround ? 'On the ground' : 'In flight'} → ${snapshot.onGround ? 'On the ground' : 'In flight'}`,
    });
  }

  if ((snapshot.airline?.name ?? null) !== (previousSnapshot.airline?.name ?? null)) {
    changes.push({
      label: 'Airline',
      value: `${previousSnapshot.airline?.name ?? '—'} → ${snapshot.airline?.name ?? '—'}`,
    });
  }

  if ((snapshot.flightNumber ?? null) !== (previousSnapshot.flightNumber ?? null)) {
    changes.push({
      label: 'Flight',
      value: `${previousSnapshot.flightNumber ?? '—'} → ${snapshot.flightNumber ?? '—'}`,
    });
  }

  const currentAircraft = snapshot.aircraft?.model ?? snapshot.aircraft?.registration ?? snapshot.aircraft?.icao ?? snapshot.aircraft?.iata ?? null;
  const previousAircraft = previousSnapshot.aircraft?.model ?? previousSnapshot.aircraft?.registration ?? previousSnapshot.aircraft?.icao ?? previousSnapshot.aircraft?.iata ?? null;
  if (currentAircraft !== previousAircraft) {
    changes.push({
      label: 'Aircraft',
      value: `${previousAircraft ?? '—'} → ${currentAircraft ?? '—'}`,
    });
  }

  return changes.length > 0 ? changes : [{ label: 'Diff', value: 'No material change detected' }];
}

type AltitudeTrendChartPoint = {
  altitude: number;
  time: number | null;
  x: number;
  y: number;
};

function buildAltitudeTrendPath(points: AltitudeTrendChartPoint[]): string {
  return d3Line<AltitudeTrendChartPoint>()
    .x((point) => point.x)
    .y((point) => point.y)
    .curve(curveMonotoneX)(points) ?? '';
}

function AltitudeTrendChart({ flight }: { flight: TrackedFlight }) {
  const samples = useMemo(() => (
    flight.track
      .filter((point) => point.altitude != null && Number.isFinite(point.altitude))
      .slice(-24)
  ), [flight.track]);

  if (samples.length < 2) {
    return (
      <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/45 p-3">
        <div className="text-xs uppercase tracking-[0.2em] text-cyan-200/80">Altitude trend</div>
        <p className="mt-1 text-xs text-slate-400">Recent altitude history will appear here when track data is available.</p>
      </div>
    );
  }

  const width = 240;
  const height = 72;
  const padding = 6;
  const altitudes = samples.map((sample) => sample.altitude as number);
  const timedSamples = samples.filter((sample) => sample.time != null && Number.isFinite(sample.time));
  const minAltitude = Math.min(...altitudes);
  const maxAltitude = Math.max(...altitudes);
  const altitudeRange = Math.max(0, maxAltitude - minAltitude);
  const minTime = timedSamples[0]?.time ?? null;
  const maxTime = timedSamples.at(-1)?.time ?? null;
  const hasTimeScale = minTime != null && maxTime != null && maxTime > minTime;

  const altitudePadding = minAltitude === maxAltitude
    ? 300
    : Math.max(120, altitudeRange * 0.35);
  const altitudeDomainStart = minAltitude - altitudePadding;
  const altitudeDomainEnd = maxAltitude + altitudePadding;
  const timeDomainStart = minTime ?? 0;
  const timeDomainEnd = maxTime ?? Math.max(samples.length - 1, 1);
  const xScale = scaleLinear()
    .domain(hasTimeScale ? [timeDomainStart, timeDomainEnd] : [0, Math.max(samples.length - 1, 1)])
    .range([padding, width - padding]);
  const yScale = scaleLinear()
    .domain([altitudeDomainStart, altitudeDomainEnd])
    .range([height - padding, padding]);
  const scaleMarkers = [
    { label: 'High', value: maxAltitude },
    { label: 'Mid', value: minAltitude + (altitudeRange / 2) },
    { label: 'Low', value: minAltitude },
  ];

  const plottedPoints = samples.map((sample, index) => ({
    altitude: sample.altitude as number,
    time: sample.time,
    x: xScale(hasTimeScale && sample.time != null ? sample.time : index),
    y: yScale(sample.altitude as number),
  } satisfies AltitudeTrendChartPoint));
  const linePath = buildAltitudeTrendPath(plottedPoints);
  const lastPoint = plottedPoints.at(-1) ?? plottedPoints[plottedPoints.length - 1];
  const lastPointPosition = lastPoint
    ? {
        left: `${(lastPoint.x / width) * 100}%`,
        top: `${(lastPoint.y / height) * 100}%`,
      }
    : null;
  const currentAltitude = flight.current?.altitude ?? flight.geoAltitude ?? flight.baroAltitude ?? lastPoint?.altitude ?? null;
  const chartLabel = flight.callsign || flight.icao24.toUpperCase();

  return (
    <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/45 p-3">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-cyan-200/80">Altitude trend</div>
          <div className="text-[11px] text-slate-400">Recent track history</div>
        </div>
        <div className="text-right">
          <div className="text-sm font-semibold text-white">{formatAltitude(currentAltitude)}</div>
          <div className="text-[11px] text-slate-400">current</div>
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,4.5rem)_minmax(0,1fr)] items-stretch gap-3">
        <div className="flex h-20 flex-col justify-between text-[10px] leading-none text-slate-400">
          {scaleMarkers.map((marker) => (
            <div key={marker.label} className="space-y-0.5">
              <span className="sr-only">{`${marker.label} ${formatAltitude(marker.value)}`}</span>
              <div className="uppercase tracking-[0.18em] text-slate-500">{marker.label}</div>
              <div className="tabular-nums text-slate-200">{formatAltitude(marker.value)}</div>
            </div>
          ))}
        </div>

        <div className="relative block w-full rounded-lg text-left">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label={`Altitude history for ${chartLabel}`}
            className="h-20 w-full"
            preserveAspectRatio="none"
          >
            {scaleMarkers.map((marker) => (
              <line
                key={`guide-${marker.label}`}
                x1={padding}
                x2={width - padding}
                y1={yScale(marker.value)}
                y2={yScale(marker.value)}
                stroke="rgba(148, 163, 184, 0.24)"
                strokeWidth="1"
                strokeDasharray="4 4"
              />
            ))}
            <path
              d={linePath}
              fill="none"
              stroke="rgb(34 211 238)"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {lastPointPosition ? (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/80 bg-white shadow-[0_0_0_2px_rgba(34,211,238,0.28)]"
              style={lastPointPosition}
            />
          ) : null}
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
        <span>Range {formatAltitude(altitudeRange)}</span>
        <div className="flex items-center gap-3">
          <span>{samples[0]?.time ? formatTimestamp(samples[0].time * 1000) : 'Start'}</span>
          <span>{samples.at(-1)?.time ? formatTimestamp((samples.at(-1)?.time ?? 0) * 1000) : 'Now'}</span>
        </div>
      </div>
    </div>
  );
}

function syncTrackedFlightsUrl(query: string) {
  if (typeof window === 'undefined') {
    return;
  }

  const url = new URL(window.location.href);
  const trimmedQuery = query.trim();

  if (trimmedQuery) {
    url.searchParams.set(URL_QUERY_KEY, trimmedQuery);
  } else {
    url.searchParams.delete(URL_QUERY_KEY);
  }

  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

function buildSelectedFlightDetailsCacheKey(flight: TrackedFlight): string {
  return [
    flight.icao24,
    normalizeHistoryIdentifier(flight.callsign),
  ].join(':');
}

function formatAirportCodes(airport: AirportDetails | null, fallbackCode: string | null): string {
  const codes = [airport?.iata, airport?.icao, fallbackCode]
    .filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index);

  return codes.length ? codes.join(' • ') : '—';
}

function formatAirportLocation(airport: AirportDetails | null): string {
  const parts = [airport?.city, airport?.country].filter(Boolean);
  return parts.length ? parts.join(', ') : 'Location unavailable';
}

function SelectedFlightDetails({
  flight,
  details,
  isLoadingDetails,
  detailsError,
  fetchHistory = [],
  onOpenFetchHistory,
}: {
  flight: TrackedFlight;
  details: SelectedFlightDetailsPayload | null;
  isLoadingDetails: boolean;
  detailsError: string | null;
  fetchHistory?: FlightFetchSnapshot[];
  onOpenFetchHistory: () => void;
}) {
  const observedArrivalTime = sanitizeObservedTimestamp(details?.route?.lastSeen ?? flight.route.lastSeen, flight.lastContact);
  const observedStatusLabel = flight.onGround ? 'Arrival observed' : 'Last observed';
  const observedStatusTime = flight.onGround ? observedArrivalTime : flight.lastContact;
  const departureObservedTime = sanitizeObservedTimestamp(
    details?.route?.firstSeen ?? flight.route.firstSeen,
    observedStatusTime ?? flight.lastContact,
  );
  const airlineName = details?.airline?.name ?? flight.airline?.name ?? '—';
  const aircraftModel = details?.aircraft?.model ?? flight.aircraft?.model ?? '—';
  const aircraftRegistration = details?.aircraft?.registration ?? flight.aircraft?.registration ?? null;
  const dataSourceLabel = formatDataSourceLabel(
    details?.dataSource ?? flight.dataSource ?? 'opensky',
    mergeSourceDetails(flight.sourceDetails, details?.sourceDetails),
  );

  return (
    <div className="rounded-2xl border border-cyan-400/30 bg-cyan-500/10 p-4 text-sm text-slate-200 shadow-lg shadow-cyan-950/20">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-cyan-200/80">Selected flight</p>
          <h3 className="text-lg font-semibold text-white">{flight.callsign}</h3>
        </div>
        <span className="rounded-full border border-cyan-300/30 bg-slate-950/70 px-2.5 py-1 text-[11px] font-semibold text-cyan-100">
          {flight.icao24.toUpperCase()}
        </span>
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 [&>div]:min-w-0 [&_dd]:break-words">
        <div>
          <dt className="text-slate-400">Origin country</dt>
          <dd>{flight.originCountry}</dd>
        </div>
        <div>
          <dt className="text-slate-400">Route</dt>
          <dd>{flight.route.departureAirport ?? '—'} → {flight.route.arrivalAirport ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-slate-400">Airline</dt>
          <dd>{airlineName}</dd>
        </div>
        <div>
          <dt className="text-slate-400">Speed</dt>
          <dd>{formatSpeed(flight.velocity)}</dd>
        </div>
        <div>
          <dt className="text-slate-400">Altitude</dt>
          <dd>{formatAltitude(flight.geoAltitude ?? flight.baroAltitude)}</dd>
        </div>
        <div>
          <dt className="text-slate-400">Heading</dt>
          <dd>{flight.heading == null ? '—' : `${Math.round(flight.heading)}°`}</dd>
        </div>
        <div>
          <dt className="text-slate-400">Vertical rate</dt>
          <dd>{flight.verticalRate == null ? '—' : `${Math.round(flight.verticalRate)} m/s`}</dd>
        </div>
        <div>
          <dt className="text-slate-400">Aircraft</dt>
          <dd>{aircraftModel === '—' ? '—' : aircraftRegistration ? `${aircraftModel} • ${aircraftRegistration}` : aircraftModel}</dd>
        </div>
        <div>
          <dt className="text-slate-400">Status</dt>
          <dd>{flight.onGround ? 'On the ground' : 'In flight'}</dd>
        </div>
        <div>
          <dt className="text-slate-400">Last contact</dt>
          <dd>{formatRelativeSeconds(flight.lastContact)}</dd>
        </div>
        <div>
          <dt className="text-slate-400">Source</dt>
          <dd>{dataSourceLabel}</dd>
        </div>
      </dl>

      <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-slate-950/35 px-3 py-2 text-xs text-slate-300">
        <p>
          {fetchHistory.length} cached snapshot{fetchHistory.length === 1 ? '' : 's'} shared across refreshes.
        </p>
        <button
          type="button"
          onClick={onOpenFetchHistory}
          className="rounded-full border border-cyan-300/30 bg-cyan-500/10 px-3 py-1 font-semibold text-cyan-100 transition hover:border-cyan-200/50 hover:bg-cyan-500/15"
          aria-label={`View fetch history for ${flight.callsign}`}
        >
          View fetch history
        </button>
      </div>

      <AltitudeTrendChart flight={flight} />

      {isLoadingDetails ? (
        <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/40 px-3 py-2 text-sm text-slate-300">
          Loading airport details…
        </div>
      ) : null}

      {detailsError ? (
        <div className="mt-4 rounded-2xl border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-50">
          {detailsError}
        </div>
      ) : null}

      {details ? (
        <div className="mt-4 space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-slate-950/45 p-3">
              <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-cyan-200/80">
                <MapPin className="h-3.5 w-3.5" />
                Departure airport
              </div>
              <div className="text-sm font-semibold text-white">{details.departureAirport?.name ?? flight.route.departureAirport ?? '—'}</div>
              <div className="mt-1 text-xs text-slate-300">{formatAirportLocation(details.departureAirport)}</div>
              <div className="mt-1 text-xs text-cyan-100/90">
                {formatAirportCodes(details.departureAirport, details.route?.departureAirport ?? flight.route.departureAirport)}
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-slate-950/45 p-3">
              <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-cyan-200/80">
                <MapPin className="h-3.5 w-3.5" />
                Arrival airport
              </div>
              <div className="text-sm font-semibold text-white">{details.arrivalAirport?.name ?? flight.route.arrivalAirport ?? '—'}</div>
              <div className="mt-1 text-xs text-slate-300">{formatAirportLocation(details.arrivalAirport)}</div>
              <div className="mt-1 text-xs text-cyan-100/90">
                {formatAirportCodes(details.arrivalAirport, details.route?.arrivalAirport ?? flight.route.arrivalAirport)}
              </div>
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-2 [&>div]:min-w-0 [&_dd]:break-words">
            <div>
              <dt className="text-slate-400">Departure observed</dt>
              <dd>{formatDateTimeSeconds(departureObservedTime)}</dd>
            </div>
            <div>
              <dt className="text-slate-400">{observedStatusLabel}</dt>
              <dd>{formatDateTimeSeconds(observedStatusTime)}</dd>
            </div>
          </dl>
        </div>
      ) : null}
    </div>
  );
}

function FlightFetchHistoryModal({
  flight,
  history = [],
  onClose,
}: {
  flight: TrackedFlight;
  history?: FlightFetchSnapshot[];
  onClose: () => void;
}) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  const orderedHistory = [...history].reverse();

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Flight fetch history"
        className="max-h-[85vh] w-full max-w-3xl overflow-hidden rounded-3xl border border-cyan-400/30 bg-slate-950/95 shadow-2xl shadow-cyan-950/30"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-white/10 px-4 py-3">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-cyan-200/80">Fetch history</p>
            <h3 className="text-lg font-semibold text-white">{flight.callsign} • {history.length} snapshots</h3>
            <p className="text-xs text-slate-400">Reconciled provider payloads with quick diffs and raw snapshot data.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/10 bg-slate-900/80 p-2 text-slate-200 transition hover:border-white/20 hover:bg-slate-800"
            aria-label="Close flight fetch history"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[calc(85vh-5rem)] space-y-3 overflow-y-auto p-4">
          {orderedHistory.map((snapshot, index) => {
            const previousSnapshot = orderedHistory[index + 1] ?? null;
            const changes = summarizeSnapshotChanges(snapshot, previousSnapshot);
            const hasNoMaterialChanges = changes.length === 1
              && changes[0]?.label === 'Diff'
              && changes[0]?.value === 'No material change detected';
            const sourceBreakdown: FlightSourceDetail[] = TRACKER_SOURCES.map((source) => (
              snapshot.sourceDetails?.find((detail) => detail.source === source)
              ?? {
                source,
                status: 'skipped',
                usedInResult: false,
                reason: source === 'aviationstack'
                  ? 'No Aviationstack diagnostic data was recorded for this snapshot.'
                  : source === 'flightaware'
                    ? 'No FlightAware diagnostic data was recorded for this snapshot.'
                    : 'No OpenSky diagnostic data was recorded for this snapshot.',
                raw: null,
              } satisfies FlightSourceDetail
            ));

            const snapshotBody = (
              <div className="mt-3">
                <dl className="grid grid-cols-2 gap-2 text-xs [&>div]:min-w-0 [&_dd]:break-words">
                  <div>
                    <dt className="text-slate-400">Route</dt>
                    <dd>{snapshot.route.departureAirport ?? '—'} → {snapshot.route.arrivalAirport ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-400">Status</dt>
                    <dd>{snapshot.onGround ? 'On the ground' : 'In flight'}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-400">Altitude</dt>
                    <dd>{formatAltitude(snapshot.geoAltitude ?? snapshot.current?.altitude ?? null)}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-400">Speed</dt>
                    <dd>{formatSpeed(snapshot.velocity)}</dd>
                  </div>
                </dl>

                {!hasNoMaterialChanges ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {changes.map((change) => (
                      <span
                        key={`${snapshot.id}-${change.label}`}
                        className="rounded-full border border-white/10 bg-slate-950/70 px-2.5 py-1 text-[11px] text-slate-200"
                      >
                        <span className="font-semibold text-cyan-100">{change.label}:</span> {change.value}
                      </span>
                    ))}
                  </div>
                ) : null}

                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  {sourceBreakdown.map((detail) => (
                    <div key={`${snapshot.id}-${detail.source}`} className="rounded-2xl border border-white/10 bg-slate-950/55 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-sm font-semibold text-white">{formatSourceLabel(detail.source)}</div>
                          <div className="mt-1 text-[11px] text-slate-300">{detail.reason}</div>
                        </div>
                        <span className={`shrink-0 whitespace-nowrap rounded-full border px-2 py-1 text-[10px] font-semibold ${getSourceStatusClassName(detail.status)}`}>
                          {formatSourceStatusLabel(detail.status)}
                        </span>
                      </div>

                      <div className="mt-2 text-[11px] text-cyan-100/90">
                        {detail.usedInResult ? 'Used in the reconciled snapshot' : 'Not used in the reconciled snapshot'}
                      </div>

                      <details className="mt-2 rounded-xl border border-white/10 bg-slate-900/70 px-2.5 py-2 text-[11px] text-slate-300">
                        <summary className="cursor-pointer font-semibold text-cyan-100">View source payload</summary>
                        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words text-[11px] text-slate-200">{JSON.stringify(detail.raw ?? null, null, 2)}</pre>
                      </details>
                    </div>
                  ))}
                </div>

                <details className="mt-3 rounded-2xl border border-white/10 bg-slate-950/55 px-3 py-2 text-xs text-slate-300">
                  <summary className="cursor-pointer font-semibold text-cyan-100">View raw reconciled snapshot</summary>
                  <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words text-[11px] text-slate-200">{JSON.stringify(snapshot, null, 2)}</pre>
                </details>
              </div>
            );

            return (
              <section key={snapshot.id} className="rounded-2xl border border-white/10 bg-slate-900/70 p-4 text-sm text-slate-200">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-xs uppercase tracking-[0.2em] text-cyan-200/80">{formatFetchTriggerLabel(snapshot.trigger)}</div>
                    <div className="mt-1 text-sm text-slate-300">{formatDateTimeMillis(snapshot.capturedAt)}</div>
                  </div>
                  <span className="rounded-full border border-cyan-300/30 bg-cyan-500/10 px-2.5 py-1 text-[11px] font-semibold text-cyan-100">
                    {formatDataSourceLabel(snapshot.dataSource, snapshot.sourceDetails)}
                  </span>
                </div>

                {hasNoMaterialChanges ? (
                  <details className="group mt-3 text-xs text-slate-300">
                    <summary className="flex cursor-pointer list-none items-center gap-2 font-semibold text-cyan-100 transition hover:text-cyan-50 [&::-webkit-details-marker]:hidden">
                      <ChevronDown className="h-4 w-4 shrink-0 transition-transform duration-200 group-open:rotate-180" />
                      <span>No material change detected</span>
                    </summary>
                    {snapshotBody}
                  </details>
                ) : snapshotBody}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function TrackerTopBar({
  trackedCount,
  isRefreshing,
  onRefresh,
  lastUpdated,
  mapView,
  onMapViewChange,
}: {
  trackedCount: number;
  isRefreshing: boolean;
  onRefresh: () => void;
  lastUpdated: number | null;
  mapView: TrackerMapView;
  onMapViewChange: (nextView: TrackerMapView) => void;
}) {
  const { topBarRef } = useTrackerLayout();

  return (
    <div ref={topBarRef} className="pointer-events-none absolute inset-x-0 top-0 z-40 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 p-3 md:p-4">
      <div className="pointer-events-auto min-w-0 w-fit max-w-full justify-self-start rounded-2xl border border-white/10 bg-slate-950/75 px-4 py-3 backdrop-blur-md">
        <div className="flex items-center gap-2 text-cyan-200">
          <Radar className="h-4 w-4" />
          <span className="text-xs font-semibold uppercase tracking-[0.24em]">Live flight tracker</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-200">
          <span>{trackedCount} tracked</span>
          <span className="text-slate-500">•</span>
          <span>updated {formatTimestamp(lastUpdated)}</span>
        </div>
      </div>

      <div className="pointer-events-auto flex flex-col items-end gap-2 md:flex-row md:flex-wrap md:items-center md:justify-end">
        <FlightMapViewToggle mapView={mapView} onChange={onMapViewChange} />
        <TrackerZoomControls />
        <button
          type="button"
          onClick={onRefresh}
          className="inline-flex h-9 w-9 items-center justify-center gap-2 rounded-full border border-white/12 bg-slate-950/80 p-2 text-sm font-medium text-slate-100 shadow backdrop-blur-sm transition hover:border-white/20 hover:bg-slate-900 lg:w-auto lg:px-3"
        >
          <RefreshCw className={`h-4 w-4 shrink-0 ${isRefreshing ? 'animate-spin' : ''}`} />
          <span className="hidden lg:inline">Refresh</span>
        </button>
      </div>
    </div>
  );
}

function FlightTrackerDashboard({
  map,
  mapView,
  onMapViewChange,
  mapReady,
  loadingTargetView,
  onMapReady,
}: FlightTrackerDashboardProps) {
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [data, setData] = useState<TrackerApiResponse | null>(null);
  const [selectedIcao24, setSelectedIcao24] = useState<string | null>(null);
  const [selectedFlightDetails, setSelectedFlightDetails] = useState<SelectedFlightDetailsPayload | null>(null);
  const [selectedFlightDetailsError, setSelectedFlightDetailsError] = useState<string | null>(null);
  const [isLoadingSelectedFlightDetails, setIsLoadingSelectedFlightDetails] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isFetchHistoryOpen, setIsFetchHistoryOpen] = useState(false);
  const [forceDetailsRefreshAt, setForceDetailsRefreshAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [staleMatchNotice, setStaleMatchNotice] = useState<string | null>(null);
  const dataRef = useRef<TrackerApiResponse | null>(null);
  const selectedFlightDetailsCacheRef = useRef<Map<string, SelectedFlightDetailsPayload>>(new Map());
  const flightFetchHistoryRef = useRef<Map<string, FlightFetchSnapshot[]>>(new Map());

  const resetTracking = useCallback((nextQuery = '') => {
    const trimmedQuery = nextQuery.trim();

    setQuery(nextQuery);
    setSubmittedQuery('');
    setData(null);
    dataRef.current = null;
    setSelectedIcao24(null);
    setSelectedFlightDetails(null);
    setSelectedFlightDetailsError(null);
    setIsLoadingSelectedFlightDetails(false);
    setIsLoading(false);
    setIsRefreshing(false);
    setIsFetchHistoryOpen(false);
    setForceDetailsRefreshAt(null);
    setError(null);
    setStaleMatchNotice(null);
    selectedFlightDetailsCacheRef.current.clear();
    flightFetchHistoryRef.current.clear();

    if (typeof window !== 'undefined') {
      if (trimmedQuery) {
        window.localStorage.setItem(STORAGE_KEY, trimmedQuery);
      } else {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    }

    syncTrackedFlightsUrl(trimmedQuery);
  }, []);

  const selectedFlight = useMemo(() => {
    return data?.flights.find((flight) => flight.icao24 === selectedIcao24) ?? data?.flights[0] ?? null;
  }, [data?.flights, selectedIcao24]);

  const selectedFlightDetailsCacheKey = useMemo(() => {
    return selectedFlight ? buildSelectedFlightDetailsCacheKey(selectedFlight) : null;
  }, [selectedFlight]);

  const selectedFlightHistory = useMemo(() => {
    if (!selectedFlight) {
      return [];
    }

    return mergeFetchHistorySources(
      selectedFlight.fetchHistory,
      flightFetchHistoryRef.current.get(selectedFlight.icao24),
    );
  }, [selectedFlight]);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    if (!selectedFlight) {
      setIsFetchHistoryOpen(false);
    }
  }, [selectedFlight]);

  useEffect(() => {
    if (!selectedFlight || !selectedFlightDetailsCacheKey) {
      setSelectedFlightDetails(null);
      setSelectedFlightDetailsError(null);
      setIsLoadingSelectedFlightDetails(false);
      return;
    }

    const shouldForceRefresh = forceDetailsRefreshAt != null;
    const cachedDetails = shouldForceRefresh ? null : selectedFlightDetailsCacheRef.current.get(selectedFlightDetailsCacheKey);
    if (cachedDetails) {
      setSelectedFlightDetails({
        ...cachedDetails,
        fetchHistory: mergeFetchHistorySources(selectedFlight.fetchHistory, cachedDetails.fetchHistory),
      });
      setSelectedFlightDetailsError(null);
      setIsLoadingSelectedFlightDetails(false);
      return;
    }

    const searchParams = new URLSearchParams({
      icao24: selectedFlight.icao24,
      callsign: selectedFlight.callsign,
    });

    if (selectedFlight.route.departureAirport) {
      searchParams.set('departureAirport', selectedFlight.route.departureAirport);
    }

    if (selectedFlight.route.arrivalAirport) {
      searchParams.set('arrivalAirport', selectedFlight.route.arrivalAirport);
    }

    const referenceTime = selectedFlight.lastContact ?? selectedFlight.route.lastSeen ?? selectedFlight.route.firstSeen;
    if (referenceTime) {
      searchParams.set('referenceTime', String(referenceTime));
    }

    if (selectedFlight.route.lastSeen) {
      searchParams.set('lastSeen', String(selectedFlight.route.lastSeen));
    }

    if (shouldForceRefresh) {
      searchParams.set('refresh', '1');
    }

    let isCancelled = false;
    setSelectedFlightDetails((current) => (current?.icao24 === selectedFlight.icao24 ? current : null));
    setSelectedFlightDetailsError(null);
    setIsLoadingSelectedFlightDetails(true);

    void (async () => {
      try {
        const response = await fetch(`/api/tracker/details?${searchParams.toString()}`, {
          cache: 'no-store',
        });
        const payload = await response.json() as SelectedFlightDetailsPayload & { error?: string };

        if (!response.ok) {
          throw new Error(payload.error || 'Unable to fetch airport details for this flight.');
        }

        if (isCancelled) {
          return;
        }

        const previousDetails = (selectedFlightDetails?.icao24 === selectedFlight.icao24 ? selectedFlightDetails : null)
          ?? selectedFlightDetailsCacheRef.current.get(selectedFlightDetailsCacheKey)
          ?? null;
        const reconciledDetails = reconcileSelectedFlightDetails(previousDetails, payload);
        const snapshot = buildFlightFetchSnapshot(selectedFlight, reconciledDetails.fetchedAt, shouldForceRefresh ? 'manual-refresh' : 'search', reconciledDetails);
        const fetchHistory = mergeFlightFetchHistory(
          mergeFetchHistorySources(
            flightFetchHistoryRef.current.get(selectedFlight.icao24),
            selectedFlight.fetchHistory,
            reconciledDetails.fetchHistory,
          ),
          snapshot,
        );
        flightFetchHistoryRef.current.set(selectedFlight.icao24, fetchHistory);

        const nextDetails = {
          ...reconciledDetails,
          fetchHistory,
        } satisfies SelectedFlightDetailsPayload;

        selectedFlightDetailsCacheRef.current.set(selectedFlightDetailsCacheKey, nextDetails);
        setSelectedFlightDetails(nextDetails);
        setData((currentData) => {
          if (!currentData) {
            return currentData;
          }

          const nextFlights = currentData.flights.map((flight) => {
            if (flight.icao24 !== selectedFlight.icao24) {
              return flight;
            }

            return {
              ...flight,
              route: mergeRouteValues(flight.route, nextDetails.route),
              flightNumber: flight.flightNumber ?? nextDetails.flightNumber,
              airline: flight.airline ?? nextDetails.airline,
              aircraft: flight.aircraft ?? nextDetails.aircraft,
              fetchHistory,
            };
          });

          const nextData = {
            ...currentData,
            flights: nextFlights,
          } satisfies TrackerApiResponse;

          dataRef.current = nextData;
          return nextData;
        });
      } catch (caughtError) {
        if (isCancelled) {
          return;
        }

        setSelectedFlightDetailsError(
          caughtError instanceof Error ? caughtError.message : 'Unable to fetch airport details for this flight.',
        );
      } finally {
        if (!isCancelled) {
          setIsLoadingSelectedFlightDetails(false);
          if (shouldForceRefresh) {
            setForceDetailsRefreshAt(null);
          }
        }
      }
    })();

    return () => {
      isCancelled = true;
    };
  }, [forceDetailsRefreshAt, selectedFlight, selectedFlightDetailsCacheKey]);

  const runSearch = useCallback(async (
    rawQuery: string,
    options: {
      background?: boolean;
      forceRefresh?: boolean;
      trigger?: FlightFetchTrigger;
    } = {},
  ) => {
    const trimmedQuery = rawQuery.trim();
    const {
      background = false,
      forceRefresh = false,
      trigger = background ? 'auto-refresh' : 'search',
    } = options;

    if (!trimmedQuery) {
      resetTracking();
      return;
    }

    setError(null);
    if (!background) {
      setStaleMatchNotice(null);
    }

    if (forceRefresh) {
      selectedFlightDetailsCacheRef.current.clear();
      setForceDetailsRefreshAt(Date.now());
    }

    syncTrackedFlightsUrl(trimmedQuery);
    if (background) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }

    try {
      const searchParams = new URLSearchParams({ q: trimmedQuery });
      if (forceRefresh) {
        searchParams.set('refresh', '1');
      }

      const response = await fetch(`/api/tracker?${searchParams.toString()}`, {
        cache: 'no-store',
      });
      const payload = await response.json() as TrackerApiResponse & { error?: string };

      if (!response.ok) {
        throw new Error(payload.error || 'Unable to fetch live flight data.');
      }

      const currentData = dataRef.current;
      const nextData = reconcileTrackerPayload(currentData, payload, trigger, flightFetchHistoryRef.current, background);
      const shouldShowStaleNotice = background
        && payload.notFoundIdentifiers.length > 0
        && trimmedQuery === currentData?.query
        && nextData.flights.length > 0;

      setQuery(trimmedQuery);
      setSubmittedQuery(trimmedQuery);
      setData(nextData);
      dataRef.current = nextData;
      setSelectedFlightDetails((current) => {
        if (!current) {
          return current;
        }

        const matchingFlight = nextData.flights.find((flight) => flight.icao24 === current.icao24);
        if (!matchingFlight) {
          return null;
        }

        return {
          ...current,
          fetchHistory: mergeFetchHistorySources(matchingFlight.fetchHistory, current.fetchHistory),
        };
      });
      setStaleMatchNotice(
        shouldShowStaleNotice
          ? `No fresh live position for ${payload.notFoundIdentifiers.join(', ')}. Showing the last known route.`
          : null,
      );
      setSelectedIcao24((current) => {
        if (current && nextData.flights.some((flight) => flight.icao24 === current)) {
          return current;
        }

        return nextData.flights[0]?.icao24 ?? null;
      });

      if (typeof window !== 'undefined') {
        window.localStorage.setItem(STORAGE_KEY, trimmedQuery);
      }
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to fetch live flight data.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [resetTracking]);

  const canReset = Boolean(query.trim() || submittedQuery || data || error);

  useEffect(() => {
    const urlQuery = new URLSearchParams(window.location.search).get(URL_QUERY_KEY)?.trim();
    const savedQuery = window.localStorage.getItem(STORAGE_KEY)?.trim();
    const initialQuery = urlQuery || savedQuery;

    if (!initialQuery) {
      return;
    }

    setQuery(initialQuery);
    if (!urlQuery) {
      syncTrackedFlightsUrl(initialQuery);
    }
    void runSearch(initialQuery, { background: true, trigger: 'search' });
  }, [runSearch]);

  useEffect(() => {
    if (!submittedQuery) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void runSearch(submittedQuery, { background: true, trigger: 'auto-refresh' });
    }, AUTO_REFRESH_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [runSearch, submittedQuery]);

  const clearTrackedFlights = useCallback(() => {
    setQuery('');
    void runSearch('', { background: false, trigger: 'search' });
  }, [runSearch]);

  const sidebarContent = (
    <div className="space-y-4">
      <section className="rounded-2xl border border-white/10 bg-slate-950/55 p-4 backdrop-blur-sm">
        <div className="mb-3 flex items-center gap-2 text-cyan-200">
          <Plane className="h-4 w-4" />
          <h2 className="text-sm font-semibold uppercase tracking-[0.24em]">Track live flights</h2>
        </div>
        <p className="mb-4 text-sm text-slate-300">
          Enter one or more callsigns or ICAO24 identifiers. The map will show the origin, current position, and the available recent track history.
        </p>

        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void runSearch(query, { background: false, trigger: 'search' });
          }}
        >
          <label className="block text-xs font-medium uppercase tracking-[0.2em] text-slate-400" htmlFor="tracker-query">
            Flight identifiers
          </label>
          <textarea
            id="tracker-query"
            rows={3}
            value={query}
            onChange={(event) => {
              const nextQuery = event.target.value;

              if (!nextQuery.trim()) {
                resetTracking();
                return;
              }

              setQuery(nextQuery);
            }}
            placeholder="AFR12, DAL220 or 3c675a"
            className="w-full rounded-2xl border border-white/10 bg-slate-950/90 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-500/20"
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              className="inline-flex items-center gap-2 rounded-full bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isLoading}
            >
              {isLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              {isLoading ? 'Searching…' : 'Track flights'}
            </button>
            <button
              type="button"
              onClick={clearTrackedFlights}
              className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-slate-950/80 px-4 py-2 text-sm font-medium text-slate-100 transition hover:border-white/20 hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={!canReset}
              aria-label="Reset tracked flights"
            >
              <X className="h-4 w-4" />
              Reset
            </button>
            <span className="text-xs text-slate-400">Auto-refreshes every 60 seconds.</span>
          </div>
        </form>
      </section>

      {error ? (
        <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 p-4 text-sm text-rose-100">
          <div className="mb-1 flex items-center gap-2 font-semibold">
            <CircleAlert className="h-4 w-4" />
            Unable to refresh flights
          </div>
          <p>{error}</p>
        </div>
      ) : null}

      {staleMatchNotice ? (
        <div className="rounded-2xl border border-cyan-400/30 bg-cyan-500/10 p-4 text-sm text-cyan-50">
          <div className="mb-2 flex items-center gap-2 font-semibold">
            <Clock3 className="h-4 w-4" />
            Showing last known position
          </div>
          <p>{staleMatchNotice}</p>
        </div>
      ) : null}

      {data?.notFoundIdentifiers.length ? (
        <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 p-4 text-sm text-amber-50">
          <div className="mb-2 flex items-center gap-2 font-semibold">
            <Route className="h-4 w-4" />
            No live match yet
          </div>
          <p>{data.notFoundIdentifiers.join(', ')}</p>
          <p className="mt-2 text-amber-100/80">
            OpenSky can temporarily miss aircraft in low-coverage regions. When recent history is available, the tracker now keeps the last known route visible automatically.
          </p>
        </div>
      ) : null}

      {selectedFlight ? (
        <SelectedFlightDetails
          flight={selectedFlight}
          details={selectedFlightDetails}
          isLoadingDetails={isLoadingSelectedFlightDetails}
          detailsError={selectedFlightDetailsError}
          fetchHistory={selectedFlightHistory}
          onOpenFetchHistory={() => setIsFetchHistoryOpen(true)}
        />
      ) : null}

      <section className="space-y-3">
        <div className="flex items-center gap-2 text-xs uppercase tracking-[0.22em] text-slate-400">
          <Activity className="h-4 w-4" />
          Active matches
        </div>

        {data?.flights.length ? data.flights.map((flight, index) => {
          const isSelected = flight.icao24 === selectedFlight?.icao24;
          const flightColor = getFlightMapColor(index, isSelected);

          return (
            <button
              key={flight.icao24}
              type="button"
              onClick={() => setSelectedIcao24(flight.icao24)}
              className={`w-full rounded-2xl border p-4 text-left transition ${isSelected ? 'border-cyan-400/40 bg-cyan-500/10 shadow-lg shadow-cyan-950/10' : 'border-white/10 bg-slate-950/55 hover:border-white/20 hover:bg-slate-900/70'}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span
                      role="img"
                      aria-label={`Map color for ${flight.callsign}`}
                      className="inline-block h-2.5 w-2.5 rounded-full border border-white/60 shadow-sm"
                      style={{ backgroundColor: flightColor }}
                    />
                    <div className="text-base font-semibold text-white">{flight.callsign}</div>
                  </div>
                  <div className="text-xs text-slate-400">{flight.icao24.toUpperCase()} • {flight.originCountry}</div>
                </div>
                <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${flight.onGround ? 'bg-amber-500/20 text-amber-100' : 'bg-emerald-500/20 text-emerald-100'}`}>
                  {flight.onGround ? 'ground' : 'airborne'}
                </span>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 text-sm text-slate-300 [&>div]:min-w-0 [&_span]:break-words">
                <div className="flex items-center gap-2">
                  <Gauge className="h-4 w-4 shrink-0 text-slate-500" />
                  <span>{formatSpeed(flight.velocity)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Clock3 className="h-4 w-4 shrink-0 text-slate-500" />
                  <span>{formatRelativeSeconds(flight.lastContact)}</span>
                </div>
                <div className="col-span-2 flex items-center gap-2">
                  <Route className="h-4 w-4 shrink-0 text-slate-500" />
                  <span>{flight.route.departureAirport ?? '—'} → {flight.route.arrivalAirport ?? '—'}</span>
                </div>
              </div>
            </button>
          );
        }) : (
          <div className="rounded-2xl border border-dashed border-white/10 bg-slate-950/35 p-4 text-sm text-slate-400">
            No live flights yet. Try an active callsign or an aircraft ICAO24 identifier.
          </div>
        )}
      </section>
    </div>
  );

  return (
    <>
      {isFetchHistoryOpen && selectedFlight ? (
        <FlightFetchHistoryModal
          flight={selectedFlight}
          history={selectedFlightHistory}
          onClose={() => setIsFetchHistoryOpen(false)}
        />
      ) : null}

      <TrackerShell
        topBar={
          <TrackerTopBar
            trackedCount={data?.flights.length ?? 0}
            isRefreshing={isRefreshing}
            onRefresh={() => {
              void runSearch(submittedQuery || query, {
                background: true,
                forceRefresh: true,
                trigger: 'manual-refresh',
              });
            }}
            lastUpdated={data?.fetchedAt ?? null}
            mapView={mapView}
            onMapViewChange={onMapViewChange}
          />
        }
        showBackgroundGrid
        mapContent={
          <div className="relative h-[100dvh] w-full">
            <FlightMap
              map={map}
              flights={data?.flights ?? []}
              mapView={mapView}
              selectedIcao24={selectedFlight?.icao24 ?? null}
              selectedFlightDetails={selectedFlightDetails}
              onSelectFlight={setSelectedIcao24}
              onInitialZoomEnd={onMapReady}
            />
          </div>
        }
        sidebarContent={sidebarContent}
        isLoading={!mapReady}
        loadingContent={
          loadingTargetView === 'globe'
            ? <Globe className="animate-spin text-sky-400" size={64} strokeWidth={2.5} />
            : <MapIcon className="animate-spin text-sky-400" size={64} strokeWidth={2.5} />
        }
      />
    </>
  );
}

export default function FlightTrackerClient({ map }: FlightTrackerClientProps) {
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
  }, [handleMapLoadingStart]);

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
        <FlightTrackerDashboard
          map={map}
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
