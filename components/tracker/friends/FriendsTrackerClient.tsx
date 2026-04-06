'use client';

import { useLocale } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarClock,
  CircleAlert,
  Clock3,
  Gauge,
  Globe,
  Map as MapIcon,
  Plane,
  RefreshCw,
  Route,
  Settings2,
  Users,
} from 'lucide-react';
import { Link } from '~/i18n/navigation';
import {
  applyAutoLockedFriendFlights,
  buildFriendFlightStatuses,
  extractFriendTrackerIdentifiers,
  normalizeFriendsTrackerConfig,
  type FriendFlightStatus,
  type FriendsTrackerConfig,
} from '~/lib/friendsTracker';
import type { WorldMapPayload } from '~/lib/server/worldMap';
import TrackerShell from '../TrackerShell';
import TrackerZoomControls from '../TrackerZoomControls';
import { TrackerLayoutProvider, useTrackerLayout } from '../contexts/TrackerLayoutContext';
import { getFlightMapColor } from '../flight/colors';
import FlightMap from '../flight/FlightMap';
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

function formatScheduledDateTime(value: string, locale: string): string {
  if (!value) {
    return 'Time not set';
  }

  const parsedTime = Date.parse(value);
  if (Number.isNaN(parsedTime)) {
    return value;
  }

  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(parsedTime);
}

function formatSpeed(value: number | null): string {
  return value == null ? '—' : `${Math.round(value * 3.6).toLocaleString()} km/h`;
}

function getStatusClasses(status: FriendFlightStatus['status']) {
  switch (status) {
    case 'matched':
      return 'bg-emerald-500/20 text-emerald-100';
    case 'scheduled':
      return 'bg-sky-500/20 text-sky-100';
    default:
      return 'bg-amber-500/20 text-amber-100';
  }
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
  const locale = useLocale();
  const { isMobile, sidebarOpen } = useTrackerLayout();
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
  const totalLegs = statuses.length;

  const sidebarContent = (
    <div className="space-y-4">
      <section className="rounded-2xl border border-white/10 bg-slate-950/55 p-4 backdrop-blur-sm">
        <div className="mb-3 flex items-center gap-2 text-cyan-200">
          <Users className="h-4 w-4" />
          <h2 className="text-sm font-semibold uppercase tracking-[0.24em]">Crew overview</h2>
        </div>
        <p className="mb-4 text-sm text-slate-300">
          Every configured flight stays visible here together. Connections and completed legs remain on the shared map via the background prefetch cache.
        </p>
        <div className="grid grid-cols-2 gap-3 text-sm text-slate-200">
          <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-3">
            <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Friends</div>
            <div className="mt-1 text-lg font-semibold text-white">{totalFriends}</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-3">
            <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Flight legs</div>
            <div className="mt-1 text-lg font-semibold text-white">{totalLegs}</div>
          </div>
        </div>
        {airportMarkers.length ? (
          <p className="mt-4 text-xs text-slate-400">
            {airportMarkers.length} shared airport marker{airportMarkers.length === 1 ? '' : 's'} remain visible on the crew map.
          </p>
        ) : null}
      </section>

      {error ? (
        <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 p-4 text-sm text-rose-100">
          <div className="mb-1 flex items-center gap-2 font-semibold">
            <CircleAlert className="h-4 w-4" />
            Unable to refresh the crew map
          </div>
          <p>{error}</p>
        </div>
      ) : null}

      {data?.notFoundIdentifiers.length ? (
        <div className="rounded-2xl border border-cyan-400/30 bg-cyan-500/10 p-4 text-sm text-cyan-50">
          <div className="mb-2 flex items-center gap-2 font-semibold">
            <Clock3 className="h-4 w-4" />
            Waiting on live telemetry
          </div>
          <p>{data.notFoundIdentifiers.join(', ')}</p>
          <p className="mt-2 text-cyan-100/80">
            Completed or low-coverage legs remain on the map from the shared cache as fresh telemetry drops away.
          </p>
        </div>
      ) : null}

      <section className="space-y-3">
        <div className="flex items-center gap-2 text-xs uppercase tracking-[0.22em] text-slate-400">
          <Plane className="h-4 w-4" />
          Friend itineraries
        </div>

        {!identifiers.length ? (
          <div className="rounded-2xl border border-dashed border-white/10 bg-slate-950/35 p-4 text-sm text-slate-400">
            No friend itineraries are configured yet. Add the crew details on the config page first.
          </div>
        ) : null}

        {config.friends.map((friend) => {
          const friendStatuses = statuses.filter((status) => status.friend.id === friend.id);

          return (
            <article key={friend.id} className="rounded-2xl border border-white/10 bg-slate-950/55 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-base font-semibold text-white">{friend.name}</div>
                  <div className="text-xs text-slate-400">{friendStatuses.length} configured leg{friendStatuses.length === 1 ? '' : 's'}</div>
                </div>
                <span className="rounded-full bg-slate-900/80 px-2.5 py-1 text-[11px] font-semibold text-slate-200">
                  {friendStatuses.filter((status) => status.flight).length}/{friendStatuses.length} on map
                </span>
              </div>

              <div className="mt-3 space-y-2">
                {friendStatuses.map((status, index) => {
                  const flightColor = status.flight ? getFlightMapColor(index, false) : 'rgba(148,163,184,0.7)';
                  return (
                    <div key={status.leg.id} className="rounded-2xl border border-white/10 bg-slate-950/70 p-3 text-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span
                              role="img"
                              aria-label={`Map color for ${status.label}`}
                              className="inline-block h-2.5 w-2.5 rounded-full border border-white/60 shadow-sm"
                              style={{ backgroundColor: flightColor }}
                            />
                            <span className="font-semibold text-white">{status.leg.flightNumber || 'Flight TBD'}</span>
                            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${getStatusClasses(status.status)}`}>
                              {status.status === 'matched' ? 'on map' : status.status}
                            </span>
                          </div>
                          <div className="mt-1 flex items-center gap-2 text-xs text-slate-400">
                            <CalendarClock className="h-3.5 w-3.5" />
                            <span>{formatScheduledDateTime(status.leg.departureTime, locale)} UTC</span>
                          </div>
                          {status.leg.from || status.leg.to ? (
                            <div className="mt-1 text-xs text-slate-400">
                              {(status.leg.from ?? '—')} → {(status.leg.to ?? '—')}
                            </div>
                          ) : null}
                          {status.leg.note ? (
                            <div className="mt-1 text-xs text-slate-300">{status.leg.note}</div>
                          ) : null}
                        </div>

                        {status.leg.resolvedIcao24 ? (
                          <span className="rounded-full border border-cyan-400/30 bg-cyan-500/10 px-2 py-0.5 text-[11px] font-semibold text-cyan-100">
                            {status.leg.resolvedIcao24}
                          </span>
                        ) : null}
                      </div>

                      {status.flight ? (
                        <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-300 [&>div]:min-w-0 [&_span]:break-words">
                          <div className="flex items-center gap-2">
                            <Clock3 className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                            <span>{formatRelativeSeconds(status.flight.lastContact)}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Gauge className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                            <span>{formatSpeed(status.flight.velocity)}</span>
                          </div>
                          <div className="col-span-2 flex items-center gap-2">
                            <Route className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                            <span>
                              {status.flight.route.departureAirport ?? status.leg.from ?? '—'} → {status.flight.route.arrivalAirport ?? status.leg.to ?? '—'}
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div className="mt-3 text-xs text-slate-400">
                          Waiting for this leg to resolve into a live aircraft. The map will pick it up automatically once telemetry appears.
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </article>
          );
        })}
      </section>
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
