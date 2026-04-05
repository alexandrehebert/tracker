import { geoNaturalEarth1 } from 'd3-geo';
import type { AirportDetails, FlightMapPoint, TrackedFlightRoute } from '~/components/tracker/flight/types';
import { guessNearestAirportDetails } from '~/lib/server/airports';
import { getProviderDisabledReason, isProviderEnabled } from './index';

const OPENSKY_TOKEN_URL = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';
const OPENSKY_API_BASE = 'https://opensky-network.org/api';
const TRACKER_MAP_VIEWBOX = { width: 1000, height: 560 };
const TOKEN_REFRESH_MARGIN_MS = 30_000;
const TRACK_ALTITUDE_NOISE_MAX_NEIGHBOR_DELTA_METERS = 140;
const TRACK_ALTITUDE_NOISE_MIN_DEVIATION_METERS = 140;
const TRACK_ALTITUDE_NOISE_MIN_SWING_METERS = 300;
const TRACK_ALTITUDE_NOISE_SMOOTHING_PASSES = 2;
const TRACK_INTERPOLATION_MIN_GAP_SECONDS = 3 * 60;
const TRACK_INTERPOLATION_MAX_GAP_SECONDS = 15 * 60;
const TRACK_INTERPOLATION_STEP_SECONDS = 2 * 60;
const TRACK_INTERPOLATION_MIN_ALTITUDE_DELTA_METERS = 150;

type Credentials = {
  clientId: string;
  clientSecret: string;
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

export type OpenSkyTrackHistory = {
  track: FlightMapPoint[];
  rawTrack: FlightMapPoint[];
};

const projection = geoNaturalEarth1();
projection.fitSize([TRACKER_MAP_VIEWBOX.width, TRACKER_MAP_VIEWBOX.height], { type: 'Sphere' } as never);

let credentialsCache: Credentials | null = null;
let tokenCache: { accessToken: string; expiresAt: number } | null = null;

type OpenSkyDiagnosticsCarrier = Error & {
  cause?: unknown;
  code?: string | number;
  errno?: string | number;
  syscall?: string;
  address?: string;
  host?: string;
  hostname?: string;
  port?: number;
  diagnostics?: Record<string, unknown>;
};

const OPENSKY_REQUEST_TIMEOUT_MS = 15_000;

function toNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function compactRecord(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value != null && value !== ''));
}

function truncateText(value: string, maxLength = 240): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1)}…`;
}

function getOpenSkyRequestSignal(): AbortSignal | undefined {
  return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(OPENSKY_REQUEST_TIMEOUT_MS)
    : undefined;
}

function extractErrorMetadata(error: unknown): Record<string, unknown> {
  const candidate = typeof error === 'object' && error ? error as OpenSkyDiagnosticsCarrier : null;

  return compactRecord({
    errorName: error instanceof Error ? error.name : null,
    message: error instanceof Error ? error.message : (error != null ? String(error) : null),
    code: candidate?.code,
    errno: candidate?.errno,
    syscall: candidate?.syscall,
    address: candidate?.address,
    host: candidate?.host ?? candidate?.hostname,
    port: candidate?.port,
  });
}

function getOpenSkyNetworkHint(code: string | number | undefined, message: string | null): string | null {
  switch (String(code ?? '').toUpperCase()) {
    case 'ETIMEDOUT':
    case 'UND_ERR_CONNECT_TIMEOUT':
      return 'Connection to OpenSky timed out before a response was received.';
    case 'ENOTFOUND':
      return 'DNS resolution for the OpenSky host failed.';
    case 'ECONNREFUSED':
      return 'The OpenSky host refused the TCP connection.';
    case 'ECONNRESET':
      return 'The connection to OpenSky was reset mid-request.';
    default:
      break;
  }

  if (message && /certificate|tls|ssl/i.test(message)) {
    return 'TLS negotiation with OpenSky failed.';
  }

  return null;
}

function buildOpenSkyTransportDiagnostics(stage: 'auth' | 'request', target: string, error: unknown): {
  message: string;
  diagnostics: Record<string, unknown>;
} {
  const topLevel = extractErrorMetadata(error);
  const cause = typeof error === 'object' && error && 'cause' in error
    ? (error as OpenSkyDiagnosticsCarrier).cause
    : null;
  const causeMetadata = extractErrorMetadata(cause);

  const code = causeMetadata.code ?? topLevel.code;
  const causeMessage = typeof causeMetadata.message === 'string' ? causeMetadata.message : null;
  const fetchMessage = typeof topLevel.message === 'string' ? topLevel.message : null;
  const hint = getOpenSkyNetworkHint(code as string | number | undefined, causeMessage ?? fetchMessage);

  const detailParts = [
    code != null ? String(code) : null,
    causeMessage,
    fetchMessage && fetchMessage !== 'fetch failed' && fetchMessage !== causeMessage ? fetchMessage : null,
  ].filter((part): part is string => Boolean(part));

  const baseMessage = stage === 'auth'
    ? 'OpenSky authentication request failed'
    : `OpenSky request failed for ${target}`;
  const message = detailParts.length > 0
    ? `${baseMessage} (${detailParts.join(' • ')})`
    : baseMessage;

  return {
    message,
    diagnostics: compactRecord({
      stage,
      url: target,
      errorName: topLevel.errorName,
      fetchMessage,
      causeName: causeMetadata.errorName,
      causeMessage,
      code,
      errno: causeMetadata.errno ?? topLevel.errno,
      syscall: causeMetadata.syscall ?? topLevel.syscall,
      host: causeMetadata.host ?? topLevel.host,
      address: causeMetadata.address ?? topLevel.address,
      port: causeMetadata.port ?? topLevel.port,
      hint,
    }),
  };
}

function createOpenSkyError(message: string, diagnostics: Record<string, unknown>, cause?: unknown): Error {
  const wrapped = new Error(message) as OpenSkyDiagnosticsCarrier;
  wrapped.name = 'OpenSkyRequestError';
  wrapped.diagnostics = diagnostics;

  if (cause !== undefined) {
    wrapped.cause = cause;
  }

  return wrapped;
}

async function readResponsePreview(response: Response): Promise<string | null> {
  try {
    const body = (await response.text()).trim();
    return body ? truncateText(body.replace(/\s+/g, ' ')) : null;
  } catch {
    return null;
  }
}

export function getOpenSkyErrorDiagnostics(error: unknown): Record<string, unknown> | null {
  const candidate = typeof error === 'object' && error ? error as OpenSkyDiagnosticsCarrier : null;
  if (candidate?.diagnostics && typeof candidate.diagnostics === 'object') {
    return candidate.diagnostics;
  }

  const topLevel = extractErrorMetadata(error);
  const cause = candidate?.cause;
  const causeMetadata = extractErrorMetadata(cause);
  const merged = compactRecord({
    errorName: topLevel.errorName,
    fetchMessage: topLevel.message,
    causeName: causeMetadata.errorName,
    causeMessage: causeMetadata.message,
    code: causeMetadata.code ?? topLevel.code,
    errno: causeMetadata.errno ?? topLevel.errno,
    syscall: causeMetadata.syscall ?? topLevel.syscall,
    host: causeMetadata.host ?? topLevel.host,
    address: causeMetadata.address ?? topLevel.address,
    port: causeMetadata.port ?? topLevel.port,
  });

  return Object.keys(merged).length > 0 ? merged : null;
}

function projectPoint(params: {
  time: number | null;
  latitude: number | null;
  longitude: number | null;
  altitude: number | null;
  heading: number | null;
  onGround: boolean;
}): FlightMapPoint | null {
  const { latitude, longitude, time, altitude, heading, onGround } = params;

  if (latitude == null || longitude == null || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  const coordinates = projection([longitude, latitude]);
  if (!coordinates) {
    return null;
  }

  return {
    time,
    latitude,
    longitude,
    x: coordinates[0],
    y: coordinates[1],
    altitude,
    heading,
    onGround,
  };
}

function sortTrackPointsChronologically(points: FlightMapPoint[]): FlightMapPoint[] {
  return [...points].sort((first, second) => {
    if (first.time == null && second.time == null) return 0;
    if (first.time == null) return 1;
    if (second.time == null) return -1;
    return first.time - second.time;
  });
}

function removeObviousAltitudeNoise(points: FlightMapPoint[]): FlightMapPoint[] {
  if (points.length < 3) {
    return points;
  }

  const normalized = [...points];

  for (let pass = 0; pass < TRACK_ALTITUDE_NOISE_SMOOTHING_PASSES; pass += 1) {
    for (let index = 1; index < normalized.length - 1; index += 1) {
      const point = normalized[index]!;
      const previous = normalized[index - 1]!;
      const next = normalized[index + 1]!;

      if (point.altitude == null || previous.altitude == null || next.altitude == null) {
        continue;
      }

      const baselineAltitude = (previous.altitude + next.altitude) / 2;
      const areImmediateNeighborsAligned = Math.abs(previous.altitude - next.altitude) <= TRACK_ALTITUDE_NOISE_MAX_NEIGHBOR_DELTA_METERS;
      const isSinglePointOutlier = Math.abs(point.altitude - baselineAltitude) >= TRACK_ALTITUDE_NOISE_MIN_DEVIATION_METERS;

      if (areImmediateNeighborsAligned && isSinglePointOutlier) {
        normalized[index] = { ...point, altitude: baselineAltitude };
      }
    }

    for (let index = 1; index < normalized.length - 2; index += 1) {
      const start = normalized[index - 1]!;
      const first = normalized[index]!;
      const second = normalized[index + 1]!;
      const end = normalized[index + 2]!;

      if (
        start.altitude == null
        || first.altitude == null
        || second.altitude == null
        || end.altitude == null
      ) {
        continue;
      }

      const baselineAltitude = (start.altitude + end.altitude) / 2;
      const firstOffset = first.altitude - baselineAltitude;
      const secondOffset = second.altitude - baselineAltitude;
      const areAnchorsAligned = Math.abs(start.altitude - end.altitude) <= TRACK_ALTITUDE_NOISE_MAX_NEIGHBOR_DELTA_METERS;
      const swingsAcrossBaseline = firstOffset * secondOffset < 0;
      const isShortWobble = Math.abs(firstOffset) >= TRACK_ALTITUDE_NOISE_MIN_DEVIATION_METERS
        && Math.abs(secondOffset) >= TRACK_ALTITUDE_NOISE_MIN_DEVIATION_METERS
        && Math.abs(first.altitude - second.altitude) >= TRACK_ALTITUDE_NOISE_MIN_SWING_METERS;

      if (areAnchorsAligned && swingsAcrossBaseline && isShortWobble) {
        const altitudeStep = (end.altitude - start.altitude) / 3;
        normalized[index] = { ...first, altitude: start.altitude + altitudeStep };
        normalized[index + 1] = { ...second, altitude: start.altitude + (altitudeStep * 2) };
        index += 1;
      }
    }
  }

  return normalized;
}

function interpolateTrackPoint(start: FlightMapPoint, end: FlightMapPoint, ratio: number): FlightMapPoint {
  return {
    time: start.time != null && end.time != null
      ? Math.round(start.time + ((end.time - start.time) * ratio))
      : null,
    latitude: start.latitude + ((end.latitude - start.latitude) * ratio),
    longitude: start.longitude + ((end.longitude - start.longitude) * ratio),
    x: start.x + ((end.x - start.x) * ratio),
    y: start.y + ((end.y - start.y) * ratio),
    altitude: start.altitude != null && end.altitude != null
      ? start.altitude + ((end.altitude - start.altitude) * ratio)
      : (start.altitude ?? end.altitude ?? null),
    heading: start.heading != null && end.heading != null
      ? start.heading + ((end.heading - start.heading) * ratio)
      : (end.heading ?? start.heading ?? null),
    onGround: start.onGround && end.onGround,
  };
}

function fillTrackDataGaps(points: FlightMapPoint[]): FlightMapPoint[] {
  if (points.length < 2) {
    return points;
  }

  const normalized: FlightMapPoint[] = [points[0]!];

  for (let index = 1; index < points.length; index += 1) {
    const previous = normalized.at(-1)!;
    const current = points[index]!;

    if (
      previous.time != null
      && current.time != null
      && !previous.onGround
      && !current.onGround
    ) {
      const gap = current.time - previous.time;
      const altitudeDelta = previous.altitude != null && current.altitude != null
        ? Math.abs(current.altitude - previous.altitude)
        : 0;

      if (
        gap >= TRACK_INTERPOLATION_MIN_GAP_SECONDS
        && gap <= TRACK_INTERPOLATION_MAX_GAP_SECONDS
        && altitudeDelta >= TRACK_INTERPOLATION_MIN_ALTITUDE_DELTA_METERS
      ) {
        const steps = Math.floor(gap / TRACK_INTERPOLATION_STEP_SECONDS);
        for (let step = 1; step <= steps; step += 1) {
          normalized.push(interpolateTrackPoint(previous, current, step / (steps + 1)));
        }
      }
    }

    normalized.push(current);
  }

  return normalized;
}

function normalizeTrackHistory(points: FlightMapPoint[]): FlightMapPoint[] {
  return fillTrackDataGaps(removeObviousAltitudeNoise(sortTrackPointsChronologically(points)));
}

async function readCredentialsFromEnv(): Promise<Credentials> {
  const disabledReason = getProviderDisabledReason('opensky');
  if (disabledReason) {
    throw new Error(disabledReason);
  }

  if (credentialsCache) {
    return credentialsCache;
  }

  const clientId = process.env.OPENSKY_CLIENT_ID?.trim();
  const clientSecret = process.env.OPENSKY_CLIENT_SECRET?.trim();

  if (!clientId || !clientSecret) {
    throw new Error('Missing OpenSky client credentials. Set OPENSKY_CLIENT_ID and OPENSKY_CLIENT_SECRET in your environment.');
  }

  credentialsCache = { clientId, clientSecret };
  return credentialsCache;
}

async function getAccessToken(forceRefresh = false): Promise<string> {
  if (!forceRefresh && tokenCache && Date.now() < tokenCache.expiresAt - TOKEN_REFRESH_MARGIN_MS) {
    return tokenCache.accessToken;
  }

  const credentials = await readCredentialsFromEnv();

  let response: Response;
  try {
    response = await fetch(OPENSKY_TOKEN_URL, {
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
      signal: getOpenSkyRequestSignal(),
    });
  } catch (error) {
    const { message, diagnostics } = buildOpenSkyTransportDiagnostics('auth', OPENSKY_TOKEN_URL, error);
    throw createOpenSkyError(message, diagnostics, error);
  }

  if (!response.ok) {
    const bodyPreview = await readResponsePreview(response);
    const statusSummary = [response.status, response.statusText].filter(Boolean).join(' ');
    const message = bodyPreview
      ? `OpenSky auth failed with status ${statusSummary}: ${bodyPreview}`
      : `OpenSky auth failed with status ${statusSummary}`;

    throw createOpenSkyError(message, compactRecord({
      stage: 'auth',
      url: OPENSKY_TOKEN_URL,
      status: response.status,
      statusText: response.statusText,
      bodyPreview,
    }));
  }

  const payload = await response.json() as { access_token?: string; expires_in?: number };
  if (!payload.access_token) {
    throw createOpenSkyError(
      'OpenSky auth response did not include an access token.',
      { stage: 'auth', url: OPENSKY_TOKEN_URL },
    );
  }

  tokenCache = {
    accessToken: payload.access_token,
    expiresAt: Date.now() + (payload.expires_in ?? 1800) * 1000,
  };

  return tokenCache.accessToken;
}

export async function fetchOpenSky<T>(pathname: string, searchParams?: Record<string, string | number | undefined>): Promise<T> {
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
    const url = makeUrl();

    try {
      return await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: 'no-store',
        signal: getOpenSkyRequestSignal(),
      });
    } catch (error) {
      const { message, diagnostics } = buildOpenSkyTransportDiagnostics('request', url.toString(), error);
      throw createOpenSkyError(message, diagnostics, error);
    }
  };

  let response = await execute(false);

  if (response.status === 401) {
    response = await execute(true);
  }

  if (response.status === 404) {
    return null as T;
  }

  if (!response.ok) {
    const bodyPreview = await readResponsePreview(response);
    const statusSummary = [response.status, response.statusText].filter(Boolean).join(' ');
    const message = bodyPreview
      ? `OpenSky request failed for ${pathname} with status ${statusSummary}: ${bodyPreview}`
      : `OpenSky request failed for ${pathname} with status ${statusSummary}`;

    throw createOpenSkyError(message, compactRecord({
      stage: 'request',
      pathname,
      url: response.url || makeUrl().toString(),
      status: response.status,
      statusText: response.statusText,
      bodyPreview,
      searchParams,
    }));
  }

  return response.json() as Promise<T>;
}

export function isOpenSkyConfigured(): boolean {
  return Boolean(process.env.OPENSKY_CLIENT_ID?.trim())
    && Boolean(process.env.OPENSKY_CLIENT_SECRET?.trim())
    && isProviderEnabled('opensky');
}

export async function getTrackForAircraft(icao24: string, referenceTime = 0): Promise<OpenSkyTrackHistory> {
  const safeReferenceTime = Number.isFinite(referenceTime) && referenceTime > 0 ? Math.floor(referenceTime) : 0;
  const response = await fetchOpenSky<OpenSkyTrackResponse | null>('/tracks/all', {
    icao24,
    time: safeReferenceTime,
  });

  const path = Array.isArray(response?.path) ? response.path : [];
  const rawTrack = sortTrackPointsChronologically(
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

  return {
    rawTrack,
    track: normalizeTrackHistory(rawTrack),
  };
}

export async function getRecentRoute(icao24: string, referenceTime: number): Promise<TrackedFlightRoute> {
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

export async function guessDepartureAirportFromOriginPoint(originPoint: FlightMapPoint | null): Promise<AirportDetails | null> {
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
