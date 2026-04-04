'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  CircleAlert,
  Clock3,
  Gauge,
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
import FlightMap2D from './FlightMap2D';
import { getFlightMapColor } from './colors';
import type { AirportDetails, SelectedFlightDetails as SelectedFlightDetailsPayload, TrackerApiResponse, TrackedFlight } from './types';

const AUTO_REFRESH_MS = 60_000;
const STORAGE_KEY = 'tracker:last-query';
const URL_QUERY_KEY = 'q';

interface FlightTrackerClientProps {
  map: WorldMapPayload;
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

function formatAltitude(value: number | null): string {
  return value == null ? '—' : `${Math.round(value).toLocaleString()} m`;
}

function formatSpeed(value: number | null): string {
  return value == null ? '—' : `${Math.round(value * 3.6).toLocaleString()} km/h`;
}

function buildAltitudeTrendSamples(flight: TrackedFlight): Array<{ altitude: number; time: number | null }> {
  const samples = flight.track
    .map((point) => ({
      altitude: point.altitude,
      time: point.time,
    }))
    .filter((point): point is { altitude: number; time: number | null } => point.altitude != null && Number.isFinite(point.altitude));

  const currentAltitude = flight.current?.altitude ?? flight.geoAltitude ?? flight.baroAltitude;
  const currentTime = flight.current?.time ?? flight.lastContact ?? null;

  if (currentAltitude != null && Number.isFinite(currentAltitude)) {
    const lastSample = samples.at(-1);
    if (!lastSample || lastSample.altitude !== currentAltitude || lastSample.time !== currentTime) {
      samples.push({
        altitude: currentAltitude,
        time: currentTime,
      });
    }
  }

  return samples.slice(-24);
}

function AltitudeTrendChart({ flight }: { flight: TrackedFlight }) {
  const samples = useMemo(() => buildAltitudeTrendSamples(flight), [flight]);

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
  const altitudes = samples.map((sample) => sample.altitude);
  const minAltitude = Math.min(...altitudes);
  const maxAltitude = Math.max(...altitudes);
  const altitudeRange = Math.max(maxAltitude - minAltitude, 1);
  const plottedPoints = samples.map((sample, index) => {
    const x = padding + (index / (samples.length - 1)) * (width - (padding * 2));
    const y = height - padding - (((sample.altitude - minAltitude) / altitudeRange) * (height - (padding * 2)));

    return {
      ...sample,
      x,
      y,
    };
  });
  const linePoints = plottedPoints.map((point) => `${point.x},${point.y}`).join(' ');
  const lastPoint = plottedPoints.at(-1) ?? plottedPoints[plottedPoints.length - 1];
  const chartLabel = flight.callsign || flight.icao24.toUpperCase();

  return (
    <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/45 p-3">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-cyan-200/80">Altitude trend</div>
          <div className="text-[11px] text-slate-400">Recent track history</div>
        </div>
        <div className="text-right">
          <div className="text-sm font-semibold text-white">{formatAltitude(lastPoint?.altitude ?? null)}</div>
          <div className="text-[11px] text-slate-400">current</div>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Altitude history for ${chartLabel}`}
        className="h-20 w-full"
        preserveAspectRatio="none"
      >
        <polyline
          points={linePoints}
          fill="none"
          stroke="rgb(34 211 238)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {lastPoint ? <circle cx={lastPoint.x} cy={lastPoint.y} r="3" fill="rgb(255 255 255)" /> : null}
      </svg>

      <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
        <span>{samples[0]?.time ? formatTimestamp(samples[0].time * 1000) : 'Start'}</span>
        <span>{samples.at(-1)?.time ? formatTimestamp((samples.at(-1)?.time ?? 0) * 1000) : 'Now'}</span>
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
    flight.route.departureAirport ?? '',
    flight.route.arrivalAirport ?? '',
    String(flight.route.lastSeen ?? flight.lastContact ?? 0),
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
}: {
  flight: TrackedFlight;
  details: SelectedFlightDetailsPayload | null;
  isLoadingDetails: boolean;
  detailsError: string | null;
}) {
  const observedArrivalTime = details?.route?.lastSeen ?? flight.route.lastSeen;
  const observedStatusLabel = flight.onGround ? 'Arrival observed' : 'Last observed';
  const observedStatusTime = flight.onGround ? observedArrivalTime : flight.lastContact;
  const airlineName = details?.airline?.name ?? flight.airline?.name ?? '—';
  const aircraftModel = details?.aircraft?.model ?? flight.aircraft?.model ?? '—';
  const aircraftRegistration = details?.aircraft?.registration ?? flight.aircraft?.registration ?? null;
  const dataSourceLabel = (() => {
    const dataSource = details?.dataSource ?? flight.dataSource ?? 'opensky';
    if (dataSource === 'hybrid') {
      return 'OpenSky + Aviationstack';
    }

    return dataSource === 'aviationstack' ? 'Aviationstack' : 'OpenSky';
  })();

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

      <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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

          <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div>
              <dt className="text-slate-400">Departure observed</dt>
              <dd>{formatDateTimeSeconds(details.route?.firstSeen ?? flight.route.firstSeen)}</dd>
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

function TrackerTopBar({
  trackedCount,
  isRefreshing,
  onRefresh,
  lastUpdated,
}: {
  trackedCount: number;
  isRefreshing: boolean;
  onRefresh: () => void;
  lastUpdated: number | null;
}) {
  const { topBarRef } = useTrackerLayout();

  return (
    <div ref={topBarRef} className="pointer-events-none absolute inset-x-0 top-0 z-40 flex flex-wrap items-start justify-between gap-3 p-3 md:p-4">
      <div className="pointer-events-auto rounded-2xl border border-white/10 bg-slate-950/75 px-4 py-3 backdrop-blur-md">
        <div className="flex items-center gap-2 text-cyan-200">
          <Radar className="h-4 w-4" />
          <span className="text-xs font-semibold uppercase tracking-[0.24em]">Live flight tracker</span>
        </div>
        <div className="mt-1 flex items-center gap-2 text-sm text-slate-200">
          <span>{trackedCount} tracked</span>
          <span className="text-slate-500">•</span>
          <span>updated {formatTimestamp(lastUpdated)}</span>
        </div>
      </div>

      <div className="pointer-events-auto flex items-center gap-2">
        <TrackerZoomControls />
        <button
          type="button"
          onClick={onRefresh}
          className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-slate-950/80 px-3 py-2 text-sm font-medium text-slate-100 shadow backdrop-blur-sm transition hover:border-white/20 hover:bg-slate-900"
        >
          <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>
    </div>
  );
}

function FlightTrackerDashboard({ map }: FlightTrackerClientProps) {
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [data, setData] = useState<TrackerApiResponse | null>(null);
  const [selectedIcao24, setSelectedIcao24] = useState<string | null>(null);
  const [selectedFlightDetails, setSelectedFlightDetails] = useState<SelectedFlightDetailsPayload | null>(null);
  const [selectedFlightDetailsError, setSelectedFlightDetailsError] = useState<string | null>(null);
  const [isLoadingSelectedFlightDetails, setIsLoadingSelectedFlightDetails] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [staleMatchNotice, setStaleMatchNotice] = useState<string | null>(null);
  const dataRef = useRef<TrackerApiResponse | null>(null);
  const selectedFlightDetailsCacheRef = useRef<Map<string, SelectedFlightDetailsPayload>>(new Map());

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
    setError(null);
    setStaleMatchNotice(null);

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

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    if (!selectedFlight || !selectedFlightDetailsCacheKey) {
      setSelectedFlightDetails(null);
      setSelectedFlightDetailsError(null);
      setIsLoadingSelectedFlightDetails(false);
      return;
    }

    const cachedDetails = selectedFlightDetailsCacheRef.current.get(selectedFlightDetailsCacheKey);
    if (cachedDetails) {
      setSelectedFlightDetails(cachedDetails);
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

    const lastSeen = selectedFlight.route.lastSeen ?? selectedFlight.lastContact;
    if (lastSeen) {
      searchParams.set('lastSeen', String(lastSeen));
    }

    let isCancelled = false;
    setSelectedFlightDetails(null);
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

        selectedFlightDetailsCacheRef.current.set(selectedFlightDetailsCacheKey, payload);
        setSelectedFlightDetails(payload);
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
        }
      }
    })();

    return () => {
      isCancelled = true;
    };
  }, [selectedFlight, selectedFlightDetailsCacheKey]);

  const runSearch = useCallback(async (rawQuery: string, background = false) => {
    const trimmedQuery = rawQuery.trim();

    if (!trimmedQuery) {
      resetTracking();
      return;
    }

    setError(null);
    if (!background) {
      setStaleMatchNotice(null);
    }
    syncTrackedFlightsUrl(trimmedQuery);
    if (background) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }

    try {
      const response = await fetch(`/api/tracker?q=${encodeURIComponent(trimmedQuery)}`, {
        cache: 'no-store',
      });
      const payload = await response.json() as TrackerApiResponse & { error?: string };

      if (!response.ok) {
        throw new Error(payload.error || 'Unable to fetch live flight data.');
      }

      const currentData = dataRef.current;
      const shouldKeepLastKnownFlights = background
        && payload.flights.length === 0
        && trimmedQuery === currentData?.query
        && (currentData?.flights.length ?? 0) > 0;

      const nextData = shouldKeepLastKnownFlights && currentData
        ? {
            ...currentData,
            query: payload.query,
            requestedIdentifiers: payload.requestedIdentifiers,
            notFoundIdentifiers: payload.notFoundIdentifiers,
            fetchedAt: payload.fetchedAt,
          }
        : payload;

      setQuery(trimmedQuery);
      setSubmittedQuery(trimmedQuery);
      setData(nextData);
      dataRef.current = nextData;
      setStaleMatchNotice(
        shouldKeepLastKnownFlights
          ? `No fresh live position for ${payload.notFoundIdentifiers.join(', ')}. Showing the last known route.`
          : null,
      );
      setSelectedIcao24((current) => {
        if (current && nextData.flights.some((flight) => flight.icao24 === current)) {
          return current;
        }

        return nextData.flights[0]?.icao24 ?? null;
      });
      window.localStorage.setItem(STORAGE_KEY, trimmedQuery);
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
    void runSearch(initialQuery, true);
  }, [runSearch]);

  useEffect(() => {
    if (!submittedQuery) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void runSearch(submittedQuery, true);
    }, AUTO_REFRESH_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [runSearch, submittedQuery]);

  const clearTrackedFlights = useCallback(() => {
    setQuery('');
    void runSearch('', false);
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
            void runSearch(query, false);
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

              <div className="mt-3 grid grid-cols-1 gap-2 text-sm text-slate-300 sm:grid-cols-2">
                <div className="flex items-center gap-2">
                  <Gauge className="h-4 w-4 text-slate-500" />
                  <span>{formatSpeed(flight.velocity)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Clock3 className="h-4 w-4 text-slate-500" />
                  <span>{formatRelativeSeconds(flight.lastContact)}</span>
                </div>
                <div className="flex items-center gap-2 sm:col-span-2">
                  <Route className="h-4 w-4 text-slate-500" />
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
    <TrackerShell
      topBar={
        <TrackerTopBar
          trackedCount={data?.flights.length ?? 0}
          isRefreshing={isRefreshing}
          onRefresh={() => {
            void runSearch(submittedQuery || query, true);
          }}
          lastUpdated={data?.fetchedAt ?? null}
        />
      }
      showBackgroundGrid
      mapContent={
        <div className="relative h-[100dvh] w-full">
          <FlightMap2D
            map={map}
            flights={data?.flights ?? []}
            selectedIcao24={selectedFlight?.icao24 ?? null}
            selectedFlightDetails={selectedFlightDetails}
            onSelectFlight={setSelectedIcao24}
          />
        </div>
      }
      sidebarContent={sidebarContent}
    />
  );
}

export default function FlightTrackerClient({ map }: FlightTrackerClientProps) {
  return (
    <TrackerLayoutProvider>
      <FlightMapProvider>
        <FlightTrackerDashboard map={map} />
      </FlightMapProvider>
    </TrackerLayoutProvider>
  );
}
