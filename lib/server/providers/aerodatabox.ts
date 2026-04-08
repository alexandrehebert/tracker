import { geoNaturalEarth1 } from 'd3-geo';
import type { FlightSourceDetail } from '~/components/tracker/flight/types';
import { getProviderDisabledReason, getProviderDisabledReasonAsync, isProviderEnabled } from './index';
import { isProviderHistoryConfigured, readLatestProviderHistory, writeProviderHistory } from './history';
import { recordProviderRequestLog } from './observability';

export type AeroDataBoxFlightEnrichment = {
  provider: 'aerodatabox';
  identifier: string;
  callsign: string;
  flightNumber: string | null;
  route: {
    departureAirport: string | null;
    arrivalAirport: string | null;
    departureAirportName: string | null;
    arrivalAirportName: string | null;
    firstSeen: number | null;
    lastSeen: number | null;
  };
  airline: {
    name: string | null;
    iata: string | null;
    icao: string | null;
  };
  aircraft: {
    registration: string | null;
    iata: string | null;
    icao: string | null;
    icao24: string | null;
    model: string | null;
  };
  current: {
    time: number | null;
    latitude: number;
    longitude: number;
    x: number;
    y: number;
    altitude: number | null;
    heading: number | null;
    onGround: boolean;
  } | null;
  velocity: number | null;
  heading: number | null;
  geoAltitude: number | null;
  onGround: boolean;
};

type AeroDataBoxDateTimeRecord = {
  utc?: string | null;
  local?: string | null;
};

type AeroDataBoxAirportRecord = {
  iata?: string | null;
  icao?: string | null;
  shortName?: string | null;
  name?: string | null;
  municipalityName?: string | null;
  timeZone?: string | null;
};

type AeroDataBoxMovementRecord = {
  airport?: AeroDataBoxAirportRecord | null;
  scheduledTime?: AeroDataBoxDateTimeRecord | null;
  revisedTime?: AeroDataBoxDateTimeRecord | null;
  predictedTime?: AeroDataBoxDateTimeRecord | null;
  runwayTime?: AeroDataBoxDateTimeRecord | null;
  quality?: string[] | null;
};

type AeroDataBoxLocationRecord = {
  reportedAtUtc?: string | null;
  lat?: number | null;
  lon?: number | null;
  altitude?: {
    meter?: number | null;
  } | null;
  groundSpeed?: {
    meterPerSecond?: number | null;
    kt?: number | null;
  } | null;
  trueTrack?: {
    deg?: number | null;
  } | null;
};

type AeroDataBoxFlightRecord = {
  number?: string | null;
  callSign?: string | null;
  status?: string | null;
  departure?: AeroDataBoxMovementRecord | null;
  arrival?: AeroDataBoxMovementRecord | null;
  aircraft?: {
    reg?: string | null;
    modeS?: string | null;
    model?: string | null;
  } | null;
  airline?: {
    name?: string | null;
    iata?: string | null;
    icao?: string | null;
  } | null;
  location?: AeroDataBoxLocationRecord | null;
  lastUpdatedUtc?: string | null;
};

type AeroDataBoxErrorPayload = {
  message?: string;
  error?: string;
};

type SearchVariant = {
  cacheKey: string;
  searchBy: 'Number' | 'CallSign' | 'Reg' | 'Icao24';
  pathname: string;
  params: Record<string, string>;
};

export type AeroDataBoxLookupResult = {
  match: AeroDataBoxFlightEnrichment | null;
  report: FlightSourceDetail;
};

const AERODATABOX_API_BASE = 'https://aerodatabox.p.rapidapi.com';
const TRACKER_MAP_VIEWBOX = { width: 1000, height: 560 };
const PROVIDER_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const DEFAULT_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const DEFAULT_MIN_REQUEST_GAP_MS = 1200;

const projection = geoNaturalEarth1();
projection.fitSize([TRACKER_MAP_VIEWBOX.width, TRACKER_MAP_VIEWBOX.height], { type: 'Sphere' } as never);

let providerCooldownUntil = 0;
let lastAeroDataBoxRequestStartedAt = 0;
let aeroDataBoxRequestQueue = Promise.resolve();
const inMemoryFallbackCache = new Map<string, { payload: AeroDataBoxFlightEnrichment | null; expiresAt: number }>();
const inFlightAeroDataBoxRequests = new Map<string, Promise<unknown>>();

function normalizeIdentifier(value: string | null | undefined): string {
  return typeof value === 'string' ? value.replace(/\s+/g, '').trim().toUpperCase() : '';
}

function toNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function toNullableNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function toTimestampSeconds(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.floor(timestamp / 1000) : null;
}

function getCacheTtlMs(): number {
  const configuredValue = process.env.AERODATABOX_CACHE_TTL_SECONDS?.trim();
  const parsedValue = configuredValue ? Number.parseInt(configuredValue, 10) : NaN;
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue * 1000 : DEFAULT_CACHE_TTL_MS;
}

function getApiKey(): string {
  return process.env.AERODATABOX_RAPIDAPI_KEY?.trim()
    || process.env.RAPIDAPI_AERODATABOX_API_KEY?.trim()
    || process.env.RAPIDAPI_KEY?.trim()
    || process.env.X_RAPIDAPI_KEY?.trim()
    || '';
}

function getMinRequestGapMs(): number {
  const configuredValue = process.env.AERODATABOX_MIN_REQUEST_GAP_MS?.trim();
  const parsedValue = configuredValue ? Number.parseInt(configuredValue, 10) : NaN;
  return Number.isFinite(parsedValue) && parsedValue >= 0 ? parsedValue : DEFAULT_MIN_REQUEST_GAP_MS;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const seconds = Number.parseInt(value, 10);
  if (Number.isFinite(seconds) && seconds > 0) {
    return seconds * 1000;
  }

  const retryAtMs = Date.parse(value);
  if (!Number.isFinite(retryAtMs)) {
    return null;
  }

  const deltaMs = retryAtMs - Date.now();
  return deltaMs > 0 ? deltaMs : null;
}

function getRateLimitCooldownMs(response: Response, payload: AeroDataBoxErrorPayload): number {
  const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'));
  const message = payload.message ?? payload.error ?? '';

  if (response.status === 402 || /(rate|quota|credit|limit)/i.test(message)) {
    return Math.max(retryAfterMs ?? 0, PROVIDER_COOLDOWN_MS);
  }

  return retryAfterMs ?? PROVIDER_COOLDOWN_MS;
}

async function enqueueAeroDataBoxRequest<T>(requestKey: string, fetcher: () => Promise<T>): Promise<T> {
  const inFlightRequest = inFlightAeroDataBoxRequests.get(requestKey);
  if (inFlightRequest) {
    return inFlightRequest as Promise<T>;
  }

  const scheduledRequest = aeroDataBoxRequestQueue.then(async () => {
    const waitMs = Math.max(0, getMinRequestGapMs() - (Date.now() - lastAeroDataBoxRequestStartedAt));
    if (waitMs > 0) {
      await wait(waitMs);
    }

    lastAeroDataBoxRequestStartedAt = Date.now();
    return fetcher();
  });

  aeroDataBoxRequestQueue = scheduledRequest.then(() => undefined, () => undefined);
  inFlightAeroDataBoxRequests.set(requestKey, scheduledRequest as Promise<unknown>);

  try {
    return await scheduledRequest;
  } finally {
    inFlightAeroDataBoxRequests.delete(requestKey);
  }
}

function isRateLimited(): boolean {
  return Date.now() < providerCooldownUntil;
}

function createAeroDataBoxReport(
  status: FlightSourceDetail['status'],
  reason: string,
  usedInResult: boolean,
  raw: Record<string, unknown> | null = null,
): FlightSourceDetail {
  return {
    source: 'aerodatabox',
    status,
    usedInResult,
    reason,
    raw,
  };
}

function summarizeAeroDataBoxMatch(match: AeroDataBoxFlightEnrichment): Record<string, unknown> {
  return {
    callsign: match.callsign,
    flightNumber: match.flightNumber,
    route: match.route,
    airline: match.airline,
    aircraft: match.aircraft,
    current: match.current,
    velocity: match.velocity,
    heading: match.heading,
    geoAltitude: match.geoAltitude,
    onGround: match.onGround,
  };
}

export function hasAeroDataBoxCredentials(): boolean {
  return Boolean(getApiKey());
}

export function isAeroDataBoxConfigured(): boolean {
  return hasAeroDataBoxCredentials() && isProviderEnabled('aerodatabox');
}

function buildSyntheticIcao24(identifier: string): string {
  const normalizedIdentifier = normalizeIdentifier(identifier).toLowerCase();
  return normalizedIdentifier.startsWith('adb-') ? normalizedIdentifier : `adb-${normalizedIdentifier}`;
}

function projectPoint(params: {
  latitude: number | null;
  longitude: number | null;
  time: number | null;
  altitude: number | null;
  heading: number | null;
  onGround: boolean;
}) {
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

function buildSearchVariant(identifier: string, referenceTimeMs?: number | null): SearchVariant | null {
  const normalizedIdentifier = normalizeIdentifier(identifier);
  if (!normalizedIdentifier) {
    return null;
  }

  const searchBy: SearchVariant['searchBy'] = /^[0-9A-F]{6}$/.test(normalizedIdentifier)
    ? 'Icao24'
    : /-|\d[A-Z]{2,}$/.test(normalizedIdentifier)
      ? 'Reg'
      : /^[A-Z]{3}\d[A-Z\d]*$/.test(normalizedIdentifier)
        ? 'CallSign'
        : 'Number';

  const encodedIdentifier = encodeURIComponent(normalizedIdentifier);
  const dateLocal = referenceTimeMs != null && Number.isFinite(referenceTimeMs)
    ? new Date(referenceTimeMs).toISOString().slice(0, 10)
    : null;
  const pathname = dateLocal
    ? `/flights/${searchBy}/${encodedIdentifier}/${dateLocal}`
    : `/flights/${searchBy}/${encodedIdentifier}`;

  return {
    cacheKey: `${searchBy.toLowerCase()}:${normalizedIdentifier}:${dateLocal ?? 'nearest'}`,
    searchBy,
    pathname,
    params: {
      dateLocalRole: 'Both',
      withAircraftImage: 'false',
      withLocation: 'false',
    },
  };
}

async function fetchAeroDataBox(
  pathname: string,
  searchParams?: Record<string, string | number | undefined>,
): Promise<AeroDataBoxFlightRecord[]> {
  const apiKey = getApiKey();
  if (!apiKey || isRateLimited()) {
    return [];
  }

  const url = new URL(`${AERODATABOX_API_BASE}${pathname}`);
  for (const [key, value] of Object.entries(searchParams ?? {})) {
    if (value === undefined || value === '') continue;
    url.searchParams.set(key, String(value));
  }

  return enqueueAeroDataBoxRequest(url.toString(), async () => {
    const startedAt = Date.now();
    const requestDetails = {
      method: 'GET',
      url: url.toString(),
      pathname,
      params: searchParams ?? null,
    };
    let payload: AeroDataBoxErrorPayload | AeroDataBoxFlightRecord[] | null = null;
    let responseStatus: number | null = null;
    let responseStatusText: string | null = null;

    try {
      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'X-RapidAPI-Key': apiKey,
          'X-RapidAPI-Host': 'aerodatabox.p.rapidapi.com',
        },
        cache: 'no-store',
      });

      responseStatus = response.status;
      responseStatusText = response.statusText;

      if (response.status === 204 || response.status === 404) {
        await recordProviderRequestLog({
          provider: 'aerodatabox',
          operation: 'lookup-flight',
          status: 'no-data',
          durationMs: Date.now() - startedAt,
          request: requestDetails,
          response: {
            status: response.status,
            statusText: response.statusText,
          },
        });
        return [];
      }

      payload = await response.json().catch(() => ({})) as AeroDataBoxErrorPayload | AeroDataBoxFlightRecord[];
      if (!response.ok) {
        const errorPayload = Array.isArray(payload) ? {} : payload;
        const message = errorPayload.message ?? errorPayload.error ?? `AeroDataBox request failed with status ${response.status}`;

        if (response.status === 402 || response.status === 429 || /(rate|quota|credit|limit)/i.test(message)) {
          providerCooldownUntil = Date.now() + getRateLimitCooldownMs(response, errorPayload);
          await recordProviderRequestLog({
            provider: 'aerodatabox',
            operation: 'lookup-flight',
            status: 'error',
            durationMs: Date.now() - startedAt,
            request: requestDetails,
            response: {
              status: response.status,
              statusText: response.statusText,
              payload,
            },
            metadata: { rateLimited: true },
          });
          return [];
        }

        throw new Error(message);
      }

      const records = Array.isArray(payload) ? payload : [];
      await recordProviderRequestLog({
        provider: 'aerodatabox',
        operation: 'lookup-flight',
        status: records.length > 0 ? 'success' : 'no-data',
        durationMs: Date.now() - startedAt,
        request: requestDetails,
        response: {
          status: response.status,
          statusText: response.statusText,
          returnedRecords: records.length,
          payload,
        },
      });

      return records;
    } catch (error) {
      await recordProviderRequestLog({
        provider: 'aerodatabox',
        operation: 'lookup-flight',
        status: 'error',
        durationMs: Date.now() - startedAt,
        request: requestDetails,
        response: {
          status: responseStatus,
          statusText: responseStatusText,
          payload,
        },
        error,
      });
      throw error;
    }
  });
}

function getMovementAirportCode(airport: AeroDataBoxAirportRecord | null | undefined): string | null {
  return toNullableString(airport?.iata)?.toUpperCase()
    ?? toNullableString(airport?.icao)?.toUpperCase()
    ?? null;
}

function getMovementAirportName(airport: AeroDataBoxAirportRecord | null | undefined): string | null {
  return toNullableString(airport?.shortName)
    ?? toNullableString(airport?.name)
    ?? toNullableString(airport?.municipalityName)
    ?? null;
}

function getMovementTimestamp(movement: AeroDataBoxMovementRecord | null | undefined): number | null {
  return toTimestampSeconds(movement?.runwayTime?.utc)
    ?? toTimestampSeconds(movement?.revisedTime?.utc)
    ?? toTimestampSeconds(movement?.predictedTime?.utc)
    ?? toTimestampSeconds(movement?.scheduledTime?.utc);
}

function getRecordMatchScore(record: AeroDataBoxFlightRecord, identifier: string): number {
  const normalizedIdentifier = normalizeIdentifier(identifier);
  const number = normalizeIdentifier(record.number);
  const callSign = normalizeIdentifier(record.callSign);
  const airlineIata = normalizeIdentifier(record.airline?.iata);
  const airlineIcao = normalizeIdentifier(record.airline?.icao);
  const numericPart = number.replace(/^[A-Z]+/, '');
  const combinedIata = airlineIata && numericPart ? `${airlineIata}${numericPart}` : '';
  const combinedIcao = airlineIcao && numericPart ? `${airlineIcao}${numericPart}` : '';
  const modeS = normalizeIdentifier(record.aircraft?.modeS);
  const registration = normalizeIdentifier(record.aircraft?.reg);

  if (normalizedIdentifier === number) return 125;
  if (normalizedIdentifier === callSign) return 120;
  if (normalizedIdentifier === combinedIata) return 114;
  if (normalizedIdentifier === combinedIcao) return 110;
  if (normalizedIdentifier === modeS) return 108;
  if (normalizedIdentifier === registration) return 95;
  return 0;
}

function getRecordTemporalScore(record: AeroDataBoxFlightRecord, referenceTimeMs?: number | null): number {
  if (referenceTimeMs == null || !Number.isFinite(referenceTimeMs)) {
    return 0;
  }

  const referenceSeconds = Math.floor(referenceTimeMs / 1000);
  const departureTimestamp = getMovementTimestamp(record.departure);
  const arrivalTimestamp = getMovementTimestamp(record.arrival);
  const nearestDeltaSeconds = [departureTimestamp, arrivalTimestamp]
    .filter((timestamp): timestamp is number => timestamp != null)
    .map((timestamp) => Math.abs(timestamp - referenceSeconds))
    .sort((left, right) => left - right)[0] ?? null;

  if (nearestDeltaSeconds == null) {
    return 0;
  }

  if (nearestDeltaSeconds <= 60 * 60) return 45;
  if (nearestDeltaSeconds <= 6 * 60 * 60) return 30;
  if (nearestDeltaSeconds <= 24 * 60 * 60) return 15;
  if (nearestDeltaSeconds <= 3 * 24 * 60 * 60) return 6;
  return -10;
}

function toEnrichment(record: AeroDataBoxFlightRecord, identifier: string): AeroDataBoxFlightEnrichment {
  const normalizedIdentifier = normalizeIdentifier(identifier);
  const flightNumber = toNullableString(record.number);
  const callsign = normalizeIdentifier(record.callSign)
    || normalizeIdentifier(record.number)
    || normalizedIdentifier;
  const heading = toNullableNumber(record.location?.trueTrack?.deg);
  const altitude = toNullableNumber(record.location?.altitude?.meter);
  const routeFirstSeen = getMovementTimestamp(record.departure);
  const routeLastSeen = getMovementTimestamp(record.arrival);
  const status = normalizeIdentifier(record.status);
  const onGround = /(ARRIVED|CANCELED|CANCELLED|DIVERTED)/.test(status)
    || (altitude != null ? altitude <= 30 : false);

  const livePoint = projectPoint({
    latitude: toNullableNumber(record.location?.lat),
    longitude: toNullableNumber(record.location?.lon),
    time: toTimestampSeconds(record.location?.reportedAtUtc),
    altitude,
    heading,
    onGround,
  });

  return {
    provider: 'aerodatabox',
    identifier: toNullableString(record.aircraft?.modeS)?.toUpperCase() || buildSyntheticIcao24(callsign),
    callsign,
    flightNumber,
    route: {
      departureAirport: getMovementAirportCode(record.departure?.airport),
      arrivalAirport: getMovementAirportCode(record.arrival?.airport),
      departureAirportName: getMovementAirportName(record.departure?.airport),
      arrivalAirportName: getMovementAirportName(record.arrival?.airport),
      firstSeen: routeFirstSeen,
      lastSeen: routeLastSeen,
    },
    airline: {
      name: toNullableString(record.airline?.name),
      iata: toNullableString(record.airline?.iata)?.toUpperCase() ?? null,
      icao: toNullableString(record.airline?.icao)?.toUpperCase() ?? null,
    },
    aircraft: {
      registration: toNullableString(record.aircraft?.reg),
      iata: null,
      icao: null,
      icao24: toNullableString(record.aircraft?.modeS)?.toUpperCase() ?? null,
      model: toNullableString(record.aircraft?.model),
    },
    current: livePoint,
    velocity: toNullableNumber(record.location?.groundSpeed?.meterPerSecond)
      ?? (() => {
        const speedKnots = toNullableNumber(record.location?.groundSpeed?.kt);
        return speedKnots == null ? null : speedKnots * 0.514444;
      })(),
    heading,
    geoAltitude: altitude,
    onGround,
  };
}

async function writeToCache(identifier: string, payload: AeroDataBoxFlightEnrichment | null): Promise<void> {
  if (isProviderHistoryConfigured()) {
    await writeProviderHistory('aerodatabox', identifier, payload);
    return;
  }

  inMemoryFallbackCache.set(identifier, {
    payload,
    expiresAt: Date.now() + getCacheTtlMs(),
  });
}

export async function lookupAeroDataBoxFlightWithReport(
  identifier: string,
  options?: { referenceTimeMs?: number | null },
): Promise<AeroDataBoxLookupResult> {
  const normalizedIdentifier = normalizeIdentifier(identifier);
  if (!normalizedIdentifier) {
    return {
      match: null,
      report: createAeroDataBoxReport('skipped', 'AeroDataBox lookup skipped because no flight identifier was provided.', false),
    };
  }

  const dbDisabledReason = await getProviderDisabledReasonAsync('aerodatabox');
  if (dbDisabledReason) {
    return {
      match: null,
      report: createAeroDataBoxReport(
        'skipped',
        dbDisabledReason,
        false,
        { identifier: normalizedIdentifier, disabledByFlag: true },
      ),
    };
  }

  if (!isAeroDataBoxConfigured()) {
    return {
      match: null,
      report: createAeroDataBoxReport(
        'skipped',
        'AeroDataBox lookup skipped because `AERODATABOX_RAPIDAPI_KEY` (or `RAPIDAPI_AERODATABOX_API_KEY`) is not configured.',
        false,
        { identifier: normalizedIdentifier, disabledByFlag: false },
      ),
    };
  }

  if (isRateLimited()) {
    return {
      match: null,
      report: createAeroDataBoxReport(
        'no-data',
        'AeroDataBox is temporarily cooling down after a rate-limit or quota response.',
        false,
        { identifier: normalizedIdentifier, cooldownUntil: providerCooldownUntil },
      ),
    };
  }

  const memEntry = inMemoryFallbackCache.get(normalizedIdentifier);
  if (memEntry && Date.now() < memEntry.expiresAt) {
    const cachedPayload = memEntry.payload;
    return {
      match: cachedPayload,
      report: cachedPayload
        ? createAeroDataBoxReport(
            'used',
            'AeroDataBox returned a cached match and its schedule was reused for this validation.',
            true,
            { identifier: normalizedIdentifier, cached: true, match: summarizeAeroDataBoxMatch(cachedPayload) },
          )
        : createAeroDataBoxReport(
            'no-data',
            'AeroDataBox was queried recently but no matching flight was returned.',
            false,
            { identifier: normalizedIdentifier, cached: true },
          ),
    };
  }

  if (isProviderHistoryConfigured()) {
    const ttlMs = getCacheTtlMs();
    const mongoPayload = await readLatestProviderHistory<AeroDataBoxFlightEnrichment>('aerodatabox', normalizedIdentifier, ttlMs);
    if (mongoPayload !== null) {
      return {
        match: mongoPayload,
        report: mongoPayload
          ? createAeroDataBoxReport(
              'used',
              'AeroDataBox returned a cached match and its schedule was reused for this validation.',
              true,
              { identifier: normalizedIdentifier, cached: true, match: summarizeAeroDataBoxMatch(mongoPayload) },
            )
          : createAeroDataBoxReport(
              'no-data',
              'AeroDataBox was queried recently but no matching flight was returned.',
              false,
              { identifier: normalizedIdentifier, cached: true },
            ),
      };
    }
  }

  const variant = buildSearchVariant(normalizedIdentifier, options?.referenceTimeMs);
  if (!variant) {
    return {
      match: null,
      report: createAeroDataBoxReport('skipped', 'AeroDataBox lookup skipped because the request could not be normalized.', false),
    };
  }

  const attempts: Array<Record<string, unknown>> = [];

  try {
    const records = await fetchAeroDataBox(variant.pathname, variant.params);
    attempts.push({
      variant: variant.cacheKey,
      searchBy: variant.searchBy,
      pathname: variant.pathname,
      returnedRecords: records.length,
    });

    let bestMatch: AeroDataBoxFlightEnrichment | null = null;
    let bestScore = 0;

    for (const record of records) {
      const score = getRecordMatchScore(record, normalizedIdentifier) + getRecordTemporalScore(record, options?.referenceTimeMs);
      if (score <= bestScore) {
        continue;
      }

      bestScore = score;
      bestMatch = toEnrichment(record, normalizedIdentifier);
    }

    await writeToCache(normalizedIdentifier, bestMatch);

    if (bestMatch) {
      return {
        match: bestMatch,
        report: createAeroDataBoxReport(
          'used',
          'AeroDataBox returned a matching scheduled or live flight for this identifier.',
          true,
          {
            identifier: normalizedIdentifier,
            attempts,
            match: summarizeAeroDataBoxMatch(bestMatch),
          },
        ),
      };
    }

    return {
      match: null,
      report: createAeroDataBoxReport(
        'no-data',
        'AeroDataBox did not return a usable match for this identifier.',
        false,
        { identifier: normalizedIdentifier, attempts },
      ),
    };
  } catch (error) {
    return {
      match: null,
      report: createAeroDataBoxReport(
        'error',
        error instanceof Error ? error.message : 'AeroDataBox lookup failed unexpectedly.',
        false,
        { identifier: normalizedIdentifier, attempts },
      ),
    };
  }
}
