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
  Zap,
} from 'lucide-react';
import { Link } from '~/i18n/navigation';
import {
  buildAirportChain,
  getCurrentTripConfig,
  normalizeFriendsTrackerConfig,
  parseDestinationAirportCodes,
  type FriendsTrackerConfig,
  type FriendTravelConfig,
} from '~/lib/friendsTracker';
import type {
  ChantalFriendPosition,
  ChantalPositionSnapshot,
  ChantalV2CronResult,
  ChantalV2SnapshotsResponse,
} from '~/lib/chantalV2';
import type { WorldMapPayload } from '~/lib/server/worldMap';
import TrackerShell from '../TrackerShell';
import TrackerZoomControls from '../TrackerZoomControls';
import { TrackerLayoutProvider, useTrackerLayout } from '../contexts/TrackerLayoutContext';
import FlightMap from '../flight/FlightMap';
import { getFlightMapColor } from '../flight/colors';
import { FlightMapProvider } from '../flight/contexts/FlightMapProvider';
import FlightMapViewToggle, { type TrackerMapView } from '../flight/FlightMapViewToggle';
import type {
  FlightMapAirportMarker,
  FlightMapPoint,
  FriendAvatarInfo,
  FriendAvatarMarker,
  TrackedFlight,
} from '../flight/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AUTO_REFRESH_MS = 60_000;
const MIN_MAP_LOADING_MS = 2_000;
const WAYBACK_STEP_MS = 5 * 60 * 1000;
const WAYBACK_LIVE_THRESHOLD_MS = 60 * 1000;
const WAYBACK_RETURN_TO_LIVE_THRESHOLD_MS = Math.max(WAYBACK_LIVE_THRESHOLD_MS, WAYBACK_STEP_MS);
const TIMELINE_MIN_SEGMENT_DISTANCE_KM = 600;
const TIMELINE_FALLBACK_SEGMENT_DISTANCE_KM = 1_200;
const TIMELINE_NODE_SIZE_PX = 14;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

interface GeoPoint {
  latitude: number;
  longitude: number;
}

function computeDistanceKm(from: GeoPoint, to: GeoPoint): number {
  const earthRadiusKm = 6_371;
  const latDelta = toRadians(to.latitude - from.latitude);
  const lonDelta = toRadians(to.longitude - from.longitude);
  const fromLat = toRadians(from.latitude);
  const toLat = toRadians(to.latitude);
  const a = Math.sin(latDelta / 2) ** 2
    + Math.cos(fromLat) * Math.cos(toLat) * Math.sin(lonDelta / 2) ** 2;

  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function snapWaybackSliderValue(valueMs: number, startMs: number, endMs: number): number {
  const clampedValueMs = Math.min(Math.max(valueMs, startMs), endMs);
  const clampedOffsetMs = Math.max(0, clampedValueMs - startMs);
  const snappedValueMs = startMs + Math.round(clampedOffsetMs / WAYBACK_STEP_MS) * WAYBACK_STEP_MS;
  return Math.min(snappedValueMs, endMs);
}

function estimateSegmentWeight(distanceKm: number | null): number {
  const normalized = Math.max(distanceKm ?? TIMELINE_FALLBACK_SEGMENT_DISTANCE_KM, TIMELINE_MIN_SEGMENT_DISTANCE_KM);
  return Math.sqrt(normalized / TIMELINE_MIN_SEGMENT_DISTANCE_KM);
}

// ---------------------------------------------------------------------------
// Snapshot → map data conversion
// ---------------------------------------------------------------------------

/**
 * Builds a synthetic TrackedFlight from a snapshot position.
 * The "track" is just two points: origin airport → current position.
 * This is enough for the map to draw a path and show the avatar marker.
 */
function buildSyntheticFlight(
  position: ChantalFriendPosition,
  airportMarkerByCode: Map<string, FlightMapAirportMarker>,
  capturedAt: number,
): TrackedFlight | null {
  if (position.latitude == null || position.longitude == null) {
    return null;
  }

  const timeSeconds = Math.round(capturedAt / 1000);

  const currentPoint: FlightMapPoint = {
    time: timeSeconds,
    latitude: position.latitude,
    longitude: position.longitude,
    x: 0,
    y: 0,
    altitude: position.altitude,
    heading: position.heading,
    onGround: position.onGround,
  };

  const fromCode = position.fromAirport?.toUpperCase() ?? '';
  const fromMarker = fromCode ? airportMarkerByCode.get(fromCode) ?? null : null;
  const originPoint: FlightMapPoint | null = fromMarker
    ? {
        time: timeSeconds - 3600,
        latitude: fromMarker.latitude,
        longitude: fromMarker.longitude,
        x: 0,
        y: 0,
        altitude: 0,
        heading: null,
        onGround: true,
      }
    : null;

  const track: FlightMapPoint[] = originPoint
    ? [originPoint, currentPoint]
    : [currentPoint];

  return {
    icao24: `snapshot-${position.friendId}`,
    callsign: position.flightNumber ?? '',
    originCountry: '',
    matchedBy: position.flightNumber ? [position.flightNumber] : [],
    lastContact: position.lastContactAt,
    current: currentPoint,
    originPoint,
    track,
    rawTrack: [],
    onGround: position.onGround,
    velocity: null,
    heading: position.heading,
    verticalRate: null,
    geoAltitude: position.altitude,
    baroAltitude: null,
    squawk: null,
    category: null,
    route: {
      departureAirport: position.fromAirport,
      arrivalAirport: position.toAirport,
      firstSeen: originPoint?.time ?? null,
      lastSeen: null,
    },
    flightNumber: position.flightNumber,
  };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function FriendV2Card({
  friend,
  position,
  destinationAirport,
  referenceTimeMs,
  airportMarkers,
  accentColor,
}: {
  friend: FriendTravelConfig;
  position: ChantalFriendPosition | null;
  destinationAirport: string | null;
  referenceTimeMs: number;
  airportMarkers: FlightMapAirportMarker[];
  accentColor: string;
}) {
  const airportMarkerByCode = useMemo(() => (
    new Map(airportMarkers.map((m) => [m.code.toUpperCase().trim(), m] as const))
  ), [airportMarkers]);

  // Build airport chain from config legs.
  const airports = useMemo(() => buildAirportChain(friend.flights), [friend.flights]);

  const timelineSegments = useMemo(() => (
    airports.slice(0, -1).map((fromAirport, index) => {
      const toAirport = airports[index + 1]!;
      const fromMarker = airportMarkerByCode.get(fromAirport);
      const toMarker = airportMarkerByCode.get(toAirport);
      const distanceKm = fromMarker && toMarker
        ? computeDistanceKm(fromMarker, toMarker)
        : null;

      return {
        id: `${fromAirport}-${toAirport}-${index}`,
        fromAirport,
        toAirport,
        distanceKm,
        weight: estimateSegmentWeight(distanceKm),
      };
    })
  ), [airports, airportMarkerByCode]);

  // Compute cursor position from position snapshot.
  const cursorRaw = useMemo<number | null>(() => {
    if (!position || airports.length < 2) {
      return null;
    }

    const fromCode = position.fromAirport?.toUpperCase() ?? null;
    const toCode = position.toAirport?.toUpperCase() ?? null;

    if (!fromCode || !toCode) {
      return null;
    }

    const legIndex = airports.findIndex((a, i) => a === fromCode && airports[i + 1] === toCode);

    if (legIndex === -1) {
      return null;
    }

    if (position.status === 'on-ground') {
      return legIndex + 1;
    }

    if (position.status === 'airborne' && position.latitude != null && position.longitude != null) {
      const fromMarker = airportMarkerByCode.get(fromCode);
      const toMarker = airportMarkerByCode.get(toCode);

      if (fromMarker && toMarker) {
        const totalDistanceKm = computeDistanceKm(fromMarker, toMarker);
        const distanceToDestinationKm = computeDistanceKm(
          { latitude: position.latitude, longitude: position.longitude },
          toMarker,
        );

        if (totalDistanceKm > 0) {
          const spatialProgress = Math.min(Math.max(1 - (distanceToDestinationKm / totalDistanceKm), 0.05), 0.95);
          if (Number.isFinite(spatialProgress)) {
            return legIndex + spatialProgress;
          }
        }
      }

      return legIndex + 0.5;
    }

    // Scheduled / awaiting: cursor stays at departure airport of the upcoming leg.
    const nextDeparture = friend.flights.find((leg) => {
      const dep = Date.parse(leg.departureTime);
      return Number.isFinite(dep) && dep > referenceTimeMs;
    });

    if (nextDeparture?.from) {
      const idx = airports.findIndex((a) => a === nextDeparture.from?.toUpperCase());
      return idx >= 0 ? idx : 0;
    }

    return 0;
  }, [airports, airportMarkerByCode, friend.flights, position, referenceTimeMs]);

  const segmentWeights = useMemo(() => timelineSegments.map((s) => s.weight), [timelineSegments]);

  const totalWeight = useMemo(() => segmentWeights.reduce((sum, w) => sum + w, 0), [segmentWeights]);

  const cursorFraction = useMemo(() => {
    if (cursorRaw == null || segmentWeights.length === 0 || totalWeight <= 0) {
      return null;
    }

    const clamped = Math.min(Math.max(cursorRaw, 0), segmentWeights.length);
    let traversed = 0;

    for (let i = 0; i < segmentWeights.length; i++) {
      const w = segmentWeights[i] ?? 1;
      if (clamped <= i + 1) {
        const segmentProgress = Math.max(0, Math.min(clamped - i, 1));
        return (traversed + segmentProgress * w) / totalWeight;
      }

      traversed += w;
    }

    return 1;
  }, [cursorRaw, segmentWeights, totalWeight]);

  const clampedCursorFraction = cursorFraction == null ? null : Math.min(Math.max(cursorFraction, 0), 1);
  const cursorLeft = clampedCursorFraction == null
    ? null
    : `calc(${TIMELINE_NODE_SIZE_PX / 2}px + ${clampedCursorFraction} * (100% - ${TIMELINE_NODE_SIZE_PX}px))`;

  const destinationAirports = useMemo(() => parseDestinationAirportCodes(destinationAirport), [destinationAirport]);
  const hasDestination = destinationAirports.length > 0;
  const hasArrivedAtDestination = hasDestination
    && airports.length > 0
    && destinationAirports.includes(airports[airports.length - 1] ?? '')
    && cursorRaw != null
    && cursorRaw >= airports.length - 1;

  const statusBadge = !position
    ? 'awaiting'
    : position.status === 'airborne'
    ? 'in flight'
    : position.status === 'on-ground'
    ? hasArrivedAtDestination
      ? 'arrived'
      : 'on ground'
    : position.status === 'scheduled'
    ? 'scheduled'
    : 'awaiting';

  const statusColor = statusBadge === 'arrived' || statusBadge === 'in flight'
    ? 'bg-emerald-500/20 text-emerald-200'
    : statusBadge === 'on ground'
    ? 'bg-cyan-500/20 text-cyan-200'
    : 'bg-slate-700/60 text-slate-400';

  const initials = getFriendInitials(friend.name);
  const cursorIconMode = cursorRaw != null && cursorRaw >= Math.max(airports.length - 1, 0)
    ? 'landing'
    : cursorRaw != null && cursorRaw <= 0
    ? 'takeoff'
    : 'plane';

  const isAirborne = position?.status === 'airborne';
  const cursorRotationDegrees = isAirborne ? 45 : -45;

  return (
    <article className="rounded-2xl border border-white/10 bg-slate-950/55 p-3">
      {/* Header */}
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
            <img src={friend.avatarUrl} alt={friend.name} className="h-full w-full rounded-full object-cover" />
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
          {position?.flightNumber ? (
            <div className="text-[11px] text-slate-400">
              {position.flightNumber}
              {position.fromAirport && position.toAirport ? (
                <span className="ml-1 text-slate-500">
                  · {position.fromAirport} → {position.toAirport}
                </span>
              ) : null}
            </div>
          ) : (
            <div className="text-[11px] text-slate-500">
              {friend.flights.length} leg{friend.flights.length === 1 ? '' : 's'}
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          <div className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusColor}`}>
            {statusBadge}
          </div>
          {position?.lastContactAt != null ? (
            <div className="flex items-center gap-1 text-[11px] text-slate-400">
              <Clock3 className="h-3 w-3" />
              <span>{formatRelativeSeconds(position.lastContactAt, referenceTimeMs)}</span>
            </div>
          ) : null}
        </div>
      </div>

      {/* Timeline */}
      {airports.length >= 2 ? (
        <div className="mt-3 px-1">
          <div className="relative">
            <div className="relative flex items-start">
              {timelineSegments.map((segment, index) => {
                const airport = airports[index]!;
                const isDest = destinationAirports.includes(airport);
                const isCompleted = cursorRaw != null && index < cursorRaw;
                const segmentFill = cursorRaw == null ? 0 : Math.max(0, Math.min(cursorRaw - index, 1));

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
                            : isCompleted
                            ? 'border-cyan-400 bg-cyan-400'
                            : 'border-slate-500 bg-slate-800'
                        }`}
                      />
                      <span
                        className={`absolute left-1/2 top-[18px] w-10 -translate-x-1/2 truncate text-center text-[9px] leading-none ${
                          isDest ? 'font-semibold text-amber-300' : isCompleted ? 'text-cyan-300' : 'text-slate-500'
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
                const isCompleted = cursorRaw != null && airports.length - 1 <= cursorRaw;

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
                        isDest ? 'font-semibold text-amber-300' : isCompleted ? 'text-cyan-300' : 'text-slate-500'
                      }`}
                      title={finalAirport}
                    >
                      {finalAirport}
                    </span>
                  </div>
                );
              })()}

              {cursorLeft != null ? (
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
                    <PlaneTakeoff className="h-3 w-3 text-cyan-200 drop-shadow-[0_0_4px_rgba(103,232,249,0.75)]" />
                  ) : cursorIconMode === 'landing' ? (
                    <PlaneLanding className="h-3 w-3 text-cyan-200 drop-shadow-[0_0_4px_rgba(103,232,249,0.75)]" />
                  ) : (
                    <Plane
                      className="h-3 w-3 text-cyan-200 drop-shadow-[0_0_4px_rgba(103,232,249,0.75)]"
                      style={{ transform: `rotate(${cursorRotationDegrees}deg)` }}
                    />
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-2 text-xs text-slate-500 italic">
          {airports.length === 1 ? `Origin: ${airports[0]}` : 'No airport data configured for this trip.'}
        </div>
      )}
    </article>
  );
}

// ---------------------------------------------------------------------------
// Top bar
// ---------------------------------------------------------------------------

function ChantalV2TopBar({
  tripName,
  friendCount,
  trackedCount,
  snapshotTime,
  isRefreshing,
  onRefresh,
  onTriggerCron,
  isCronRunning,
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
  snapshotTime: number | null;
  isRefreshing: boolean;
  onRefresh: () => void;
  onTriggerCron: () => void;
  isCronRunning: boolean;
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
        <div className="text-[11px] uppercase tracking-[0.24em] text-cyan-200">Chantal crew tracker · V2</div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-100">
          {tripName ? (
            <span className="rounded-full border border-cyan-400/30 bg-cyan-500/10 px-2 py-0.5 text-[11px] font-semibold text-cyan-100">
              {tripName}
            </span>
          ) : null}
          <span>{friendCount} friends</span>
          <span className="text-slate-500">•</span>
          <span>{trackedCount} on the map</span>
        </div>
        <div className="mt-1 text-xs text-slate-400">
          Snapshot: {snapshotTime ? `${formatDateTimeMillis(snapshotTime, locale)} UTC` : 'none yet'}
        </div>
      </div>

      <div className="pointer-events-none relative flex flex-col items-end gap-2 md:flex-row md:flex-wrap md:items-center md:justify-end">
        <Link
          href="/chantal/config"
          className="pointer-events-auto inline-flex h-9 w-9 items-center justify-center gap-2 rounded-full border border-white/12 bg-slate-950/80 p-2 text-sm font-medium text-slate-100 shadow backdrop-blur-sm transition hover:border-white/20 hover:bg-slate-900 lg:w-auto lg:px-3"
        >
          <Settings2 className="h-4 w-4 shrink-0" />
          <span className="hidden lg:inline">Config</span>
        </Link>

        <button
          type="button"
          onClick={onTriggerCron}
          disabled={isCronRunning}
          title="Take a position snapshot now"
          className="pointer-events-auto inline-flex h-9 w-9 items-center justify-center gap-2 rounded-full border border-white/12 bg-slate-950/80 p-2 text-sm font-medium text-slate-100 shadow backdrop-blur-sm transition hover:border-white/20 hover:bg-slate-900 disabled:opacity-50 lg:w-auto lg:px-3"
        >
          <Zap className={`h-4 w-4 shrink-0 ${isCronRunning ? 'animate-pulse' : ''}`} />
          <span className="hidden lg:inline">Snapshot</span>
        </button>

        {showWaybackButton ? (
          <div ref={waybackMenuRef} className="relative pointer-events-auto">
            <button
              type="button"
              onClick={onToggleWayback}
              className={`relative inline-flex h-9 w-9 items-center justify-center gap-2 rounded-full border p-2 text-sm font-medium text-slate-100 shadow backdrop-blur-sm transition ${
                isWaybackActive
                  ? 'border-slate-400/30 bg-slate-900/80 hover:border-slate-300/40 hover:bg-slate-800/80'
                  : 'border-white/12 bg-slate-950/80 hover:border-white/20 hover:bg-slate-900'
              }`}
              aria-label="Open wayback machine"
              aria-expanded={isWaybackMenuOpen ? 'true' : 'false'}
            >
              <Clock3 className="h-4 w-4 shrink-0" />
              <span
                aria-hidden="true"
                className={`absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full ${
                  isWaybackActive
                    ? 'bg-slate-300 shadow-[0_0_6px_rgba(226,232,240,0.45)]'
                    : 'bg-rose-500 shadow-[0_0_6px_rgba(244,63,94,0.7)]'
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

// ---------------------------------------------------------------------------
// Dashboard (inner component, wrapped by TrackerLayoutProvider)
// ---------------------------------------------------------------------------

interface ChantalV2DashboardProps {
  map: WorldMapPayload;
  initialConfig: FriendsTrackerConfig;
  airportMarkers: FlightMapAirportMarker[];
  initialSnapshot: ChantalPositionSnapshot | null;
  initialSnapshotTimestamps: number[];
  mapView: TrackerMapView;
  onMapViewChange: (nextView: TrackerMapView) => void;
  mapReady: boolean;
  loadingTargetView: TrackerMapView;
  onMapReady: () => void;
}

function ChantalV2Dashboard({
  map,
  initialConfig,
  airportMarkers,
  initialSnapshot,
  initialSnapshotTimestamps,
  mapView,
  onMapViewChange,
  mapReady,
  loadingTargetView,
  onMapReady,
}: ChantalV2DashboardProps) {
  const locale = useLocale();
  const config = useMemo(() => normalizeFriendsTrackerConfig(initialConfig), [initialConfig]);

  // Snapshot state.
  const [latestSnapshot, setLatestSnapshot] = useState<ChantalPositionSnapshot | null>(initialSnapshot);
  const [snapshotTimestamps, setSnapshotTimestamps] = useState<number[]>(initialSnapshotTimestamps);
  const [displayedSnapshot, setDisplayedSnapshot] = useState<ChantalPositionSnapshot | null>(initialSnapshot);
  const [selectedTimeMs, setSelectedTimeMs] = useState<number | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isCronRunning, setIsCronRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isWaybackModalOpen, setIsWaybackModalOpen] = useState(false);

  const { isMobile } = useTrackerLayout();
  const currentTrip = getCurrentTripConfig(config);

  // Derived time bounds for wayback slider.
  const waybackBounds = useMemo(() => {
    if (snapshotTimestamps.length === 0) {
      const now = Date.now();
      return { startMs: now, endMs: now };
    }

    const sorted = [...snapshotTimestamps].sort((a, b) => a - b);
    return { startMs: sorted[0]!, endMs: sorted[sorted.length - 1]! };
  }, [snapshotTimestamps]);

  const liveTimeMs = latestSnapshot?.capturedAt ?? Date.now();
  const referenceTimeMs = selectedTimeMs == null
    ? liveTimeMs
    : Math.min(Math.max(selectedTimeMs, waybackBounds.startMs), waybackBounds.endMs);
  const isWaybackActive = referenceTimeMs < liveTimeMs - WAYBACK_RETURN_TO_LIVE_THRESHOLD_MS;

  const hasWaybackRange = waybackBounds.endMs - waybackBounds.startMs >= WAYBACK_STEP_MS;
  const sliderValue = isWaybackActive ? referenceTimeMs : waybackBounds.endMs;

  // Fetch latest snapshots.
  const fetchLatest = useCallback(async () => {
    setIsRefreshing(true);
    setError(null);

    try {
      const response = await fetch('/api/chantal/v2/snapshots', { cache: 'no-store' });
      const payload = await response.json() as ChantalV2SnapshotsResponse & { error?: string };

      if (!response.ok) {
        throw new Error(payload.error || 'Unable to fetch the latest snapshots.');
      }

      if (payload.latest) {
        setLatestSnapshot(payload.latest);
      }

      if (payload.snapshotTimestamps?.length) {
        setSnapshotTimestamps(payload.snapshotTimestamps);
      }

      // If not in wayback mode, update displayed snapshot to latest.
      if (selectedTimeMs == null && payload.latest) {
        setDisplayedSnapshot(payload.latest);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to refresh snapshots.');
    } finally {
      setIsRefreshing(false);
    }
  }, [selectedTimeMs]);

  // Fetch historical snapshot at a specific time.
  const fetchSnapshotAt = useCallback(async (timestampMs: number) => {
    try {
      const params = new URLSearchParams({ at: String(timestampMs) });
      const response = await fetch(`/api/chantal/v2/snapshots?${params.toString()}`, { cache: 'no-store' });
      const payload = await response.json() as { snapshot: ChantalPositionSnapshot | null; error?: string };

      if (!response.ok) {
        throw new Error(payload.error || 'Unable to fetch historical snapshot.');
      }

      if (payload.snapshot) {
        setDisplayedSnapshot(payload.snapshot);
      }
    } catch {
      // Silently fall back to showing the latest.
    }
  }, []);

  // When wayback time changes, fetch the right snapshot.
  useEffect(() => {
    if (selectedTimeMs == null) {
      setDisplayedSnapshot(latestSnapshot);
      return;
    }

    void fetchSnapshotAt(selectedTimeMs);
  }, [fetchSnapshotAt, latestSnapshot, selectedTimeMs]);

  // Auto-refresh.
  useEffect(() => {
    const interval = window.setInterval(() => {
      void fetchLatest();
    }, AUTO_REFRESH_MS);

    return () => window.clearInterval(interval);
  }, [fetchLatest]);

  // Trigger the V2 cron to capture a new snapshot.
  const triggerCron = useCallback(async () => {
    if (isCronRunning) {
      return;
    }

    setIsCronRunning(true);
    setError(null);

    try {
      const response = await fetch('/api/chantal/v2/cron', { method: 'POST', cache: 'no-store' });
      const payload = await response.json() as ChantalV2CronResult & { error?: string };

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Snapshot capture failed.');
      }

      // Fetch the freshly-saved snapshot.
      await fetchLatest();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to capture a new snapshot.');
    } finally {
      setIsCronRunning(false);
    }
  }, [fetchLatest, isCronRunning]);

  // Cleanup wayback if out of range.
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
  }, [selectedTimeMs, waybackBounds]);

  // Build map data from the displayed snapshot.
  const airportMarkerByCode = useMemo(() => (
    new Map(airportMarkers.map((m) => [m.code.toUpperCase().trim(), m] as const))
  ), [airportMarkers]);

  const positions = useMemo<ChantalFriendPosition[]>(
    () => displayedSnapshot?.positions ?? [],
    [displayedSnapshot],
  );

  const positionByFriendId = useMemo<Map<string, ChantalFriendPosition>>(
    () => new Map(positions.map((p) => [p.friendId, p])),
    [positions],
  );

  // Synthetic tracked flights for airborne friends.
  const syntheticFlights = useMemo<TrackedFlight[]>(() => {
    if (!displayedSnapshot) {
      return [];
    }

    return positions.flatMap((position) => {
      if (position.status !== 'airborne') {
        return [];
      }

      const flight = buildSyntheticFlight(position, airportMarkerByCode, displayedSnapshot.capturedAt);
      return flight ? [flight] : [];
    });
  }, [airportMarkerByCode, displayedSnapshot, positions]);

  // Static markers for on-ground / scheduled / awaiting friends.
  const staticFriendMarkers = useMemo<FriendAvatarMarker[]>(() => {
    if (!displayedSnapshot) {
      return [];
    }

    return positions.flatMap((position, index) => {
      if (position.status === 'airborne') {
        return [];
      }

      // Determine which airport to show them at.
      const code = position.status === 'on-ground'
        ? (position.toAirport ?? position.fromAirport ?? null)
        : (position.fromAirport ?? position.toAirport ?? null);

      if (!code) {
        return [];
      }

      const marker = airportMarkerByCode.get(code.toUpperCase());
      if (!marker) {
        return [];
      }

      return [{
        id: position.friendId,
        name: position.friendName,
        avatarUrl: position.avatarUrl,
        color: getFlightMapColor(index, false),
        latitude: marker.latitude,
        longitude: marker.longitude,
        isStale: false,
      } satisfies FriendAvatarMarker];
    });
  }, [airportMarkerByCode, displayedSnapshot, positions]);

  // Avatar info for each synthetic flight.
  const flightAvatars = useMemo<Record<string, FriendAvatarInfo[]>>(() => {
    const result: Record<string, FriendAvatarInfo[]> = {};

    syntheticFlights.forEach((flight, index) => {
      const position = positions.find((p) => flight.icao24 === `snapshot-${p.friendId}`);
      if (!position) {
        return;
      }

      result[flight.icao24] = [{
        friendId: position.friendId,
        name: position.friendName,
        avatarUrl: position.avatarUrl,
        color: getFlightMapColor(index, false),
        isStale: false,
      }];
    });

    return result;
  }, [positions, syntheticFlights]);

  // Accent colors per friend.
  const friendAccentColors = useMemo<Map<string, string>>(() => {
    const result = new Map<string, string>();

    positions.forEach((position, index) => {
      result.set(position.friendId, getFlightMapColor(index, false));
    });

    config.friends.forEach((friend, index) => {
      if (!result.has(friend.id)) {
        result.set(friend.id, getFlightMapColor(index, false));
      }
    });

    return result;
  }, [config.friends, positions]);

  const destinationAirport = currentTrip?.destinationAirport ?? null;
  const totalFriends = config.friends.length;
  const trackedCount = syntheticFlights.length + staticFriendMarkers.length;

  // Wayback slider card.
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
              ? 'border-slate-400/30 bg-slate-900/70 text-slate-100 hover:border-slate-300/40 hover:bg-slate-800/80'
              : 'border-rose-400/35 bg-rose-500/10 text-rose-100'
          }`}
        >
          <span className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className={`h-2 w-2 rounded-full ${
                isWaybackActive
                  ? 'bg-slate-300 shadow-[0_0_6px_rgba(226,232,240,0.45)]'
                  : 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.8)]'
              }`}
            />
            <span>Live</span>
          </span>
        </button>
      </div>

      <label htmlFor="chantalv2-wayback-slider" className="sr-only">Wayback machine</label>
      <input
        id="chantalv2-wayback-slider"
        aria-label="Wayback machine"
        type="range"
        min={waybackBounds.startMs}
        max={waybackBounds.endMs}
        step="any"
        value={sliderValue}
        onChange={(event) => {
          const nextValue = Number(event.currentTarget.value);
          if (!Number.isFinite(nextValue)) {
            return;
          }

          if (nextValue >= waybackBounds.endMs - WAYBACK_RETURN_TO_LIVE_THRESHOLD_MS) {
            setSelectedTimeMs(null);
            return;
          }

          const snapped = snapWaybackSliderValue(nextValue, waybackBounds.startMs, waybackBounds.endMs);
          setSelectedTimeMs(snapped);
        }}
        className="mt-3 w-full accent-cyan-400"
      />

      <div className="mt-2 flex items-center justify-between gap-3 text-[10px] text-slate-500">
        <span>{formatDateTimeMillis(waybackBounds.startMs, locale)}</span>
        <span>Live</span>
      </div>

      <p className="mt-2 text-[11px] text-slate-400">
        Snapshots captured every ~5 min. Position and route shown as of that moment.
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
            Error
          </div>
          <p className="text-xs">{error}</p>
        </div>
      ) : null}

      {!displayedSnapshot ? (
        <div className="rounded-2xl border border-dashed border-white/10 bg-slate-950/35 p-4 text-sm text-slate-400">
          No position snapshots yet. Hit the ⚡ Snapshot button to capture the first one.
        </div>
      ) : null}

      {config.friends.map((friend, index) => {
        const position = positionByFriendId.get(friend.id) ?? null;

        return (
          <FriendV2Card
            key={friend.id}
            friend={friend}
            position={position}
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
        <ChantalV2TopBar
          tripName={currentTrip?.name ?? null}
          friendCount={totalFriends}
          trackedCount={trackedCount}
          snapshotTime={displayedSnapshot?.capturedAt ?? null}
          isRefreshing={isRefreshing}
          onRefresh={fetchLatest}
          onTriggerCron={triggerCron}
          isCronRunning={isCronRunning}
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
            flights={syntheticFlights}
            mapView={mapView}
            selectedIcao24={null}
            selectionMode="all"
            flightAvatars={flightAvatars}
            staticFriendMarkers={staticFriendMarkers}
            airportMarkers={airportMarkers}
            emptyOverlayMessage={displayedSnapshot ? null : 'No snapshot yet – hit ⚡ Snapshot to begin'}
            onInitialZoomEnd={onMapReady}
          />
        </div>
      }
      sidebarContent={sidebarContent}
      sidebarFooter={!isMobile ? waybackCard : null}
      isLoading={!mapReady}
      loadingContent={
        loadingTargetView === 'globe'
          ? <Globe className="animate-spin text-sky-400" size={64} strokeWidth={2.5} />
          : <MapIcon className="animate-spin text-sky-400" size={64} strokeWidth={2.5} />
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Public export (handles map-view transitions, same pattern as V1)
// ---------------------------------------------------------------------------

interface ChantalV2ClientProps {
  map: WorldMapPayload;
  initialConfig: FriendsTrackerConfig;
  airportMarkers: FlightMapAirportMarker[];
  initialSnapshot: ChantalPositionSnapshot | null;
  initialSnapshotTimestamps: number[];
}

export default function ChantalV2Client({
  map,
  initialConfig,
  airportMarkers,
  initialSnapshot,
  initialSnapshotTimestamps,
}: ChantalV2ClientProps) {
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
        <ChantalV2Dashboard
          map={map}
          initialConfig={initialConfig}
          airportMarkers={airportMarkers}
          initialSnapshot={initialSnapshot}
          initialSnapshotTimestamps={initialSnapshotTimestamps}
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
