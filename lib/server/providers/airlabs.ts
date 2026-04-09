import { geoNaturalEarth1 } from 'd3-geo';
import type { FlightSourceDetail } from '~/components/tracker/flight/types';
import { getProviderDisabledReasonAsync, isProviderEnabled } from './index';
import { isProviderHistoryConfigured, readLatestProviderHistory, writeProviderHistory } from './history';
import { recordProviderRequestLog } from './observability';

export type AirlabsFlightEnrichment = {
  provider: 'airlabs';
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

type AirlabsFlightRecord = {
  hex?: string | null;
  reg_number?: string | null;
  aircraft_icao?: string | null;
  airline_iata?: string | null;
  airline_icao?: string | null;
  airline_name?: string | null;
  flight_number?: string | number | null;
  flight_icao?: string | null;
  flight_iata?: string | null;
  dep_iata?: string | null;
  dep_icao?: string | null;
  dep_name?: string | null;
  dep_city?: string | null;
  dep_time?: string | null;
  dep_time_ts?: number | string | null;
  dep_time_utc?: string | null;
  dep_estimated?: string | null;
  dep_estimated_ts?: number | string | null;
  dep_estimated_utc?: string | null;
  arr_iata?: string | null;
  arr_icao?: string | null;
  arr_name?: string | null;
  arr_city?: string | null;
  arr_time?: string | null;
  arr_time_ts?: number | string | null;
  arr_time_utc?: string | null;
  arr_estimated?: string | null;
  arr_estimated_ts?: number | string | null;
  arr_estimated_utc?: string | null;
  lat?: number | string | null;
  lng?: number | string | null;
  alt?: number | string | null;
  dir?: number | string | null;
  speed?: number | string | null;
  v_speed?: number | string | null;
  updated?: number | string | null;
  status?: string | null;
  model?: string | null;
};

type AirlabsErrorPayload = {
  message?: string;
  error?:
    | string
    | {
        message?: string;
        code?: string | number;
      }
    | null;
};

type AirlabsResponsePayload = AirlabsErrorPayload & {
  request?: unknown;
  response?: AirlabsFlightRecord | AirlabsFlightRecord[] | null;
};

type SearchVariant = {
  cacheKey: string;
  pathname: '/flight' | '/flights' | '/schedules';
  params: Record<string, string>;
};

export type AirlabsLookupResult = {
  match: AirlabsFlightEnrichment | null;
  report: FlightSourceDetail;
};

const AIRLABS_API_BASE = 'https://airlabs.co/api/v9';
const TRACKER_MAP_VIEWBOX = { width: 1000, height: 560 };
const PROVIDER_COOLDOWN_MS = 15 * 60 * 1000;
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const AIRLABS_REFERENCE_MATCH_WINDOW_SECONDS = 48 * 60 * 60;

const projection = geoNaturalEarth1();
projection.fitSize([TRACKER_MAP_VIEWBOX.width, TRACKER_MAP_VIEWBOX.height], { type: 'Sphere' } as never);

let providerCooldownUntil = 0;
const inMemoryFallbackCache = new Map<string, { payload: AirlabsFlightEnrichment | null; expiresAt: number }>();

function normalizeIdentifier(value: string | number | null | undefined): string {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value).replace(/\s+/g, '').trim().toUpperCase()
    : '';
}

function toNullableString(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

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

function toTimestampSeconds(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.floor(value);
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
      const numeric = Number.parseFloat(trimmed);
      return Number.isFinite(numeric) ? Math.floor(numeric) : null;
    }

    const timestamp = Date.parse(trimmed);
    return Number.isFinite(timestamp) ? Math.floor(timestamp / 1000) : null;
  }

  return null;
}

function getCacheTtlMs(): number {
  const configuredValue = process.env.AIRLABS_CACHE_TTL_SECONDS?.trim();
  const parsedValue = configuredValue ? Number.parseInt(configuredValue, 10) : NaN;
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue * 1000 : DEFAULT_CACHE_TTL_MS;
}

function hasReferenceTimeMs(referenceTimeMs?: number | null): referenceTimeMs is number {
  return typeof referenceTimeMs === 'number' && Number.isFinite(referenceTimeMs);
}

function buildLookupCacheKey(identifier: string, referenceTimeMs?: number | null): string {
  const normalizedIdentifier = normalizeIdentifier(identifier);
  if (!hasReferenceTimeMs(referenceTimeMs)) {
    return normalizedIdentifier;
  }

  return `${normalizedIdentifier}@${new Date(referenceTimeMs).toISOString().slice(0, 10)}`;
}

function getNearestReferenceDeltaSeconds(
  timestamps: Array<number | null | undefined>,
  referenceTimeMs?: number | null,
): number | null {
  if (!hasReferenceTimeMs(referenceTimeMs)) {
    return null;
  }

  const referenceSeconds = Math.floor(referenceTimeMs / 1000);
  const deltas = timestamps
    .filter((timestamp): timestamp is number => typeof timestamp === 'number' && Number.isFinite(timestamp))
    .map((timestamp) => Math.abs(timestamp - referenceSeconds));

  return deltas.length > 0 ? Math.min(...deltas) : null;
}

function getApiKey(): string {
  return process.env.AIRLABS_API_KEY?.trim()
    || process.env.AIRLABS_KEY?.trim()
    || process.env.AIRLABS_ACCESS_KEY?.trim()
    || '';
}

function isRateLimited(): boolean {
  return Date.now() < providerCooldownUntil;
}

function createAirlabsReport(
  status: FlightSourceDetail['status'],
  reason: string,
  usedInResult: boolean,
  raw: Record<string, unknown> | null = null,
): FlightSourceDetail {
  return {
    source: 'airlabs',
    status,
    usedInResult,
    reason,
    raw,
  };
}

function summarizeAirlabsMatch(match: AirlabsFlightEnrichment): Record<string, unknown> {
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

export function hasAirlabsCredentials(): boolean {
  return Boolean(getApiKey());
}

export function isAirlabsConfigured(): boolean {
  return hasAirlabsCredentials() && isProviderEnabled('airlabs');
}

function buildSyntheticIcao24(identifier: string): string {
  const normalizedIdentifier = normalizeIdentifier(identifier).toLowerCase();
  return normalizedIdentifier.startsWith('al-') ? normalizedIdentifier : `al-${normalizedIdentifier}`;
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

function buildSearchVariants(identifier: string, referenceTimeMs?: number | null): SearchVariant[] {
  const normalizedIdentifier = normalizeIdentifier(identifier);
  if (!normalizedIdentifier) {
    return [];
  }

  const variants: SearchVariant[] = [];
  const seenKeys = new Set<string>();
  const preferSchedules = hasReferenceTimeMs(referenceTimeMs);
  const pushVariant = (cacheKey: string, pathname: SearchVariant['pathname'], params: Record<string, string>) => {
    if (seenKeys.has(cacheKey)) {
      return;
    }

    seenKeys.add(cacheKey);
    variants.push({ cacheKey, pathname, params });
  };

  if (preferSchedules && /^[A-Z]{2}\d[A-Z\d]*$/.test(normalizedIdentifier)) {
    pushVariant(`schedule-flight-iata:${normalizedIdentifier}`, '/schedules', { flight_iata: normalizedIdentifier });
  }

  if (preferSchedules && /^[A-Z]{3}\d[A-Z\d]*$/.test(normalizedIdentifier)) {
    pushVariant(`schedule-flight-icao:${normalizedIdentifier}`, '/schedules', { flight_icao: normalizedIdentifier });
  }

  if (/^[A-Z]{2}\d[A-Z\d]*$/.test(normalizedIdentifier)) {
    pushVariant(`flight-iata:${normalizedIdentifier}`, '/flight', { flight_iata: normalizedIdentifier });
  }

  if (/^[A-Z]{3}\d[A-Z\d]*$/.test(normalizedIdentifier)) {
    pushVariant(`flight-icao:${normalizedIdentifier}`, '/flight', { flight_icao: normalizedIdentifier });
  }

  if (/^[0-9A-F]{6}$/.test(normalizedIdentifier)) {
    pushVariant(`hex:${normalizedIdentifier}`, '/flights', { hex: normalizedIdentifier.toLowerCase() });
  }

  if (/^[A-Z0-9-]{4,}$/.test(normalizedIdentifier)) {
    pushVariant(`registration:${normalizedIdentifier}`, '/flights', { reg_number: normalizedIdentifier });
  }

  const numericPart = normalizedIdentifier.replace(/^[A-Z]+/, '');
  if (numericPart) {
    pushVariant(`flight-number:${numericPart}`, '/flights', { flight_number: numericPart });
  }

  if (variants.length === 0) {
    pushVariant(`fallback:${normalizedIdentifier}`, preferSchedules ? '/schedules' : '/flight', { flight_iata: normalizedIdentifier });
  }

  return variants;
}

function extractAirlabsRecords(payload: AirlabsResponsePayload | null): AirlabsFlightRecord[] {
  const response = payload?.response;
  if (Array.isArray(response)) {
    return response;
  }

  if (response && typeof response === 'object') {
    return [response as AirlabsFlightRecord];
  }

  return [];
}

function getErrorMessage(payload: AirlabsResponsePayload | null, responseStatus: number): string | null {
  const payloadError = payload?.error;
  if (typeof payloadError === 'string' && payloadError.trim()) {
    return payloadError.trim();
  }

  if (payloadError && typeof payloadError === 'object' && typeof payloadError.message === 'string' && payloadError.message.trim()) {
    return payloadError.message.trim();
  }

  if (typeof payload?.message === 'string' && payload.message.trim()) {
    return payload.message.trim();
  }

  return responseStatus >= 400 ? `AirLabs request failed with status ${responseStatus}` : null;
}

async function fetchAirlabs(pathname: SearchVariant['pathname'], params: Record<string, string>): Promise<AirlabsFlightRecord[]> {
  const apiKey = getApiKey();
  if (!apiKey || isRateLimited()) {
    return [];
  }

  const url = new URL(`${AIRLABS_API_BASE}${pathname}`);
  url.searchParams.set('api_key', apiKey);

  for (const [key, value] of Object.entries(params)) {
    if (!value) continue;
    url.searchParams.set(key, value);
  }

  const startedAt = Date.now();
  const requestDetails = {
    method: 'GET',
    url: url.toString(),
    pathname,
    params,
  };
  let payload: AirlabsResponsePayload | null = null;
  let responseStatus: number | null = null;
  let responseStatusText: string | null = null;

  try {
    const response = await fetch(url, {
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
      },
    });

    responseStatus = response.status;
    responseStatusText = response.statusText;
    payload = await response.json().catch(() => ({}) as AirlabsResponsePayload) as AirlabsResponsePayload;
    const errorMessage = getErrorMessage(payload, response.status);

    if (!response.ok || errorMessage) {
      if (response.status === 402 || response.status === 429 || /(rate|quota|limit|credit)/i.test(errorMessage ?? '')) {
        providerCooldownUntil = Date.now() + PROVIDER_COOLDOWN_MS;
        await recordProviderRequestLog({
          provider: 'airlabs',
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

      throw new Error(errorMessage ?? `AirLabs request failed with status ${response.status}`);
    }

    const records = extractAirlabsRecords(payload);
    await recordProviderRequestLog({
      provider: 'airlabs',
      operation: 'lookup-flight',
      status: records.length > 0 ? 'success' : 'no-data',
      durationMs: Date.now() - startedAt,
      request: requestDetails,
      response: {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        returnedRecords: records.length,
        payload,
      },
    });

    return records;
  } catch (error) {
    await recordProviderRequestLog({
      provider: 'airlabs',
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
}

function getRecordMatchScore(record: AirlabsFlightRecord, identifier: string): number {
  const normalizedIdentifier = normalizeIdentifier(identifier);
  const flightIata = normalizeIdentifier(record.flight_iata);
  const flightIcao = normalizeIdentifier(record.flight_icao);
  const flightNumber = normalizeIdentifier(record.flight_number);
  const airlineIata = normalizeIdentifier(record.airline_iata);
  const airlineIcao = normalizeIdentifier(record.airline_icao);
  const registration = normalizeIdentifier(record.reg_number);
  const hex = normalizeIdentifier(record.hex);
  const combinedIata = airlineIata && flightNumber ? `${airlineIata}${flightNumber}` : '';
  const combinedIcao = airlineIcao && flightNumber ? `${airlineIcao}${flightNumber}` : '';

  if (normalizedIdentifier === flightIata) return 125;
  if (normalizedIdentifier === flightIcao) return 120;
  if (normalizedIdentifier === combinedIata) return 116;
  if (normalizedIdentifier === combinedIcao) return 112;
  if (normalizedIdentifier === flightNumber) return 92;
  if (normalizedIdentifier === registration) return 88;
  if (normalizedIdentifier === hex) return 120;
  return 0;
}

function getRecordTemporalScore(record: AirlabsFlightRecord, referenceTimeMs?: number | null): number {
  const explicitReferenceTime = hasReferenceTimeMs(referenceTimeMs);
  const referenceSeconds = Math.floor((explicitReferenceTime ? referenceTimeMs : Date.now()) / 1000);
  const scheduledDeparture = toTimestampSeconds(record.dep_estimated_ts) ?? toTimestampSeconds(record.dep_time_ts);
  const scheduledArrival = toTimestampSeconds(record.arr_estimated_ts) ?? toTimestampSeconds(record.arr_time_ts);
  const updated = toTimestampSeconds(record.updated);
  const status = normalizeIdentifier(record.status);
  let score = 0;

  const deltas = [updated, scheduledDeparture, scheduledArrival]
    .filter((timestamp): timestamp is number => timestamp != null)
    .map((timestamp) => Math.abs(timestamp - referenceSeconds));
  const nearestDelta = deltas.length > 0 ? Math.min(...deltas) : null;

  if (nearestDelta != null) {
    if (nearestDelta <= 30 * 60) {
      score += explicitReferenceTime ? 30 : 18;
    } else if (nearestDelta <= 2 * 60 * 60) {
      score += explicitReferenceTime ? 22 : 14;
    } else if (nearestDelta <= 12 * 60 * 60) {
      score += explicitReferenceTime ? 12 : 8;
    } else if (explicitReferenceTime && nearestDelta <= AIRLABS_REFERENCE_MATCH_WINDOW_SECONDS) {
      score -= 12;
    } else if (explicitReferenceTime && nearestDelta > AIRLABS_REFERENCE_MATCH_WINDOW_SECONDS) {
      score -= 80;
    }
  }

  if (/(EN-ROUTE|ENROUTE|AIRBORNE|ACTIVE|DEPARTED)/.test(status)) {
    score += 8;
  }

  if (/(SCHEDULED|LANDED|ARRIVED)/.test(status)) {
    score += 4;
  }

  return score;
}

function isRecordWithinReferenceWindow(record: AirlabsFlightRecord, referenceTimeMs?: number | null): boolean {
  const deltaSeconds = getNearestReferenceDeltaSeconds([
    toTimestampSeconds(record.updated),
    toTimestampSeconds(record.dep_estimated_ts) ?? toTimestampSeconds(record.dep_time_ts),
    toTimestampSeconds(record.arr_estimated_ts) ?? toTimestampSeconds(record.arr_time_ts),
  ], referenceTimeMs);

  return deltaSeconds == null || deltaSeconds <= AIRLABS_REFERENCE_MATCH_WINDOW_SECONDS;
}

function isMatchWithinReferenceWindow(match: AirlabsFlightEnrichment, referenceTimeMs?: number | null): boolean {
  const deltaSeconds = getNearestReferenceDeltaSeconds([
    match.current?.time,
    match.route.firstSeen,
    match.route.lastSeen,
  ], referenceTimeMs);

  return deltaSeconds == null || deltaSeconds <= AIRLABS_REFERENCE_MATCH_WINDOW_SECONDS;
}

function toEnrichment(record: AirlabsFlightRecord, identifier: string): AirlabsFlightEnrichment {
  const normalizedIdentifier = normalizeIdentifier(identifier);
  const airlineIata = toNullableString(record.airline_iata)?.toUpperCase() ?? null;
  const airlineIcao = toNullableString(record.airline_icao)?.toUpperCase() ?? null;
  const flightNumber = toNullableString(record.flight_number);
  const callsign = normalizeIdentifier(record.flight_icao)
    || normalizeIdentifier(record.flight_iata)
    || (airlineIata && flightNumber ? `${airlineIata}${flightNumber}` : '')
    || (airlineIcao && flightNumber ? `${airlineIcao}${flightNumber}` : '')
    || normalizedIdentifier;

  const firstSeen = toTimestampSeconds(record.dep_estimated_ts)
    ?? toTimestampSeconds(record.dep_time_ts)
    ?? toTimestampSeconds(record.dep_estimated_utc)
    ?? toTimestampSeconds(record.dep_time_utc)
    ?? toTimestampSeconds(record.dep_estimated)
    ?? toTimestampSeconds(record.dep_time);
  const lastSeen = toTimestampSeconds(record.arr_estimated_ts)
    ?? toTimestampSeconds(record.arr_time_ts)
    ?? toTimestampSeconds(record.arr_estimated_utc)
    ?? toTimestampSeconds(record.arr_time_utc)
    ?? toTimestampSeconds(record.arr_estimated)
    ?? toTimestampSeconds(record.arr_time);

  const heading = toNullableNumber(record.dir);
  const altitude = toNullableNumber(record.alt);
  const normalizedStatus = normalizeIdentifier(record.status);
  const onGround = /(LANDED|SCHEDULED|CANCELLED)/.test(normalizedStatus)
    || (altitude != null ? altitude <= 30 : false);
  const livePoint = projectPoint({
    latitude: toNullableNumber(record.lat),
    longitude: toNullableNumber(record.lng),
    time: toTimestampSeconds(record.updated),
    altitude,
    heading,
    onGround,
  });

  return {
    provider: 'airlabs',
    identifier: toNullableString(record.hex)?.toLowerCase() || buildSyntheticIcao24(callsign),
    callsign,
    flightNumber,
    route: {
      departureAirport: toNullableString(record.dep_iata)?.toUpperCase()
        ?? toNullableString(record.dep_icao)?.toUpperCase()
        ?? null,
      arrivalAirport: toNullableString(record.arr_iata)?.toUpperCase()
        ?? toNullableString(record.arr_icao)?.toUpperCase()
        ?? null,
      departureAirportName: toNullableString(record.dep_name) ?? toNullableString(record.dep_city),
      arrivalAirportName: toNullableString(record.arr_name) ?? toNullableString(record.arr_city),
      firstSeen,
      lastSeen,
    },
    airline: {
      name: toNullableString(record.airline_name),
      iata: airlineIata,
      icao: airlineIcao,
    },
    aircraft: {
      registration: toNullableString(record.reg_number),
      iata: toNullableString(record.aircraft_icao)?.toUpperCase() ?? null,
      icao: toNullableString(record.aircraft_icao)?.toUpperCase() ?? null,
      icao24: toNullableString(record.hex)?.toUpperCase() ?? null,
      model: toNullableString(record.model)
        ?? toNullableString(record.aircraft_icao)?.toUpperCase()
        ?? null,
    },
    current: livePoint,
    velocity: (() => {
      const speedKmH = toNullableNumber(record.speed);
      return speedKmH == null ? null : speedKmH / 3.6;
    })(),
    heading,
    geoAltitude: altitude,
    onGround,
  };
}

async function writeToCache(cacheKey: string, payload: AirlabsFlightEnrichment | null): Promise<void> {
  if (isProviderHistoryConfigured()) {
    await writeProviderHistory('airlabs', cacheKey, payload);
    return;
  }

  inMemoryFallbackCache.set(cacheKey, {
    payload,
    expiresAt: Date.now() + getCacheTtlMs(),
  });
}

async function recordAirlabsCacheLog(
  identifier: string,
  cacheKey: string,
  payload: AirlabsFlightEnrichment | null,
  layer: 'memory' | 'mongo',
): Promise<void> {
  await recordProviderRequestLog({
    provider: 'airlabs',
    operation: 'lookup-flight',
    status: 'cached',
    durationMs: 0,
    request: { identifier, cacheKey },
    response: payload
      ? { matched: true, match: summarizeAirlabsMatch(payload) }
      : { matched: false },
    cache: { status: 'hit', layer, key: cacheKey },
  });
}

export async function lookupAirlabsFlightWithReport(
  identifier: string,
  options?: { referenceTimeMs?: number | null },
): Promise<AirlabsLookupResult> {
  const normalizedIdentifier = normalizeIdentifier(identifier);
  if (!normalizedIdentifier) {
    return {
      match: null,
      report: createAirlabsReport('skipped', 'AirLabs lookup skipped because no flight identifier was provided.', false),
    };
  }

  const disabledReason = await getProviderDisabledReasonAsync('airlabs');
  if (disabledReason) {
    return {
      match: null,
      report: createAirlabsReport(
        'skipped',
        disabledReason,
        false,
        { identifier: normalizedIdentifier, disabledByFlag: true },
      ),
    };
  }

  if (!hasAirlabsCredentials()) {
    return {
      match: null,
      report: createAirlabsReport(
        'skipped',
        'AirLabs lookup skipped because `AIRLABS_API_KEY` is not configured.',
        false,
        { identifier: normalizedIdentifier, disabledByFlag: false },
      ),
    };
  }

  const cacheKey = buildLookupCacheKey(normalizedIdentifier, options?.referenceTimeMs);

  const memEntry = inMemoryFallbackCache.get(cacheKey);
  if (memEntry && Date.now() < memEntry.expiresAt) {
    const cachedPayload = memEntry.payload;
    if (cachedPayload == null || isMatchWithinReferenceWindow(cachedPayload, options?.referenceTimeMs)) {
      await recordAirlabsCacheLog(normalizedIdentifier, cacheKey, cachedPayload, 'memory');
      return {
        match: cachedPayload,
        report: cachedPayload
          ? createAirlabsReport(
              'used',
              'AirLabs returned a cached match and its data was merged into this snapshot.',
              true,
              { identifier: normalizedIdentifier, cacheKey, cached: true, match: summarizeAirlabsMatch(cachedPayload) },
            )
          : createAirlabsReport(
              'no-data',
              'AirLabs was queried recently but returned no matching flight.',
              false,
              { identifier: normalizedIdentifier, cacheKey, cached: true },
            ),
      };
    }
  }

  if (isProviderHistoryConfigured()) {
    const ttlMs = getCacheTtlMs();
    const mongoPayload = await readLatestProviderHistory<AirlabsFlightEnrichment>('airlabs', cacheKey, ttlMs);
    if (mongoPayload !== null && isMatchWithinReferenceWindow(mongoPayload, options?.referenceTimeMs)) {
      await recordAirlabsCacheLog(normalizedIdentifier, cacheKey, mongoPayload, 'mongo');
      return {
        match: mongoPayload,
        report: mongoPayload
          ? createAirlabsReport(
              'used',
              'AirLabs returned a cached match and its data was merged into this snapshot.',
              true,
              { identifier: normalizedIdentifier, cacheKey, cached: true, match: summarizeAirlabsMatch(mongoPayload) },
            )
          : createAirlabsReport(
              'no-data',
              'AirLabs was queried recently but returned no matching flight.',
              false,
              { identifier: normalizedIdentifier, cacheKey, cached: true },
            ),
      };
    }
  }

  if (isRateLimited()) {
    return {
      match: null,
      report: createAirlabsReport(
        'no-data',
        'AirLabs is temporarily cooling down after a rate-limit or quota response.',
        false,
        {
          identifier: normalizedIdentifier,
          cooldownUntil: providerCooldownUntil,
          cooldownRemainingMs: Math.max(0, providerCooldownUntil - Date.now()),
        },
      ),
    };
  }

  let bestMatch: AirlabsFlightEnrichment | null = null;
  let bestScore = 0;
  let skippedForReferenceWindow = 0;
  const attempts: Array<Record<string, unknown>> = [];

  try {
    for (const variant of buildSearchVariants(normalizedIdentifier, options?.referenceTimeMs)) {
      const records = await fetchAirlabs(variant.pathname, variant.params);
      attempts.push({
        variant: variant.cacheKey,
        pathname: variant.pathname,
        params: variant.params,
        returnedRecords: records.length,
      });

      for (const record of records) {
        if (!isRecordWithinReferenceWindow(record, options?.referenceTimeMs)) {
          skippedForReferenceWindow += 1;
          continue;
        }

        const score = getRecordMatchScore(record, normalizedIdentifier) + getRecordTemporalScore(record, options?.referenceTimeMs);
        if (score <= bestScore) {
          continue;
        }

        bestScore = score;
        bestMatch = toEnrichment(record, normalizedIdentifier);
      }

      if (bestScore >= 120) {
        break;
      }
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'AirLabs request failed unexpectedly.';
    return {
      match: null,
      report: createAirlabsReport('error', reason, false, {
        identifier: normalizedIdentifier,
        attempts,
      }),
    };
  }

  await writeToCache(cacheKey, bestMatch);

  if (!bestMatch) {
    return {
      match: null,
      report: createAirlabsReport(
        'no-data',
        skippedForReferenceWindow > 0 && hasReferenceTimeMs(options?.referenceTimeMs)
          ? 'AirLabs only returned flights far from the requested schedule, so no date-aligned match was used.'
          : 'AirLabs was queried but returned no matching flight for this identifier.',
        false,
        {
          identifier: normalizedIdentifier,
          cacheKey,
          attempts,
          skippedForReferenceWindow,
        },
      ),
    };
  }

  return {
    match: bestMatch,
    report: createAirlabsReport(
      'used',
      'AirLabs returned a matching flight and its data was merged into this snapshot.',
      true,
      {
        identifier: normalizedIdentifier,
        cacheKey,
        attempts,
        skippedForReferenceWindow,
        match: summarizeAirlabsMatch(bestMatch),
      },
    ),
  };
}

export async function lookupAirlabsFlight(
  identifier: string,
  options?: { referenceTimeMs?: number | null },
): Promise<AirlabsFlightEnrichment | null> {
  const result = await lookupAirlabsFlightWithReport(identifier, options);
  if (result.report.status === 'error') {
    throw new Error(result.report.reason);
  }

  return result.match;
}

export async function lookupAirlabsFlightsWithReport(identifiers: string[]): Promise<Map<string, AirlabsLookupResult>> {
  const results = await Promise.all(
    identifiers.map(async (identifier) => ({
      identifier,
      result: await lookupAirlabsFlightWithReport(identifier),
    })),
  );

  const reports = new Map<string, AirlabsLookupResult>();
  for (const entry of results) {
    reports.set(entry.identifier, entry.result);
  }

  return reports;
}

export async function lookupAirlabsFlights(identifiers: string[]): Promise<Map<string, AirlabsFlightEnrichment>> {
  const results = await lookupAirlabsFlightsWithReport(identifiers);
  const matches = new Map<string, AirlabsFlightEnrichment>();

  for (const [identifier, result] of results.entries()) {
    if (result.match) {
      matches.set(identifier, result.match);
    }
  }

  return matches;
}
