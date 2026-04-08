import { MongoClient, type Collection } from 'mongodb';
import { Agent } from 'undici';
import { geoNaturalEarth1 } from 'd3-geo';
import type { AirportDetails, FlightMapPoint, TrackedFlightRoute } from '~/components/tracker/flight/types';
import { guessNearestAirportDetails } from '~/lib/server/airports';
import { getProviderDisabledReason, getProviderDisabledReasonAsync, isProviderEnabled } from './index';
import { recordProviderRequestLog } from './observability';

const DEFAULT_DB_NAME = 'tracker';
const OPENSKY_TOKEN_COLLECTION_NAME = 'opensky_token_cache';
const OPENSKY_TOKEN_DOCUMENT_ID = 'shared';
const DEFAULT_OPENSKY_TOKEN_URL = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';
const DEFAULT_OPENSKY_API_BASE = 'https://opensky-network.org/api';
const OPENSKY_PROXY_SECRET_HEADER_NAME = 'x-opensky-proxy-secret';
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

type OpenSkyStoredTokenSource = 'oauth' | 'manual';

type CachedOpenSkyToken = {
  accessToken: string;
  expiresAt: number;
  fetchedAt: number;
  storageSource: OpenSkyStoredTokenSource;
};

export type OpenSkyTokenStatus = {
  providerConfigured: boolean;
  mongoConfigured: boolean;
  hasToken: boolean;
  cacheSource: 'memory' | 'mongo' | 'none';
  storageSource: OpenSkyStoredTokenSource | null;
  tokenPreview: string | null;
  accessToken: string | null;
  fetchedAt: number | null;
  expiresAt: number | null;
  expiresInMs: number | null;
  isExpired: boolean;
};

type OpenSkyTokenDocument = {
  _id: typeof OPENSKY_TOKEN_DOCUMENT_ID;
  accessToken: string;
  expiresAt: Date;
  fetchedAt: Date;
  updatedAt: Date;
  storageSource: OpenSkyStoredTokenSource;
};

let credentialsCache: Credentials | null = null;
let tokenCache: CachedOpenSkyToken | null = null;
let tokenFetchPromise: Promise<CachedOpenSkyToken> | null = null;
let mongoClientPromise: Promise<MongoClient> | null = null;
let openSkyTokenIndexesReady: Promise<void> | null = null;
let mongoWarningLogged = false;

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

type OpenSkyRequestInit = RequestInit & {
  dispatcher?: Agent;
};

const DEFAULT_OPENSKY_REQUEST_TIMEOUT_MS = process.env.VERCEL ? 25_000 : 15_000;
const parsedOpenSkyRequestTimeoutMs = Number.parseInt(process.env.OPENSKY_REQUEST_TIMEOUT_MS?.trim() ?? '', 10);
const OPENSKY_REQUEST_TIMEOUT_MS = Number.isFinite(parsedOpenSkyRequestTimeoutMs) && parsedOpenSkyRequestTimeoutMs > 0
  ? parsedOpenSkyRequestTimeoutMs
  : DEFAULT_OPENSKY_REQUEST_TIMEOUT_MS;
const DEFAULT_OPENSKY_CONNECT_TIMEOUT_MS = process.env.VERCEL ? 30_000 : 15_000;
const parsedOpenSkyConnectTimeoutMs = Number.parseInt(process.env.OPENSKY_CONNECT_TIMEOUT_MS?.trim() ?? '', 10);
const OPENSKY_CONNECT_TIMEOUT_MS = Number.isFinite(parsedOpenSkyConnectTimeoutMs) && parsedOpenSkyConnectTimeoutMs > 0
  ? parsedOpenSkyConnectTimeoutMs
  : DEFAULT_OPENSKY_CONNECT_TIMEOUT_MS;
const OPENSKY_RETRY_DELAY_MS = 250;
const OPENSKY_RETRY_ATTEMPTS = 2;
const OPENSKY_RETRYABLE_ERROR_CODES = new Set([
  '23',
  'ABORT_ERR',
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'EPIPE',
  'ETIMEDOUT',
  'ENETDOWN',
  'ENETRESET',
  'ENETUNREACH',
  'EAI_AGAIN',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_SOCKET',
]);

const openSkyDispatcher = new Agent({
  connectTimeout: OPENSKY_CONNECT_TIMEOUT_MS,
});

function getOpenSkyProxyBaseUrl(): string | null {
  const value = process.env.OPENSKY_PROXY_URL?.trim();
  return value ? value.replace(/\/+$/, '') : null;
}

function getOpenSkyProxySecret(): string | null {
  const value = process.env.OPENSKY_PROXY_SECRET?.trim();
  return value || null;
}

function buildOpenSkyProxyHeaders(): Record<string, string> {
  const proxySecret = getOpenSkyProxySecret();
  return proxySecret ? { [OPENSKY_PROXY_SECRET_HEADER_NAME]: proxySecret } : {};
}

function getOpenSkyTokenUrl(): string {
  const proxyBaseUrl = getOpenSkyProxyBaseUrl();
  return proxyBaseUrl
    ? `${proxyBaseUrl}/auth/realms/opensky-network/protocol/openid-connect/token`
    : DEFAULT_OPENSKY_TOKEN_URL;
}

function getOpenSkyApiBase(): string {
  const proxyBaseUrl = getOpenSkyProxyBaseUrl();
  return proxyBaseUrl ? `${proxyBaseUrl}/api` : DEFAULT_OPENSKY_API_BASE;
}

function hasLocalOpenSkyCredentials(): boolean {
  return Boolean(process.env.OPENSKY_CLIENT_ID?.trim())
    && Boolean(process.env.OPENSKY_CLIENT_SECRET?.trim());
}

export function getOpenSkyConnectionConfig(): {
  proxyEnabled: boolean;
  proxyBaseUrl: string | null;
  proxySecretConfigured: boolean;
  tokenUrl: string;
  apiBaseUrl: string;
} {
  const proxyBaseUrl = getOpenSkyProxyBaseUrl();

  return {
    proxyEnabled: Boolean(proxyBaseUrl),
    proxyBaseUrl,
    proxySecretConfigured: Boolean(getOpenSkyProxySecret()),
    tokenUrl: getOpenSkyTokenUrl(),
    apiBaseUrl: getOpenSkyApiBase(),
  };
}

function isMongoConfigured(): boolean {
  return Boolean(process.env.MONGODB_URI?.trim());
}

function getMongoDbName(): string {
  return process.env.MONGODB_DB_NAME?.trim() || DEFAULT_DB_NAME;
}

function logMongoWarning(error: unknown) {
  if (mongoWarningLogged) {
    return;
  }

  mongoWarningLogged = true;
  console.warn('MongoDB OpenSky token cache is unavailable.', error);
}

function createCachedOpenSkyToken(params: {
  accessToken: string;
  expiresAt: number;
  fetchedAt?: number;
  storageSource: OpenSkyStoredTokenSource;
}): CachedOpenSkyToken {
  return {
    accessToken: params.accessToken,
    expiresAt: params.expiresAt,
    fetchedAt: params.fetchedAt ?? Date.now(),
    storageSource: params.storageSource,
  };
}

function isOpenSkyTokenValid(token: CachedOpenSkyToken | null, allowRefreshMarginBypass = false): token is CachedOpenSkyToken {
  if (!token) {
    return false;
  }

  const thresholdMs = allowRefreshMarginBypass ? 0 : TOKEN_REFRESH_MARGIN_MS;
  return Date.now() < token.expiresAt - thresholdMs;
}

function maskOpenSkyToken(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmedValue = value.trim();
  if (trimmedValue.length <= 10) {
    return `${trimmedValue.slice(0, 3)}…${trimmedValue.slice(-2)}`;
  }

  return `${trimmedValue.slice(0, 6)}…${trimmedValue.slice(-4)}`;
}

function buildOpenSkyTokenStatus(
  token: CachedOpenSkyToken | null,
  cacheSource: OpenSkyTokenStatus['cacheSource'],
  includeAccessToken = false,
): OpenSkyTokenStatus {
  const expiresInMs = token ? token.expiresAt - Date.now() : null;

  return {
    providerConfigured: isOpenSkyConfigured(),
    mongoConfigured: isMongoConfigured(),
    hasToken: Boolean(token),
    cacheSource,
    storageSource: token?.storageSource ?? null,
    tokenPreview: maskOpenSkyToken(token?.accessToken),
    accessToken: includeAccessToken ? (token?.accessToken ?? null) : null,
    fetchedAt: token?.fetchedAt ?? null,
    expiresAt: token?.expiresAt ?? null,
    expiresInMs,
    isExpired: expiresInMs != null ? expiresInMs <= 0 : false,
  };
}

async function getOpenSkyTokenCollection(): Promise<Collection<OpenSkyTokenDocument> | null> {
  const mongoUri = process.env.MONGODB_URI?.trim();
  if (!mongoUri) {
    return null;
  }

  try {
    if (!mongoClientPromise) {
      const client = new MongoClient(mongoUri);
      mongoClientPromise = client.connect();
    }

    let client: MongoClient;
    try {
      client = await mongoClientPromise;
    } catch (error) {
      mongoClientPromise = null;
      throw error;
    }

    const collection = client.db(getMongoDbName()).collection<OpenSkyTokenDocument>(OPENSKY_TOKEN_COLLECTION_NAME);

    if (!openSkyTokenIndexesReady) {
      openSkyTokenIndexesReady = Promise.all([
        collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
        collection.createIndex({ updatedAt: -1 }),
      ]).then(() => undefined);
    }

    try {
      await openSkyTokenIndexesReady;
    } catch (error) {
      openSkyTokenIndexesReady = null;
      throw error;
    }

    return collection;
  } catch (error) {
    logMongoWarning(error);
    return null;
  }
}

async function readStoredOpenSkyToken(allowRefreshMarginBypass = false): Promise<CachedOpenSkyToken | null> {
  const collection = await getOpenSkyTokenCollection();
  if (!collection) {
    return null;
  }

  try {
    const document = await collection.findOne({ _id: OPENSKY_TOKEN_DOCUMENT_ID } as Parameters<typeof collection.findOne>[0]);
    if (!document?.accessToken) {
      return null;
    }

    const expiresAt = document.expiresAt instanceof Date ? document.expiresAt.getTime() : Number(document.expiresAt);
    const fetchedAt = document.fetchedAt instanceof Date ? document.fetchedAt.getTime() : Date.now();
    const token = createCachedOpenSkyToken({
      accessToken: document.accessToken,
      expiresAt,
      fetchedAt,
      storageSource: document.storageSource ?? 'oauth',
    });

    return isOpenSkyTokenValid(token, allowRefreshMarginBypass) ? token : null;
  } catch (error) {
    logMongoWarning(error);
    return null;
  }
}

async function persistOpenSkyToken(token: CachedOpenSkyToken): Promise<void> {
  const collection = await getOpenSkyTokenCollection();
  if (!collection) {
    return;
  }

  try {
    await collection.updateOne(
      { _id: OPENSKY_TOKEN_DOCUMENT_ID } as Parameters<typeof collection.updateOne>[0],
      {
        $set: {
          _id: OPENSKY_TOKEN_DOCUMENT_ID,
          accessToken: token.accessToken,
          expiresAt: new Date(token.expiresAt),
          fetchedAt: new Date(token.fetchedAt),
          updatedAt: new Date(),
          storageSource: token.storageSource,
        },
      },
      { upsert: true },
    );
  } catch (error) {
    logMongoWarning(error);
  }
}

async function clearPersistedOpenSkyToken(): Promise<void> {
  const collection = await getOpenSkyTokenCollection();
  if (!collection) {
    return;
  }

  try {
    await collection.deleteOne?.({ _id: OPENSKY_TOKEN_DOCUMENT_ID } as Parameters<typeof collection.deleteOne>[0]);
  } catch (error) {
    logMongoWarning(error);
  }
}

export async function getOpenSkyTokenStatus(includeAccessToken = false): Promise<OpenSkyTokenStatus> {
  if (isOpenSkyTokenValid(tokenCache, true)) {
    return buildOpenSkyTokenStatus(tokenCache, 'memory', includeAccessToken);
  }

  const storedToken = await readStoredOpenSkyToken(true);
  if (storedToken) {
    return buildOpenSkyTokenStatus(storedToken, 'mongo', includeAccessToken);
  }

  return buildOpenSkyTokenStatus(null, 'none', includeAccessToken);
}

export async function setStoredOpenSkyAccessToken(accessToken: string, expiresInSeconds = 1800): Promise<OpenSkyTokenStatus> {
  const normalizedToken = accessToken.trim();
  if (!normalizedToken) {
    throw new Error('Provide a non-empty OpenSky access token.');
  }

  const parsedExpiresInSeconds = Number.isFinite(expiresInSeconds) && expiresInSeconds > 0
    ? Math.floor(expiresInSeconds)
    : 1800;
  const nextToken = createCachedOpenSkyToken({
    accessToken: normalizedToken,
    expiresAt: Date.now() + (parsedExpiresInSeconds * 1000),
    storageSource: 'manual',
  });

  tokenCache = nextToken;
  await persistOpenSkyToken(nextToken);
  return buildOpenSkyTokenStatus(nextToken, 'memory');
}

export async function clearStoredOpenSkyAccessToken(): Promise<OpenSkyTokenStatus> {
  tokenCache = null;
  await clearPersistedOpenSkyToken();
  return buildOpenSkyTokenStatus(null, 'none');
}

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

function getOpenSkyRequestSignal(baseSignal?: AbortSignal | null): AbortSignal | undefined {
  const timeoutSignal = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(OPENSKY_REQUEST_TIMEOUT_MS)
    : undefined;

  if (baseSignal && timeoutSignal && typeof AbortSignal.any === 'function') {
    return AbortSignal.any([baseSignal, timeoutSignal]);
  }

  return baseSignal ?? timeoutSignal;
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

function getOpenSkyErrorCode(error: unknown): string | null {
  const candidate = typeof error === 'object' && error ? error as OpenSkyDiagnosticsCarrier : null;
  const cause = typeof candidate?.cause === 'object' && candidate.cause ? candidate.cause as OpenSkyDiagnosticsCarrier : null;
  const code = cause?.code ?? candidate?.code;
  return code == null ? null : String(code).toUpperCase();
}

function shouldRetryOpenSkyTransportError(error: unknown): boolean {
  const code = getOpenSkyErrorCode(error);
  if (code && OPENSKY_RETRYABLE_ERROR_CODES.has(code)) {
    return true;
  }

  const candidate = typeof error === 'object' && error ? error as OpenSkyDiagnosticsCarrier : null;
  const name = error instanceof Error ? error.name : String(candidate?.name ?? '');
  const message = error instanceof Error ? error.message : (error != null ? String(error) : '');

  if (/^(AbortError|TimeoutError)$/i.test(name) && /timeout/i.test(message)) {
    return true;
  }

  return /connect timeout|timed out|timeout|socket hang up|fetch failed/i.test(message);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function fetchWithOpenSkyTransportRetry(
  input: URL | string,
  init: RequestInit,
  stage: 'auth' | 'request',
  target: string,
): Promise<Response> {
  let attempt = 0;

  while (attempt < OPENSKY_RETRY_ATTEMPTS) {
    attempt += 1;

    try {
      const requestInit: OpenSkyRequestInit = {
        ...init,
        dispatcher: openSkyDispatcher,
        signal: getOpenSkyRequestSignal(init.signal),
      };

      return await fetch(input, requestInit);
    } catch (error) {
      const shouldRetry = attempt < OPENSKY_RETRY_ATTEMPTS && shouldRetryOpenSkyTransportError(error);
      if (shouldRetry) {
        await wait(OPENSKY_RETRY_DELAY_MS);
        continue;
      }

      const { message, diagnostics } = buildOpenSkyTransportDiagnostics(stage, target, error);
      throw createOpenSkyError(message, {
        ...diagnostics,
        attempts: attempt,
      }, error);
    }
  }

  const unreachableMessage = stage === 'auth'
    ? 'OpenSky authentication request failed'
    : `OpenSky request failed for ${target}`;

  throw createOpenSkyError(unreachableMessage, {
    stage,
    url: target,
    attempts: attempt,
  });
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
      timeoutMs: OPENSKY_REQUEST_TIMEOUT_MS,
      connectTimeoutMs: OPENSKY_CONNECT_TIMEOUT_MS,
      runtimeEnvironment: process.env.VERCEL ? 'vercel' : 'node',
      vercelRegion: process.env.VERCEL_REGION,
      vercelEnvironment: process.env.VERCEL_ENV,
      viaProxy: Boolean(getOpenSkyProxyBaseUrl()),
      proxyBaseUrl: getOpenSkyProxyBaseUrl(),
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
  const disabledReason = await getProviderDisabledReasonAsync('opensky');
  if (disabledReason) {
    throw new Error(disabledReason);
  }

  if (credentialsCache) {
    return credentialsCache;
  }

  const clientId = process.env.OPENSKY_CLIENT_ID?.trim() ?? '';
  const clientSecret = process.env.OPENSKY_CLIENT_SECRET?.trim() ?? '';

  if ((!clientId || !clientSecret) && !getOpenSkyProxyBaseUrl()) {
    throw new Error('Missing OpenSky client credentials. Set OPENSKY_CLIENT_ID and OPENSKY_CLIENT_SECRET in your environment, or configure OPENSKY_PROXY_URL for an external proxy.');
  }

  credentialsCache = { clientId, clientSecret };
  return credentialsCache;
}

async function getAccessToken(forceRefresh = false): Promise<string> {
  if (!forceRefresh && isOpenSkyTokenValid(tokenCache)) {
    return tokenCache.accessToken;
  }

  if (!forceRefresh) {
    const storedToken = await readStoredOpenSkyToken();
    if (storedToken) {
      tokenCache = storedToken;
      return storedToken.accessToken;
    }
  }

  const fallbackToken = isOpenSkyTokenValid(tokenCache, true)
    ? tokenCache
    : await readStoredOpenSkyToken(true);

  if (!tokenFetchPromise) {
    tokenFetchPromise = (async () => {
      const credentials = await readCredentialsFromEnv();
      const tokenUrl = getOpenSkyTokenUrl();
      const tokenRequestBody = new URLSearchParams({
        grant_type: 'client_credentials',
      });

      if (credentials.clientId) {
        tokenRequestBody.set('client_id', credentials.clientId);
      }

      if (credentials.clientSecret) {
        tokenRequestBody.set('client_secret', credentials.clientSecret);
      }

      const startedAt = Date.now();
      const requestDetails = {
        method: 'POST',
        url: tokenUrl,
        body: {
          grant_type: 'client_credentials',
          client_id: credentials.clientId ? '[configured]' : null,
          client_secret: credentials.clientSecret ? '[configured]' : null,
        },
      };
      let responseStatus: number | null = null;
      let responseStatusText: string | null = null;
      let bodyPreview: string | null = null;

      try {
        const response = await fetchWithOpenSkyTransportRetry(
          tokenUrl,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              Accept: 'application/json',
              ...buildOpenSkyProxyHeaders(),
            },
            body: tokenRequestBody,
            cache: 'no-store',
          },
          'auth',
          tokenUrl,
        );

        responseStatus = response.status;
        responseStatusText = response.statusText;

        if (!response.ok) {
          bodyPreview = await readResponsePreview(response.clone());
          const statusSummary = [response.status, response.statusText].filter(Boolean).join(' ');
          const message = bodyPreview
            ? `OpenSky auth failed with status ${statusSummary}: ${bodyPreview}`
            : `OpenSky auth failed with status ${statusSummary}`;

          throw createOpenSkyError(message, compactRecord({
            stage: 'auth',
            url: tokenUrl,
            status: response.status,
            statusText: response.statusText,
            bodyPreview,
          }));
        }

        const payload = await response.json() as { access_token?: string; expires_in?: number };
        if (!payload.access_token) {
          throw createOpenSkyError(
            'OpenSky auth response did not include an access token.',
            { stage: 'auth', url: tokenUrl },
          );
        }

        await recordProviderRequestLog({
          provider: 'opensky',
          operation: 'auth-token',
          status: 'success',
          durationMs: Date.now() - startedAt,
          request: requestDetails,
          response: {
            status: response.status,
            statusText: response.statusText,
            expiresInSeconds: payload.expires_in ?? null,
          },
        });

        const nextToken = createCachedOpenSkyToken({
          accessToken: payload.access_token,
          expiresAt: Date.now() + (payload.expires_in ?? 1800) * 1000,
          storageSource: 'oauth',
        });

        tokenCache = nextToken;
        await persistOpenSkyToken(nextToken);
        return nextToken;
      } catch (error) {
        await recordProviderRequestLog({
          provider: 'opensky',
          operation: 'auth-token',
          status: 'error',
          durationMs: Date.now() - startedAt,
          request: requestDetails,
          response: {
            status: responseStatus,
            statusText: responseStatusText,
            bodyPreview,
          },
          error,
        });
        throw error;
      }
    })().finally(() => {
      tokenFetchPromise = null;
    });
  }

  try {
    const nextToken = await tokenFetchPromise;
    return nextToken.accessToken;
  } catch (error) {
    if (fallbackToken && Date.now() < fallbackToken.expiresAt) {
      tokenCache = fallbackToken;
      return fallbackToken.accessToken;
    }

    throw error;
  }
}

export async function ensureOpenSkyAccessToken(forceRefresh = false): Promise<OpenSkyTokenStatus> {
  await getAccessToken(forceRefresh);
  return getOpenSkyTokenStatus();
}

export async function refreshOpenSkyAccessToken(): Promise<OpenSkyTokenStatus> {
  return ensureOpenSkyAccessToken(true);
}

export async function fetchOpenSky<T>(pathname: string, searchParams?: Record<string, string | number | undefined>): Promise<T> {
  const makeUrl = () => {
    const url = new URL(`${getOpenSkyApiBase()}${pathname}`);
    for (const [key, value] of Object.entries(searchParams ?? {})) {
      if (value === undefined || value === '') continue;
      url.searchParams.set(key, String(value));
    }
    return url;
  };

  const execute = async (forceRefresh = false) => {
    const token = await getAccessToken(forceRefresh);
    const url = makeUrl();

    return fetchWithOpenSkyTransportRetry(
      url,
      {
        headers: {
          Accept: 'application/json',
          ...buildOpenSkyProxyHeaders(),
          Authorization: `Bearer ${token}`,
        },
        cache: 'no-store',
      },
      'request',
      url.toString(),
    );
  };

  const startedAt = Date.now();
  const requestDetails = {
    method: 'GET',
    url: makeUrl().toString(),
    pathname,
    params: searchParams ?? null,
  };
  let responseStatus: number | null = null;
  let responseStatusText: string | null = null;
  let bodyPreview: string | null = null;
  let refreshedAfter401 = false;

  try {
    let response = await execute(false);
    responseStatus = response.status;
    responseStatusText = response.statusText;

    if (response.status === 401) {
      refreshedAfter401 = true;
      response = await execute(true);
      responseStatus = response.status;
      responseStatusText = response.statusText;
    }

    if (response.status === 404) {
      await recordProviderRequestLog({
        provider: 'opensky',
        operation: `api:${pathname}`,
        status: 'no-data',
        durationMs: Date.now() - startedAt,
        request: requestDetails,
        response: {
          status: response.status,
          statusText: response.statusText,
        },
        metadata: { refreshedAfter401 },
      });
      return null as T;
    }

    if (!response.ok) {
      bodyPreview = await readResponsePreview(response.clone());
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

    const payload = await response.json() as T;
    const successStatus = Array.isArray(payload)
      ? (payload.length > 0 ? 'success' : 'no-data')
      : 'success';

    await recordProviderRequestLog({
      provider: 'opensky',
      operation: `api:${pathname}`,
      status: successStatus,
      durationMs: Date.now() - startedAt,
      request: requestDetails,
      response: {
        status: response.status,
        statusText: response.statusText,
        payload,
      },
      metadata: { refreshedAfter401 },
    });

    return payload;
  } catch (error) {
    await recordProviderRequestLog({
      provider: 'opensky',
      operation: `api:${pathname}`,
      status: 'error',
      durationMs: Date.now() - startedAt,
      request: requestDetails,
      response: {
        status: responseStatus,
        statusText: responseStatusText,
        bodyPreview,
      },
      metadata: { refreshedAfter401 },
      error,
    });
    throw error;
  }
}

export function hasOpenSkyConfiguration(): boolean {
  return hasLocalOpenSkyCredentials() || Boolean(getOpenSkyProxyBaseUrl());
}

export function isOpenSkyConfigured(): boolean {
  return hasOpenSkyConfiguration() && isProviderEnabled('opensky');
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
