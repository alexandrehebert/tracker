import { geoNaturalEarth1 } from 'd3-geo';
import type { AirportDetails, FlightMapPoint, SelectedFlightDetails, TrackerApiResponse, TrackedFlight, TrackedFlightRoute } from '~/components/tracker/flight/types';
import { guessNearestAirportDetails, lookupAirportDetails } from './airports';
import { getFlightSearchCacheTtlSeconds, readFlightDetailsCache, readFlightSearchCache, writeFlightDetailsCache, writeFlightSearchCache } from './flightCache';

const OPENSKY_TOKEN_URL = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';
const OPENSKY_API_BASE = 'https://opensky-network.org/api';
const TRACKER_MAP_VIEWBOX = { width: 1000, height: 560 };
const TOKEN_REFRESH_MARGIN_MS = 30_000;
const RECENT_FLIGHTS_LOOKBACK_SECONDS = 6 * 60 * 60;
const RECENT_FLIGHTS_CACHE_TTL_MS = 60_000;

type Credentials = {
  clientId: string;
  clientSecret: string;
};

type OpenSkyStatesResponse = {
  time?: number;
  states?: unknown[][];
};

type OpenSkyTrackResponse = {
  path?: unknown[][];
};

type OpenSkyRouteResponse = Array<{
  estDepartureAirport?: string | null;
  estArrivalAirport?: string | null;
  firstSeen?: number | null;
  lastSeen?: number | null;
}>;

type OpenSkyRecentFlight = {
  icao24?: string | null;
  callsign?: string | null;
  estDepartureAirport?: string | null;
  estArrivalAirport?: string | null;
  firstSeen?: number | null;
  lastSeen?: number | null;
};

type ParsedState = {
  icao24: string;
  callsign: string;
  originCountry: string;
  timePosition: number | null;
  lastContact: number | null;
  longitude: number | null;
  latitude: number | null;
  baroAltitude: number | null;
  onGround: boolean;
  velocity: number | null;
  trueTrack: number | null;
  verticalRate: number | null;
  geoAltitude: number | null;
  squawk: string | null;
  category: number | null;
};

let credentialsCache: Credentials | null = null;
let tokenCache: { accessToken: string; expiresAt: number } | null = null;
let recentFlightsCache: { flights: OpenSkyRecentFlight[]; expiresAt: number } | null = null;
const inFlightSearches = new Map<string, Promise<TrackerApiResponse>>();
const inFlightSelectionDetails = new Map<string, Promise<SelectedFlightDetails>>();
const searchResultsCache = new Map<string, { payload: TrackerApiResponse; expiresAt: number }>();

const projection = geoNaturalEarth1();
projection.fitSize([TRACKER_MAP_VIEWBOX.width, TRACKER_MAP_VIEWBOX.height], { type: 'Sphere' } as never);

function toNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeIdentifier(value: string): string {
  return value.replace(/\s+/g, '').trim().toUpperCase();
}

function parseIdentifierQuery(query: string): string[] {
  return Array.from(
    new Set(
      query
        .split(/[\n,]+/)
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
}

function buildSearchCacheKey(identifiers: string[]): string {
  return identifiers.map((identifier) => normalizeIdentifier(identifier)).filter(Boolean).join(',');
}

function buildFlightDetailsCacheKey(params: {
  icao24: string;
  departureAirport?: string | null;
  arrivalAirport?: string | null;
  lastSeen?: number | null;
}): string {
  const lastSeen = typeof params.lastSeen === 'number' && Number.isFinite(params.lastSeen)
    ? Math.floor(params.lastSeen)
    : 0;

  return [
    normalizeIdentifier(params.icao24),
    normalizeIdentifier(params.departureAirport ?? ''),
    normalizeIdentifier(params.arrivalAirport ?? ''),
    String(lastSeen),
  ].join(':');
}

function createEmptyRoute(): TrackedFlightRoute {
  return {
    departureAirport: null,
    arrivalAirport: null,
    firstSeen: null,
    lastSeen: null,
  };
}

function getAirportLookupCode(airport: AirportDetails | null): string | null {
  return airport?.icao ?? airport?.code ?? null;
}

async function guessDepartureAirportFromOriginPoint(originPoint: FlightMapPoint | null): Promise<AirportDetails | null> {
  if (!originPoint) {
    return null;
  }

  const isLikelyNearDeparture = originPoint.onGround || (originPoint.altitude ?? 0) <= 2_500;
  return guessNearestAirportDetails({
    latitude: originPoint.latitude,
    longitude: originPoint.longitude,
    maxDistanceKm: isLikelyNearDeparture ? 120 : 80,
  });
}

function readRecentSearchResult(cacheKey: string): TrackerApiResponse | null {
  const cachedEntry = searchResultsCache.get(cacheKey);
  if (!cachedEntry) {
    return null;
  }

  if (Date.now() >= cachedEntry.expiresAt) {
    searchResultsCache.delete(cacheKey);
    return null;
  }

  return cachedEntry.payload;
}

function writeRecentSearchResult(cacheKey: string, payload: TrackerApiResponse) {
  const ttlMs = getFlightSearchCacheTtlSeconds() * 1000;
  searchResultsCache.set(cacheKey, {
    payload,
    expiresAt: Date.now() + ttlMs,
  });
}

function projectPoint(params: {
  latitude: number | null;
  longitude: number | null;
  time: number | null;
  altitude: number | null;
  heading: number | null;
  onGround: boolean;
}): FlightMapPoint | null {
  const { latitude, longitude, time, altitude, heading, onGround } = params;

  if (latitude == null || longitude == null || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  const safeLatitude = latitude;
  const safeLongitude = longitude;
  const coordinates = projection([safeLongitude, safeLatitude]);
  if (!coordinates) {
    return null;
  }

  return {
    time,
    latitude: safeLatitude,
    longitude: safeLongitude,
    x: coordinates[0],
    y: coordinates[1],
    altitude,
    heading,
    onGround,
  };
}

function sortTrackPointsChronologically(points: FlightMapPoint[]): FlightMapPoint[] {
  return [...points].sort((first, second) => {
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
}

async function readCredentialsFromEnv(): Promise<Credentials> {
  if (credentialsCache) {
    return credentialsCache;
  }

  const clientId = process.env.OPENSKY_CLIENT_ID?.trim();
  const clientSecret = process.env.OPENSKY_CLIENT_SECRET?.trim();

  if (!clientId || !clientSecret) {
    throw new Error('Missing OpenSky client credentials. Set OPENSKY_CLIENT_ID and OPENSKY_CLIENT_SECRET in your environment.');
  }

  credentialsCache = {
    clientId,
    clientSecret,
  };

  return credentialsCache;
}

async function getAccessToken(forceRefresh = false): Promise<string> {
  if (!forceRefresh && tokenCache && Date.now() < tokenCache.expiresAt - TOKEN_REFRESH_MARGIN_MS) {
    return tokenCache.accessToken;
  }

  const credentials = await readCredentialsFromEnv();
  const response = await fetch(OPENSKY_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
    }),
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`OpenSky auth failed with status ${response.status}`);
  }

  const payload = await response.json() as { access_token?: string; expires_in?: number };
  if (!payload.access_token) {
    throw new Error('OpenSky auth response did not include an access token');
  }

  tokenCache = {
    accessToken: payload.access_token,
    expiresAt: Date.now() + (payload.expires_in ?? 1800) * 1000,
  };

  return tokenCache.accessToken;
}

async function fetchOpenSky<T>(pathname: string, searchParams?: Record<string, string | number | undefined>): Promise<T> {
  const makeUrl = () => {
    const url = new URL(`${OPENSKY_API_BASE}${pathname}`);
    for (const [key, value] of Object.entries(searchParams ?? {})) {
      if (value === undefined || value === '') continue;
      url.searchParams.set(key, String(value));
    }
    return url;
  };

  const execute = async (forceRefresh = false) => {
    const token = await getAccessToken(forceRefresh);
    return fetch(makeUrl(), {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: 'no-store',
    });
  };

  let response = await execute(false);

  if (response.status === 401) {
    response = await execute(true);
  }

  if (response.status === 404) {
    return null as T;
  }

  if (!response.ok) {
    throw new Error(`OpenSky request failed for ${pathname} with status ${response.status}`);
  }

  return response.json() as Promise<T>;
}

function parseStateVector(row: unknown[]): ParsedState | null {
  const icao24 = typeof row[0] === 'string' ? row[0].trim().toLowerCase() : '';
  if (!icao24) {
    return null;
  }

  return {
    icao24,
    callsign: typeof row[1] === 'string' ? row[1].trim() : '',
    originCountry: typeof row[2] === 'string' ? row[2] : 'Unknown',
    timePosition: toNumber(row[3]),
    lastContact: toNumber(row[4]),
    longitude: toNumber(row[5]),
    latitude: toNumber(row[6]),
    baroAltitude: toNumber(row[7]),
    onGround: Boolean(row[8]),
    velocity: toNumber(row[9]),
    trueTrack: toNumber(row[10]),
    verticalRate: toNumber(row[11]),
    geoAltitude: toNumber(row[13]),
    squawk: typeof row[14] === 'string' ? row[14] : null,
    category: toNumber(row[17]),
  };
}

function matchesFlightIdentifier(params: {
  callsign: string | null | undefined;
  icao24: string | null | undefined;
  identifier: string;
}): boolean {
  const normalized = normalizeIdentifier(params.identifier);
  if (!normalized) {
    return false;
  }

  const normalizedCallsign = normalizeIdentifier(params.callsign ?? '');
  const normalizedIcao24 = normalizeIdentifier(params.icao24 ?? '');

  return normalized === normalizedIcao24
    || normalized === normalizedCallsign
    || (normalized.length >= 4 && normalizedCallsign.includes(normalized));
}

function matchesIdentifier(state: ParsedState, identifier: string): boolean {
  return matchesFlightIdentifier({
    callsign: state.callsign,
    icao24: state.icao24,
    identifier,
  });
}

function matchesRecentFlightIdentifier(flight: OpenSkyRecentFlight, identifier: string): boolean {
  return matchesFlightIdentifier({
    callsign: flight.callsign,
    icao24: flight.icao24,
    identifier,
  });
}

async function getTrackForAircraft(icao24: string, referenceTime = 0): Promise<FlightMapPoint[]> {
  const safeReferenceTime = Number.isFinite(referenceTime) && referenceTime > 0 ? Math.floor(referenceTime) : 0;
  const response = await fetchOpenSky<OpenSkyTrackResponse | null>('/tracks/all', {
    icao24,
    time: safeReferenceTime,
  });

  const path = Array.isArray(response?.path) ? response.path : [];

  return sortTrackPointsChronologically(
    path
      .map((point) => {
        if (!Array.isArray(point)) return null;
        return projectPoint({
          time: toNumber(point[0]),
          latitude: toNumber(point[1]),
          longitude: toNumber(point[2]),
          altitude: toNumber(point[3]),
          heading: toNumber(point[4]),
          onGround: Boolean(point[5]),
        });
      })
      .filter((point): point is FlightMapPoint => Boolean(point)),
  );
}

async function getRecentRoute(icao24: string, referenceTime: number): Promise<TrackedFlightRoute> {
  const end = Math.max(referenceTime, Math.floor(Date.now() / 1000));
  const begin = end - (2 * 24 * 60 * 60);

  const response = await fetchOpenSky<OpenSkyRouteResponse | null>('/flights/aircraft', {
    icao24,
    begin,
    end,
  });

  const latest = Array.isArray(response) ? response.at(-1) : null;

  return {
    departureAirport: latest?.estDepartureAirport ?? null,
    arrivalAirport: latest?.estArrivalAirport ?? null,
    firstSeen: latest?.firstSeen ?? null,
    lastSeen: latest?.lastSeen ?? null,
  };
}

export async function getFlightSelectionDetails(params: {
  icao24: string;
  callsign?: string | null;
  departureAirport?: string | null;
  arrivalAirport?: string | null;
  lastSeen?: number | null;
}): Promise<SelectedFlightDetails> {
  const normalizedIcao24 = normalizeIdentifier(params.icao24).toLowerCase();
  if (!normalizedIcao24) {
    throw new Error('Missing aircraft identifier.');
  }

  const cacheKey = buildFlightDetailsCacheKey({
    icao24: normalizedIcao24,
    departureAirport: params.departureAirport,
    arrivalAirport: params.arrivalAirport,
    lastSeen: params.lastSeen,
  });

  const cachedResult = await readFlightDetailsCache(cacheKey);
  if (cachedResult) {
    return cachedResult;
  }

  const existingLookup = inFlightSelectionDetails.get(cacheKey);
  if (existingLookup) {
    return existingLookup;
  }

  const pendingLookup = (async () => {
    const fallbackRoute = createEmptyRoute();
    fallbackRoute.departureAirport = params.departureAirport ?? null;
    fallbackRoute.arrivalAirport = params.arrivalAirport ?? null;
    fallbackRoute.lastSeen = params.lastSeen ?? null;

    const referenceTime = typeof params.lastSeen === 'number' && Number.isFinite(params.lastSeen) && params.lastSeen > 0
      ? Math.floor(params.lastSeen)
      : Math.floor(Date.now() / 1000);

    const latestRoute = await getRecentRoute(normalizedIcao24, referenceTime).catch(() => fallbackRoute);
    const route: TrackedFlightRoute = {
      departureAirport: latestRoute.departureAirport ?? fallbackRoute.departureAirport,
      arrivalAirport: latestRoute.arrivalAirport ?? fallbackRoute.arrivalAirport,
      firstSeen: latestRoute.firstSeen ?? fallbackRoute.firstSeen,
      lastSeen: latestRoute.lastSeen ?? fallbackRoute.lastSeen,
    };

    let guessedDepartureAirport: AirportDetails | null = null;
    if (!route.departureAirport) {
      const originPoint = await getTrackForAircraft(normalizedIcao24, referenceTime)
        .then((track) => track[0] ?? null)
        .catch(() => null);

      guessedDepartureAirport = await guessDepartureAirportFromOriginPoint(originPoint);
      route.departureAirport = getAirportLookupCode(guessedDepartureAirport);
    }

    const [departureAirport, arrivalAirport] = await Promise.all([
      guessedDepartureAirport ? Promise.resolve(guessedDepartureAirport) : lookupAirportDetails(route.departureAirport),
      lookupAirportDetails(route.arrivalAirport),
    ]);

    const payload: SelectedFlightDetails = {
      icao24: normalizedIcao24,
      callsign: params.callsign?.trim() || normalizedIcao24.toUpperCase(),
      fetchedAt: Date.now(),
      route,
      departureAirport,
      arrivalAirport,
    };

    await writeFlightDetailsCache(cacheKey, payload);
    return payload;
  })().finally(() => {
    inFlightSelectionDetails.delete(cacheKey);
  });

  inFlightSelectionDetails.set(cacheKey, pendingLookup);
  return pendingLookup;
}

function readRecentFlightsSnapshot(): OpenSkyRecentFlight[] | null {
  if (!recentFlightsCache) {
    return null;
  }

  if (Date.now() >= recentFlightsCache.expiresAt) {
    recentFlightsCache = null;
    return null;
  }

  return recentFlightsCache.flights;
}

async function getRecentFlightsSnapshot(): Promise<OpenSkyRecentFlight[]> {
  const cachedFlights = readRecentFlightsSnapshot();
  if (cachedFlights) {
    return cachedFlights;
  }

  const end = Math.floor(Date.now() / 1000);
  const begin = end - RECENT_FLIGHTS_LOOKBACK_SECONDS;
  const response = await fetchOpenSky<OpenSkyRecentFlight[] | null>('/flights/all', {
    begin,
    end,
  });

  const flights = Array.isArray(response) ? response : [];
  recentFlightsCache = {
    flights,
    expiresAt: Date.now() + RECENT_FLIGHTS_CACHE_TTL_MS,
  };

  return flights;
}

async function fetchFreshFlights(query: string, requestedIdentifiers: string[]): Promise<TrackerApiResponse> {
  const fetchedAt = Date.now();
  const stateResponse = await fetchOpenSky<OpenSkyStatesResponse>('/states/all', { extended: 1 });
  const parsedStates = (stateResponse.states ?? [])
    .map((row) => (Array.isArray(row) ? parseStateVector(row) : null))
    .filter((state): state is ParsedState => Boolean(state));

  const matchesByAircraft = new Map<string, {
    state: ParsedState | null;
    recentFlight: OpenSkyRecentFlight | null;
    matchedBy: Set<string>;
  }>();

  for (const identifier of requestedIdentifiers) {
    for (const state of parsedStates) {
      if (!matchesIdentifier(state, identifier)) continue;

      const existing = matchesByAircraft.get(state.icao24);
      if (existing) {
        existing.state = state;
        existing.matchedBy.add(identifier);
      } else {
        matchesByAircraft.set(state.icao24, {
          state,
          recentFlight: null,
          matchedBy: new Set([identifier]),
        });
      }
    }
  }

  const matchedIdentifiers = new Set<string>();
  for (const { matchedBy } of matchesByAircraft.values()) {
    for (const identifier of matchedBy) {
      matchedIdentifiers.add(identifier);
    }
  }

  const unmatchedIdentifiers = requestedIdentifiers.filter((identifier) => !matchedIdentifiers.has(identifier));
  if (unmatchedIdentifiers.length > 0) {
    const recentFlights = await getRecentFlightsSnapshot().catch(() => []);

    for (const identifier of unmatchedIdentifiers) {
      for (const recentFlight of recentFlights) {
        const recentIcao24 = typeof recentFlight.icao24 === 'string' ? recentFlight.icao24.trim().toLowerCase() : '';
        if (!recentIcao24 || !matchesRecentFlightIdentifier(recentFlight, identifier)) {
          continue;
        }

        const existing = matchesByAircraft.get(recentIcao24);
        if (existing) {
          existing.matchedBy.add(identifier);

          const existingLastSeen = existing.recentFlight?.lastSeen ?? 0;
          const nextLastSeen = recentFlight.lastSeen ?? 0;
          if (!existing.recentFlight || nextLastSeen >= existingLastSeen) {
            existing.recentFlight = recentFlight;
          }
        } else {
          matchesByAircraft.set(recentIcao24, {
            state: null,
            recentFlight,
            matchedBy: new Set([identifier]),
          });
        }

        matchedIdentifiers.add(identifier);
      }
    }
  }

  const flights = await Promise.all(
    Array.from(matchesByAircraft.entries()).map(async ([icao24, { state, recentFlight, matchedBy }]) => {
      const referenceTime = state?.lastContact ?? recentFlight?.lastSeen ?? Math.floor(Date.now() / 1000);
      const [track, routeResult] = await Promise.all([
        getTrackForAircraft(icao24, referenceTime).catch(() => []),
        getRecentRoute(icao24, referenceTime).catch(() => createEmptyRoute()),
      ]);

      const current = state
        ? projectPoint({
            time: state.lastContact,
            latitude: state.latitude,
            longitude: state.longitude,
            altitude: state.geoAltitude ?? state.baroAltitude,
            heading: state.trueTrack,
            onGround: state.onGround,
          })
        : track.at(-1) ?? null;

      const originPoint = track[0] ?? current;
      const guessedDepartureAirport = !routeResult.departureAirport && !recentFlight?.estDepartureAirport
        ? await guessDepartureAirportFromOriginPoint(track[0] ?? null)
        : null;

      const route = {
        departureAirport: routeResult.departureAirport
          ?? recentFlight?.estDepartureAirport
          ?? getAirportLookupCode(guessedDepartureAirport),
        arrivalAirport: routeResult.arrivalAirport ?? recentFlight?.estArrivalAirport ?? null,
        firstSeen: routeResult.firstSeen ?? recentFlight?.firstSeen ?? null,
        lastSeen: routeResult.lastSeen ?? recentFlight?.lastSeen ?? null,
      };

      return {
        icao24,
        callsign: state?.callsign || recentFlight?.callsign?.trim() || icao24.toUpperCase(),
        originCountry: state?.originCountry ?? 'Unknown',
        matchedBy: Array.from(matchedBy),
        lastContact: state?.lastContact ?? route.lastSeen,
        current,
        originPoint,
        track,
        onGround: state?.onGround ?? current?.onGround ?? false,
        velocity: state?.velocity ?? null,
        heading: state?.trueTrack ?? current?.heading ?? null,
        verticalRate: state?.verticalRate ?? null,
        geoAltitude: state?.geoAltitude ?? current?.altitude ?? null,
        baroAltitude: state?.baroAltitude ?? null,
        squawk: state?.squawk ?? null,
        category: state?.category ?? null,
        route,
      } satisfies TrackedFlight;
    }),
  );

  flights.sort((first, second) => first.callsign.localeCompare(second.callsign));

  return {
    query,
    requestedIdentifiers,
    matchedIdentifiers: Array.from(matchedIdentifiers),
    notFoundIdentifiers: requestedIdentifiers.filter((identifier) => !matchedIdentifiers.has(identifier)),
    fetchedAt,
    flights,
  };
}

export async function searchFlights(query: string): Promise<TrackerApiResponse> {
  const requestedIdentifiers = parseIdentifierQuery(query);
  const trimmedQuery = query.trim();

  if (requestedIdentifiers.length === 0) {
    return {
      query: trimmedQuery,
      requestedIdentifiers: [],
      matchedIdentifiers: [],
      notFoundIdentifiers: [],
      fetchedAt: Date.now(),
      flights: [],
    };
  }

  const cacheKey = buildSearchCacheKey(requestedIdentifiers);

  const recentCachedResult = readRecentSearchResult(cacheKey);
  if (recentCachedResult) {
    return recentCachedResult;
  }

  const cachedResult = await readFlightSearchCache(cacheKey);
  if (cachedResult) {
    writeRecentSearchResult(cacheKey, cachedResult);
    return cachedResult;
  }

  const existingSearch = inFlightSearches.get(cacheKey);
  if (existingSearch) {
    return existingSearch;
  }

  const pendingSearch = (async () => {
    const freshResult = await fetchFreshFlights(trimmedQuery, requestedIdentifiers);
    await writeFlightSearchCache(cacheKey, freshResult);
    writeRecentSearchResult(cacheKey, freshResult);
    return freshResult;
  })().finally(() => {
    inFlightSearches.delete(cacheKey);
  });

  inFlightSearches.set(cacheKey, pendingSearch);
  return pendingSearch;
}
