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
import type { FlightMapAirportMarker, FriendAvatarInfo, FriendAvatarMarker, TrackerApiResponse, TrackedFlight } from '../flight/types';

const AUTO_REFRESH_MS = 60_000;
const MIN_MAP_LOADING_MS = 2_000;
const TIMELINE_MIN_SEGMENT_DISTANCE_KM = 600;
const TIMELINE_FALLBACK_SEGMENT_DISTANCE_KM = 1_200;
const TIMELINE_NODE_SIZE_PX = 14;

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

function toRadians(value: number): number {
  return value * (Math.PI / 180);
}

function computeAirportDistanceKm(from: FlightMapAirportMarker, to: FlightMapAirportMarker): number {
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

function computeAirportBearingDegrees(from: FlightMapAirportMarker, to: FlightMapAirportMarker): number {
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

    if (flight.onGround) {
      if (lastSeenMs != null) {
        return i + 1;
      }

      return i;
    }

    let progress = 0.5;
    if (firstSeenMs != null) {
      const effectiveEndMs = lastSeenMs ?? now;
      if (effectiveEndMs > firstSeenMs) {
        progress = Math.min(Math.max((now - firstSeenMs) / (effectiveEndMs - firstSeenMs), 0.1), 0.9);
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
    return lastPastLegIndex + 1;
  }

  return null;
}

function FriendTimelineCard({
  friend,
  friendStatuses,
  destinationAirport,
  now,
  airportMarkers,
  accentColor,
}: {
  friend: FriendTravelConfig;
  friendStatuses: FriendFlightStatus[];
  destinationAirport: string | null;
  now: number;
  airportMarkers: FlightMapAirportMarker[];
  accentColor: string;
}) {
  const currentTripLegs = getCurrentTripLegs(friend, friendStatuses, destinationAirport, now);
  const airports = buildAirportChain(currentTripLegs);
  const cursorRaw = computeTimelineCursorPosition(currentTripLegs, friendStatuses, now);

  const airportMarkerByCode = useMemo(() => {
    return new Map(
      airportMarkers.map((marker) => [marker.code.toUpperCase().trim(), marker] as const),
    );
  }, [airportMarkers]);

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

  const cursorRotationDegrees = activeLegIndex >= 0 ? 45 : -45;
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

  const normalizedDestinationAirport = destinationAirport?.toUpperCase().trim() ?? null;
  const hasArrivedAtDestination = normalizedDestinationAirport != null
    && airports.length > 0
    && airports[airports.length - 1] === normalizedDestinationAirport
    && cursorRaw != null
    && cursorRaw >= airports.length - 1;
  const hasStartedTrip = currentTripLegs.some((leg) => {
    const departureMs = Date.parse(leg.departureTime);
    return !Number.isNaN(departureMs) && departureMs <= now;
  });
  const hasFutureLeg = currentTripLegs.some((leg) => {
    const departureMs = Date.parse(leg.departureTime);
    return !Number.isNaN(departureMs) && departureMs > now;
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
            {destinationAirport ? (
              <span className="ml-1 text-slate-500">
                · {tripProgressLabel}
              </span>
            ) : null}
          </div>
        </div>

        {lastContactSeconds != null ? (
          <div className="flex shrink-0 items-center gap-1 text-[11px] text-slate-400">
            <Clock3 className="h-3 w-3" />
            <span>{formatRelativeSeconds(lastContactSeconds)}</span>
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
                const isDest = destinationAirport != null && airport === destinationAirport.toUpperCase().trim();
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
                const isDest = destinationAirport != null && finalAirport === destinationAirport.toUpperCase().trim();
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
}: {
  tripName: string | null;
  friendCount: number;
  trackedCount: number;
  lastUpdated: number | null;
  isRefreshing: boolean;
  onRefresh: () => void;
  mapView: TrackerMapView;
  onMapViewChange: (nextView: TrackerMapView) => void;
}) {
  const locale = useLocale();
  const { topBarRef } = useTrackerLayout();

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

      <div className="pointer-events-none flex flex-col items-end gap-2 md:flex-row md:flex-wrap md:items-center md:justify-end">
        <Link
          href="/chantal/config"
          className="pointer-events-auto inline-flex h-9 w-9 items-center justify-center gap-2 rounded-full border border-white/12 bg-slate-950/80 p-2 text-sm font-medium text-slate-100 shadow backdrop-blur-sm transition hover:border-white/20 hover:bg-slate-900 lg:w-auto lg:px-3"
        >
          <Settings2 className="h-4 w-4 shrink-0" />
          <span className="hidden lg:inline">Config</span>
        </Link>
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
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const autoLockSignatureRef = useRef<string | null>(null);

  const identifiers = useMemo(() => extractFriendTrackerIdentifiers(config), [config]);
  const identifiersQuery = identifiers.join(',');

  const statuses = useMemo(() => buildFriendFlightStatuses(config, data?.flights ?? []), [config, data?.flights]);

  const visibleFlights = useMemo(() => {
    const flightsByIcao24 = new Map<string, TrackedFlight>();

    for (const status of statuses) {
      if (status.flight) {
        flightsByIcao24.set(status.flight.icao24, status.flight);
      }
    }

    for (const flight of data?.flights ?? []) {
      if (!flightsByIcao24.has(flight.icao24)) {
        flightsByIcao24.set(flight.icao24, flight);
      }
    }

    return Array.from(flightsByIcao24.values());
  }, [data?.flights, statuses]);

  const flightLabels = useMemo(() => {
    return Object.fromEntries(
      statuses
        .filter((status) => status.flight)
        .map((status) => [status.flight!.icao24, status.label]),
    ) satisfies Record<string, string>;
  }, [statuses]);

  const flightColorIndexMap = useMemo(() => {
    return new Map(
      statuses
        .filter((status) => status.flight)
        .map((status, index) => [status.flight!.icao24, index]),
    );
  }, [statuses]);

  const flightAvatars = useMemo<Record<string, FriendAvatarInfo[]>>(() => {
    const result: Record<string, FriendAvatarInfo[]> = {};

    for (const status of statuses) {
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
  }, [statuses, flightColorIndexMap]);

  const staticFriendMarkers = useMemo<FriendAvatarMarker[]>(() => {
    const seen = new Set<string>();
    return statuses
      .filter((status) => !status.flight && status.leg.from)
      .flatMap((status, index) => {
        if (seen.has(status.friend.id)) {
          return [];
        }

        const airportCode = status.leg.from?.trim().toUpperCase() ?? '';
        const airportMarker = airportMarkers.find(
          (m) => m.code.toUpperCase() === airportCode,
        );

        if (!airportMarker) {
          return [];
        }

        seen.add(status.friend.id);

        return [{
          id: status.friend.id,
          name: status.friend.name || status.label,
          avatarUrl: status.friend.avatarUrl ?? null,
          color: getFlightMapColor(index, false),
          latitude: airportMarker.latitude,
          longitude: airportMarker.longitude,
        } satisfies FriendAvatarMarker];
      });
  }, [statuses, airportMarkers]);

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

  const currentTrip = getCurrentTripConfig(config);
  const totalFriends = config.friends.length;
  const now = Date.now();
  const destinationAirport = config.destinationAirport ?? null;

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
          <div className="mb-1 flex items-center gap-1.5 font-semibold">
            <Clock3 className="h-3.5 w-3.5" />
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
            now={now}
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
