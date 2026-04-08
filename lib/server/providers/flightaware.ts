import { geoNaturalEarth1 } from 'd3-geo';
import type { FlightSourceDetail } from '~/components/tracker/flight/types';
import { getProviderDisabledReason, getProviderDisabledReasonAsync, isProviderEnabled } from './index';
import { isProviderHistoryConfigured, readLatestProviderHistory, writeProviderHistory } from './history';
import { recordProviderRequestLog } from './observability';

export type FlightAwareFlightEnrichment = {
  provider: 'flightaware';
  identifier: string;
  faFlightId: string | null;
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

type FlightAwareAirportRecord = {
  code?: string | null;
  code_icao?: string | null;
  code_iata?: string | null;
  name?: string | null;
  city?: string | null;
};

type FlightAwarePositionRecord = {
  fa_flight_id?: string | null;
  altitude?: number | string | null;
  groundspeed?: number | string | null;
  heading?: number | string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  timestamp?: string | null;
  update_type?: string | null;
};

type FlightAwareFlightRecord = {
  ident?: string | null;
  ident_icao?: string | null;
  ident_iata?: string | null;
  fa_flight_id?: string | null;
  operator?: string | null;
  operator_icao?: string | null;
  operator_iata?: string | null;
  flight_number?: string | null;
  registration?: string | null;
  atc_ident?: string | null;
  aircraft_type?: string | null;
  status?: string | null;
  cancelled?: boolean | null;
  blocked?: boolean | null;
  position_only?: boolean | null;
  origin?: FlightAwareAirportRecord | null;
  destination?: FlightAwareAirportRecord | null;
  scheduled_out?: string | null;
  scheduled_off?: string | null;
  estimated_out?: string | null;
  estimated_off?: string | null;
  actual_out?: string | null;
  actual_off?: string | null;
  actual_runway_off?: string | null;
  scheduled_in?: string | null;
  scheduled_on?: string | null;
  estimated_in?: string | null;
  estimated_on?: string | null;
  actual_in?: string | null;
  actual_on?: string | null;
  actual_runway_on?: string | null;
  last_position?: FlightAwarePositionRecord | null;
};

type FlightAwareFlightsResponse = {
  flights?: FlightAwareFlightRecord[];
};

type SearchVariant = {
  cacheKey: string;
  pathname: string;
  params: Record<string, string>;
};

export type FlightAwareLookupResult = {
  match: FlightAwareFlightEnrichment | null;
  report: FlightSourceDetail;
};

const FLIGHTAWARE_API_BASE = 'https://aeroapi.flightaware.com/aeroapi';
const TRACKER_MAP_VIEWBOX = { width: 1000, height: 560 };
const PROVIDER_COOLDOWN_MS = 15 * 60 * 1000;
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_MIN_REQUEST_GAP_MS = 400;

const projection = geoNaturalEarth1();
projection.fitSize([TRACKER_MAP_VIEWBOX.width, TRACKER_MAP_VIEWBOX.height], { type: 'Sphere' } as never);

let providerCooldownUntil = 0;
let lastFlightAwareRequestStartedAt = 0;
let flightAwareRequestQueue = Promise.resolve();
const inMemoryFallbackCache = new Map<string, { payload: FlightAwareFlightEnrichment | null; expiresAt: number }>();
const inFlightFlightAwareRequests = new Map<string, Promise<unknown>>();

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
  const configuredValue = process.env.FLIGHTAWARE_CACHE_TTL_SECONDS?.trim();
  const parsedValue = configuredValue ? Number.parseInt(configuredValue, 10) : NaN;
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue * 1000 : DEFAULT_CACHE_TTL_MS;
}

function getApiKey(): string {
  return process.env.FLIGHT_AWARE_API_KEY?.trim()
    || process.env.FLIGHTAWARE_API_KEY?.trim()
    || process.env.FLIGHTAWARE_AEROAPI_KEY?.trim()
    || '';
}

function getMinRequestGapMs(): number {
  const configuredValue = process.env.FLIGHTAWARE_MIN_REQUEST_GAP_MS?.trim();
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

function getRateLimitCooldownMs(response: Response, payload: Record<string, unknown>): number {
  const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'));
  const message = typeof payload.message === 'string'
    ? payload.message
    : typeof payload.error === 'string'
      ? payload.error
      : '';

  if (response.status === 402 || /(quota|credit)/i.test(message)) {
    return Math.max(retryAfterMs ?? 0, PROVIDER_COOLDOWN_MS);
  }

  return retryAfterMs ?? PROVIDER_COOLDOWN_MS;
}

async function enqueueFlightAwareRequest<T>(requestKey: string, fetcher: () => Promise<T>): Promise<T> {
  const inFlightRequest = inFlightFlightAwareRequests.get(requestKey);
  if (inFlightRequest) {
    return inFlightRequest as Promise<T>;
  }

  const scheduledRequest = flightAwareRequestQueue.then(async () => {
    const waitMs = Math.max(0, getMinRequestGapMs() - (Date.now() - lastFlightAwareRequestStartedAt));
    if (waitMs > 0) {
      await wait(waitMs);
    }

    lastFlightAwareRequestStartedAt = Date.now();
    return fetcher();
  });

  flightAwareRequestQueue = scheduledRequest.then(() => undefined, () => undefined);
  inFlightFlightAwareRequests.set(requestKey, scheduledRequest as Promise<unknown>);

  try {
    return await scheduledRequest;
  } finally {
    inFlightFlightAwareRequests.delete(requestKey);
  }
}

function isRateLimited(): boolean {
  return Date.now() < providerCooldownUntil;
}

function createFlightAwareReport(
  status: FlightSourceDetail['status'],
  reason: string,
  usedInResult: boolean,
  raw: Record<string, unknown> | null = null,
): FlightSourceDetail {
  return {
    source: 'flightaware',
    status,
    usedInResult,
    reason,
    raw,
  };
}

function summarizeFlightAwareMatch(match: FlightAwareFlightEnrichment): Record<string, unknown> {
  return {
    callsign: match.callsign,
    flightNumber: match.flightNumber,
    faFlightId: match.faFlightId,
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

export function hasFlightAwareCredentials(): boolean {
  return Boolean(getApiKey());
}

export function isFlightAwareConfigured(): boolean {
  return hasFlightAwareCredentials() && isProviderEnabled('flightaware');
}

function buildSyntheticIcao24(identifier: string): string {
  const normalizedIdentifier = normalizeIdentifier(identifier).toLowerCase();
  return normalizedIdentifier.startsWith('fa-') ? normalizedIdentifier : `fa-${normalizedIdentifier}`;
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

function buildSearchVariants(identifier: string): SearchVariant[] {
  const normalizedIdentifier = normalizeIdentifier(identifier);
  if (!normalizedIdentifier) {
    return [];
  }

  const encodedIdentifier = encodeURIComponent(normalizedIdentifier);
  const variants: SearchVariant[] = [];
  const seenKeys = new Set<string>();
  const pushVariant = (cacheKey: string, params: Record<string, string>) => {
    if (seenKeys.has(cacheKey)) {
      return;
    }

    seenKeys.add(cacheKey);
    variants.push({
      cacheKey,
      pathname: `/flights/${encodedIdentifier}`,
      params,
    });
  };

  pushVariant(`designator:${normalizedIdentifier}`, { ident_type: 'designator', max_pages: '1' });
  pushVariant(`default:${normalizedIdentifier}`, { max_pages: '1' });

  if (/^[A-Z0-9-]{4,}$/.test(normalizedIdentifier)) {
    pushVariant(`registration:${normalizedIdentifier}`, { ident_type: 'registration', max_pages: '1' });
  }

  return variants;
}

async function fetchFlightAware<T>(pathname: string, searchParams?: Record<string, string | number | undefined>): Promise<T | null> {
  const apiKey = getApiKey();
  if (!apiKey || isRateLimited()) {
    return null;
  }

  const url = new URL(`${FLIGHTAWARE_API_BASE}${pathname}`);
  for (const [key, value] of Object.entries(searchParams ?? {})) {
    if (value === undefined || value === '') continue;
    url.searchParams.set(key, String(value));
  }

  return enqueueFlightAwareRequest(url.toString(), async () => {
    const startedAt = Date.now();
    const requestDetails = {
      method: 'GET',
      url: url.toString(),
      pathname,
      params: searchParams ?? null,
    };
    let payload: Record<string, unknown> | null = null;
    let responseStatus: number | null = null;
    let responseStatusText: string | null = null;

    try {
      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'x-apikey': apiKey,
        },
        cache: 'no-store',
      });

      responseStatus = response.status;
      responseStatusText = response.statusText;

      if (response.status === 404) {
        await recordProviderRequestLog({
          provider: 'flightaware',
          operation: 'lookup-flight',
          status: 'no-data',
          durationMs: Date.now() - startedAt,
          request: requestDetails,
          response: {
            status: response.status,
            statusText: response.statusText,
          },
        });
        return null;
      }

      payload = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (!response.ok) {
        const message = typeof payload.message === 'string'
          ? payload.message
          : typeof payload.error === 'string'
            ? payload.error
            : `FlightAware request failed with status ${response.status}`;

        if (response.status === 402 || response.status === 429 || /(rate|quota|credit|limit)/i.test(message)) {
          providerCooldownUntil = Date.now() + getRateLimitCooldownMs(response, payload);
          await recordProviderRequestLog({
            provider: 'flightaware',
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
          return null;
        }

        throw new Error(message);
      }

      const flightCount = Array.isArray((payload as FlightAwareFlightsResponse).flights)
        ? (payload as FlightAwareFlightsResponse).flights!.length
        : 0;

      await recordProviderRequestLog({
        provider: 'flightaware',
        operation: 'lookup-flight',
        status: flightCount > 0 ? 'success' : 'no-data',
        durationMs: Date.now() - startedAt,
        request: requestDetails,
        response: {
          status: response.status,
          statusText: response.statusText,
          ok: response.ok,
          flightCount,
          payload,
        },
      });

      return payload as T;
    } catch (error) {
      await recordProviderRequestLog({
        provider: 'flightaware',
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

function toAltitudeMeters(value: unknown): number | null {
  const rawAltitude = toNullableNumber(value);
  if (rawAltitude == null) {
    return null;
  }

  const feet = rawAltitude >= 1_000 ? rawAltitude : rawAltitude * 100;
  return feet * 0.3048;
}

function getRecordMatchScore(record: FlightAwareFlightRecord, identifier: string): number {
  const normalizedIdentifier = normalizeIdentifier(identifier);
  const ident = normalizeIdentifier(record.ident);
  const identIcao = normalizeIdentifier(record.ident_icao);
  const identIata = normalizeIdentifier(record.ident_iata);
  const atcIdent = normalizeIdentifier(record.atc_ident);
  const flightNumber = normalizeIdentifier(record.flight_number);
  const operatorIcao = normalizeIdentifier(record.operator_icao);
  const operatorIata = normalizeIdentifier(record.operator_iata);
  const registration = normalizeIdentifier(record.registration);
  const combinedIcao = operatorIcao && flightNumber ? `${operatorIcao}${flightNumber}` : '';
  const combinedIata = operatorIata && flightNumber ? `${operatorIata}${flightNumber}` : '';

  if (normalizedIdentifier === identIcao) return 125;
  if (normalizedIdentifier === identIata) return 120;
  if (normalizedIdentifier === ident) return 118;
  if (normalizedIdentifier === atcIdent) return 115;
  if (normalizedIdentifier === combinedIcao) return 112;
  if (normalizedIdentifier === combinedIata) return 108;
  if (normalizedIdentifier === flightNumber) return 92;
  if (normalizedIdentifier === registration) return 90;
  return 0;
}

function getRouteFirstSeen(record: FlightAwareFlightRecord): number | null {
  return toTimestampSeconds(record.actual_out)
    ?? toTimestampSeconds(record.actual_off)
    ?? toTimestampSeconds(record.actual_runway_off)
    ?? toTimestampSeconds(record.estimated_out)
    ?? toTimestampSeconds(record.estimated_off)
    ?? toTimestampSeconds(record.scheduled_out)
    ?? toTimestampSeconds(record.scheduled_off);
}

function getRouteLastSeen(record: FlightAwareFlightRecord): number | null {
  return toTimestampSeconds(record.actual_in)
    ?? toTimestampSeconds(record.actual_on)
    ?? toTimestampSeconds(record.actual_runway_on)
    ?? toTimestampSeconds(record.estimated_in)
    ?? toTimestampSeconds(record.estimated_on)
    ?? toTimestampSeconds(record.scheduled_in)
    ?? toTimestampSeconds(record.scheduled_on);
}

function getRecordTemporalScore(record: FlightAwareFlightRecord, referenceTimeMs?: number | null): number {
  const nowSeconds = Math.floor((referenceTimeMs ?? Date.now()) / 1000);
  const liveTimestamp = toTimestampSeconds(record.last_position?.timestamp);
  const routeFirstSeen = getRouteFirstSeen(record);
  const routeLastSeen = getRouteLastSeen(record);
  const status = normalizeIdentifier(record.status);
  let score = 0;

  if (liveTimestamp != null) {
    const liveAgeSeconds = Math.abs(nowSeconds - liveTimestamp);
    score += 30;

    if (liveAgeSeconds <= 15 * 60) {
      score += 25;
    } else if (liveAgeSeconds <= 2 * 60 * 60) {
      score += 15;
    } else if (liveAgeSeconds <= 12 * 60 * 60) {
      score += 5;
    }
  }

  if (/(ENROUTE|AIRBORNE|ACTIVE|DEPARTED|TAXI)/.test(status)) {
    score += 12;
  }

  if (/(ARRIVED|CANCELLED|DIVERTED)/.test(status)) {
    score -= 6;
  }

  const routeDeltas = [routeFirstSeen, routeLastSeen]
    .filter((timestamp): timestamp is number => timestamp != null)
    .map((timestamp) => Math.abs(timestamp - nowSeconds));
  const nearestRouteDelta = routeDeltas.length > 0 ? Math.min(...routeDeltas) : null;

  if (nearestRouteDelta != null) {
    if (nearestRouteDelta <= 2 * 60 * 60) {
      score += 10;
    } else if (nearestRouteDelta <= 12 * 60 * 60) {
      score += 4;
    }
  }

  if (liveTimestamp == null && routeFirstSeen != null && routeFirstSeen > nowSeconds + (6 * 60 * 60)) {
    score -= 35;
  }

  if (liveTimestamp == null && routeLastSeen != null && routeLastSeen > nowSeconds + (6 * 60 * 60)) {
    score -= 20;
  }

  return score;
}

function toEnrichment(record: FlightAwareFlightRecord, identifier: string): FlightAwareFlightEnrichment {
  const normalizedIdentifier = normalizeIdentifier(identifier);
  const callsign = normalizeIdentifier(record.ident_icao)
    || normalizeIdentifier(record.atc_ident)
    || normalizeIdentifier(record.ident_iata)
    || normalizeIdentifier(record.ident)
    || normalizedIdentifier;
  const flightNumber = toNullableString(record.flight_number);
  const heading = toNullableNumber(record.last_position?.heading);
  const altitude = toAltitudeMeters(record.last_position?.altitude);
  const routeFirstSeen = getRouteFirstSeen(record);
  const routeLastSeen = getRouteLastSeen(record);
  const onGround = Boolean(record.cancelled)
    || (altitude != null ? altitude <= 30 : false)
    || (routeLastSeen != null && routeFirstSeen != null && routeLastSeen <= routeFirstSeen);

  const livePoint = projectPoint({
    latitude: toNullableNumber(record.last_position?.latitude),
    longitude: toNullableNumber(record.last_position?.longitude),
    time: toTimestampSeconds(record.last_position?.timestamp),
    altitude,
    heading,
    onGround,
  });

  return {
    provider: 'flightaware',
    identifier: buildSyntheticIcao24(toNullableString(record.fa_flight_id) || callsign),
    faFlightId: toNullableString(record.fa_flight_id),
    callsign,
    flightNumber,
    route: {
      departureAirport: toNullableString(record.origin?.code_icao)?.toUpperCase()
        ?? toNullableString(record.origin?.code)?.toUpperCase()
        ?? toNullableString(record.origin?.code_iata)?.toUpperCase()
        ?? null,
      arrivalAirport: toNullableString(record.destination?.code_icao)?.toUpperCase()
        ?? toNullableString(record.destination?.code)?.toUpperCase()
        ?? toNullableString(record.destination?.code_iata)?.toUpperCase()
        ?? null,
      departureAirportName: toNullableString(record.origin?.name),
      arrivalAirportName: toNullableString(record.destination?.name),
      firstSeen: routeFirstSeen,
      lastSeen: routeLastSeen,
    },
    airline: {
      name: toNullableString(record.operator),
      iata: toNullableString(record.operator_iata)?.toUpperCase() ?? null,
      icao: toNullableString(record.operator_icao)?.toUpperCase() ?? null,
    },
    aircraft: {
      registration: toNullableString(record.registration),
      iata: toNullableString(record.aircraft_type)?.toUpperCase() ?? null,
      icao: toNullableString(record.aircraft_type)?.toUpperCase() ?? null,
      icao24: null,
      model: toNullableString(record.aircraft_type)?.toUpperCase() ?? null,
    },
    current: livePoint,
    velocity: (() => {
      const speedKnots = toNullableNumber(record.last_position?.groundspeed);
      return speedKnots == null ? null : speedKnots * 0.514444;
    })(),
    heading,
    geoAltitude: altitude,
    onGround,
  };
}

async function writeToCache(identifier: string, payload: FlightAwareFlightEnrichment | null): Promise<void> {
  if (isProviderHistoryConfigured()) {
    await writeProviderHistory('flightaware', identifier, payload);
    return;
  }

  inMemoryFallbackCache.set(identifier, {
    payload,
    expiresAt: Date.now() + getCacheTtlMs(),
  });
}

export async function lookupFlightAwareFlightWithReport(
  identifier: string,
  options?: { referenceTimeMs?: number | null },
): Promise<FlightAwareLookupResult> {
  const normalizedIdentifier = normalizeIdentifier(identifier);
  if (!normalizedIdentifier) {
    return {
      match: null,
      report: createFlightAwareReport('skipped', 'FlightAware lookup skipped because no flight identifier was provided.', false),
    };
  }

  const dbDisabledReason = await getProviderDisabledReasonAsync('flightaware');
  if (dbDisabledReason) {
    return {
      match: null,
      report: createFlightAwareReport(
        'skipped',
        dbDisabledReason,
        false,
        { identifier: normalizedIdentifier, disabledByFlag: true },
      ),
    };
  }

  if (!hasFlightAwareCredentials()) {
    return {
      match: null,
      report: createFlightAwareReport(
        'skipped',
        'FlightAware lookup skipped because `FLIGHT_AWARE_API_KEY` (or legacy `FLIGHTAWARE_API_KEY`) is not configured.',
        false,
        { identifier: normalizedIdentifier, disabledByFlag: false },
      ),
    };
  }

  // Synchronous in-memory cache check (preserves original scheduling behavior)
  const memEntry = inMemoryFallbackCache.get(normalizedIdentifier);
  if (memEntry && Date.now() < memEntry.expiresAt) {
    const cachedPayload = memEntry.payload;
    return {
      match: cachedPayload,
      report: cachedPayload
        ? createFlightAwareReport(
            'used',
            'FlightAware AeroAPI returned a cached match and its data was merged into this snapshot.',
            true,
            { identifier: normalizedIdentifier, cached: true, match: summarizeFlightAwareMatch(cachedPayload) },
          )
        : createFlightAwareReport(
            'no-data',
            'FlightAware AeroAPI was queried recently but returned no matching flight.',
            false,
            { identifier: normalizedIdentifier, cached: true },
          ),
    };
  }

  // Async MongoDB history check (only when configured)
  if (isProviderHistoryConfigured()) {
    const ttlMs = getCacheTtlMs();
    const mongoPayload = await readLatestProviderHistory<FlightAwareFlightEnrichment>('flightaware', normalizedIdentifier, ttlMs);
    if (mongoPayload !== null) {
      return {
        match: mongoPayload,
        report: mongoPayload
          ? createFlightAwareReport(
              'used',
              'FlightAware AeroAPI returned a cached match and its data was merged into this snapshot.',
              true,
              { identifier: normalizedIdentifier, cached: true, match: summarizeFlightAwareMatch(mongoPayload) },
            )
          : createFlightAwareReport(
              'no-data',
              'FlightAware AeroAPI was queried recently but returned no matching flight.',
              false,
              { identifier: normalizedIdentifier, cached: true },
            ),
      };
    }
  }

  if (isRateLimited()) {
    return {
      match: null,
      report: createFlightAwareReport(
        'no-data',
        'FlightAware AeroAPI is temporarily cooling down after a rate-limit or quota response.',
        false,
        {
          identifier: normalizedIdentifier,
          cooldownUntil: providerCooldownUntil,
          cooldownRemainingMs: Math.max(0, providerCooldownUntil - Date.now()),
        },
      ),
    };
  }

  let bestMatch: FlightAwareFlightEnrichment | null = null;
  let bestScore = 0;
  const attempts: Array<Record<string, unknown>> = [];

  try {
    for (const variant of buildSearchVariants(normalizedIdentifier)) {
      const payload = await fetchFlightAware<FlightAwareFlightsResponse>(variant.pathname, variant.params);
      const records = Array.isArray(payload?.flights) ? payload.flights : [];
      attempts.push({
        variant: variant.cacheKey,
        params: variant.params,
        returnedRecords: records.length,
      });

      for (const record of records) {
        const score = getRecordMatchScore(record, normalizedIdentifier) + getRecordTemporalScore(record, options?.referenceTimeMs);
        if (score <= bestScore) {
          continue;
        }

        bestScore = score;
        bestMatch = toEnrichment(record, normalizedIdentifier);
      }

      if (bestScore >= 112) {
        break;
      }
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'FlightAware request failed unexpectedly.';
    return {
      match: null,
      report: createFlightAwareReport('error', reason, false, {
        identifier: normalizedIdentifier,
        attempts,
      }),
    };
  }

  await writeToCache(normalizedIdentifier, bestMatch);

  if (!bestMatch) {
    return {
      match: null,
      report: createFlightAwareReport(
        'no-data',
        'FlightAware AeroAPI was queried but returned no matching flight for this identifier.',
        false,
        {
          identifier: normalizedIdentifier,
          attempts,
        },
      ),
    };
  }

  return {
    match: bestMatch,
    report: createFlightAwareReport(
      'used',
      'FlightAware AeroAPI returned a matching flight and its data was merged into this snapshot.',
      true,
      {
        identifier: normalizedIdentifier,
        attempts,
        match: summarizeFlightAwareMatch(bestMatch),
      },
    ),
  };
}

export async function lookupFlightAwareFlight(
  identifier: string,
  options?: { referenceTimeMs?: number | null },
): Promise<FlightAwareFlightEnrichment | null> {
  const result = await lookupFlightAwareFlightWithReport(identifier, options);
  if (result.report.status === 'error') {
    throw new Error(result.report.reason);
  }

  return result.match;
}

export async function lookupFlightAwareFlightsWithReport(identifiers: string[]): Promise<Map<string, FlightAwareLookupResult>> {
  const results = await Promise.all(
    identifiers.map(async (identifier) => ({
      identifier,
      result: await lookupFlightAwareFlightWithReport(identifier),
    })),
  );

  const reports = new Map<string, FlightAwareLookupResult>();
  for (const entry of results) {
    reports.set(entry.identifier, entry.result);
  }

  return reports;
}

export async function lookupFlightAwareFlights(identifiers: string[]): Promise<Map<string, FlightAwareFlightEnrichment>> {
  const results = await lookupFlightAwareFlightsWithReport(identifiers);
  const matches = new Map<string, FlightAwareFlightEnrichment>();

  for (const [identifier, result] of results.entries()) {
    if (result.match) {
      matches.set(identifier, result.match);
    }
  }

  return matches;
}
