'use client';

import { useLocale } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CircleAlert,
  Clock3,
  Globe,
  Map as MapIcon,
  Plane,
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

  // Find the first active (matched) leg in the current trip.
  for (let i = 0; i < currentTripLegs.length; i++) {
    const leg = currentTripLegs[i]!;
    const status = friendStatuses.find((s) => s.leg.id === leg.id);

    if (status?.status !== 'matched' || !status.flight) {
      continue;
    }

    const flight = status.flight;
    // Estimate progress within the leg using firstSeen → lastContact timestamps.
    const firstSeenMs = flight.route.firstSeen != null ? flight.route.firstSeen * 1000 : null;
    const lastSeenMs = flight.route.lastSeen != null ? flight.route.lastSeen * 1000 : null;

    let progress = 0.5; // default: mid-flight
    if (firstSeenMs != null && lastSeenMs != null && lastSeenMs > firstSeenMs) {
      progress = Math.min(Math.max((now - firstSeenMs) / (lastSeenMs - firstSeenMs), 0.1), 0.9);
    }

    // Cursor position: leg index i maps to airport segment [i, i+1].
    return i + progress;
  }

  // No active leg — derive position from departure times.
  // Find the last leg whose departure is in the past.
  let lastPastLegIndex = -1;
  for (let i = 0; i < currentTripLegs.length; i++) {
    const dep = Date.parse(currentTripLegs[i]!.departureTime);
    if (!Number.isNaN(dep) && dep <= now) {
      lastPastLegIndex = i;
    }
  }

  if (lastPastLegIndex >= 0) {
    // Cursor at the arrival airport of the last completed leg (= airport index lastPastLegIndex + 1).
    return lastPastLegIndex + 1;
  }

  return null;
}

function FriendTimelineCard({
  friend,
  friendStatuses,
  destinationAirport,
  now,
}: {
  friend: FriendTravelConfig;
  friendStatuses: FriendFlightStatus[];
  destinationAirport: string | null;
  now: number;
}) {
  const currentTripLegs = getCurrentTripLegs(friend, friendStatuses, destinationAirport, now);
  const airports = buildAirportChain(currentTripLegs);
  const cursorRaw = computeTimelineCursorPosition(currentTripLegs, friendStatuses, now);

  const numSegments = Math.max(airports.length - 1, 1);
  const cursorFraction = cursorRaw != null ? cursorRaw / numSegments : null;

  // Determine how many airports are "completed" (friend has already passed through them).
  // Airport at index j is completed if leg j-1 is done and not currently active.
  const activeLegIndex = currentTripLegs.findIndex((leg) => {
    const s = friendStatuses.find((st) => st.leg.id === leg.id);
    return s?.status === 'matched';
  });

  const completedAirportCount = activeLegIndex >= 0
    ? activeLegIndex // airports 0..activeLegIndex-1 are fully done; activeLegIndex is departure of current leg
    : (cursorRaw != null ? Math.floor(cursorRaw) : 0);

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

  const initials = getFriendInitials(friend.name);
  const hasAnyMatch = friendStatuses.some((s) => s.status === 'matched');

  return (
    <article className="rounded-2xl border border-white/10 bg-slate-950/55 p-3">
      {/* Header row: avatar + name + last seen */}
      <div className="flex items-center gap-3">
        {/* Avatar placeholder */}
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/15 bg-slate-800 text-[11px] font-bold uppercase tracking-wide text-slate-300"
          aria-label={`Avatar for ${friend.name}`}
        >
          {initials}
        </div>

        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-white">{friend.name}</div>
          <div className="text-[11px] text-slate-400">
            {currentTripLegs.length} leg{currentTripLegs.length === 1 ? '' : 's'}
            {destinationAirport ? (
              <span className="ml-1 text-slate-500">
                · {activeLegIndex >= 0 ? 'in flight' : (cursorRaw != null && cursorRaw >= airports.length - 1 && airports[airports.length - 1] === destinationAirport ? 'arrived' : 'outbound')}
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
            {/* Base track line */}
            <div className="absolute top-[7px] left-0 right-0 h-px bg-slate-700" />

            {/* Completed track (colored portion up to cursor) */}
            {cursorFraction != null && (
              <div
                className="absolute top-[7px] left-0 h-px bg-cyan-500/70 transition-all duration-500"
                style={{ width: `${Math.min(cursorFraction * 100, 100)}%` }}
              />
            )}

            {/* Airport nodes */}
            <div className="relative flex items-start justify-between">
              {airports.map((airport, i) => {
                const isDest = destinationAirport != null && airport === destinationAirport.toUpperCase().trim();
                const isCompleted = i < completedAirportCount;
                const isActive = i === completedAirportCount && activeLegIndex >= 0;
                return (
                  <div key={`${airport}-${i}`} className="flex flex-col items-center" style={{ minWidth: 0 }}>
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
                      className={`mt-1 max-w-[40px] truncate text-center text-[9px] leading-none ${
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
                );
              })}
            </div>

            {/* Cursor (plane icon) — floats above the track */}
            {cursorFraction != null && (
              <div
                className="pointer-events-none absolute top-0"
                style={{
                  left: `calc(${Math.min(cursorFraction * 100, 100)}% - 6px)`,
                  transition: 'left 0.5s ease',
                }}
              >
                <Plane
                  className="h-3 w-3 -rotate-45 text-cyan-300 drop-shadow-[0_0_4px_rgba(103,232,249,0.8)]"
                  aria-label={activeLegFlightNumber ? `Flight ${activeLegFlightNumber}` : 'Current position'}
                />
              </div>
            )}
          </div>

          {/* Flight number label under cursor */}
          {activeLegFlightNumber ? (
            <div
              className="mt-1 text-[10px] text-cyan-400"
              style={{
                marginLeft: `calc(${Math.min((cursorFraction ?? 0) * 100, 95)}% - 14px)`,
                transition: 'margin-left 0.5s ease',
              }}
            >
              {activeLegFlightNumber}
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
  friendCount,
  trackedCount,
  lastUpdated,
  isRefreshing,
  onRefresh,
  mapView,
  onMapViewChange,
}: {
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
    setConfig(nextState.config);

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

      {config.friends.map((friend) => {
        const friendStatuses = statuses.filter((status) => status.friend.id === friend.id);
        return (
          <FriendTimelineCard
            key={friend.id}
            friend={friend}
            friendStatuses={friendStatuses}
            destinationAirport={destinationAirport}
            now={now}
          />
        );
      })}
    </div>
  );

  return (
    <TrackerShell
      topBar={
        <FriendsTrackerTopBar
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
