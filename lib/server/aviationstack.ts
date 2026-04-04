import { geoNaturalEarth1 } from 'd3-geo';
import type { FlightSourceDetail } from '~/components/tracker/flight/types';

export type AviationstackFlightEnrichment = {
  provider: 'aviationstack';
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

type AviationstackErrorPayload = {
  error?: {
    code?: string | number;
    message?: string;
  };
};

type AviationstackFlightRecord = {
  flight_status?: string | null;
  departure?: {
    airport?: string | null;
    iata?: string | null;
    icao?: string | null;
    scheduled?: string | null;
    estimated?: string | null;
    actual?: string | null;
  } | null;
  arrival?: {
    airport?: string | null;
    iata?: string | null;
    icao?: string | null;
    scheduled?: string | null;
    estimated?: string | null;
    actual?: string | null;
  } | null;
  airline?: {
    name?: string | null;
    iata?: string | null;
    icao?: string | null;
  } | null;
  flight?: {
    number?: string | null;
    iata?: string | null;
    icao?: string | null;
  } | null;
  aircraft?: {
    registration?: string | null;
    iata?: string | null;
    icao?: string | null;
    icao24?: string | null;
  } | null;
  live?: {
    updated?: string | null;
    latitude?: number | string | null;
    longitude?: number | string | null;
    altitude?: number | string | null;
    direction?: number | string | null;
    speed_horizontal?: number | string | null;
    is_ground?: boolean | null;
  } | null;
};

type AviationstackFlightsResponse = AviationstackErrorPayload & {
  data?: AviationstackFlightRecord[];
};

type SearchVariant = {
  cacheKey: string;
  params: Record<string, string>;
};

export type AviationstackLookupResult = {
  match: AviationstackFlightEnrichment | null;
  report: FlightSourceDetail;
};

const AVIATIONSTACK_API_BASE = 'https://api.aviationstack.com/v1';
const TRACKER_MAP_VIEWBOX = { width: 1000, height: 560 };
const PROVIDER_COOLDOWN_MS = 15 * 60 * 1000;
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;

const projection = geoNaturalEarth1();
projection.fitSize([TRACKER_MAP_VIEWBOX.width, TRACKER_MAP_VIEWBOX.height], { type: 'Sphere' } as never);

let providerCooldownUntil = 0;
const lookupCache = new Map<string, { payload: AviationstackFlightEnrichment | null; expiresAt: number }>();

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
  const configuredValue = process.env.AVIATIONSTACK_CACHE_TTL_SECONDS?.trim();
  const parsedValue = configuredValue ? Number.parseInt(configuredValue, 10) : NaN;
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue * 1000 : DEFAULT_CACHE_TTL_MS;
}

function getAccessKey(): string {
  return process.env.AVIATION_STACK_API_KEY?.trim()
    || process.env.AVIATIONSTACK_ACCESS_KEY?.trim()
    || '';
}

function isRateLimited(): boolean {
  return Date.now() < providerCooldownUntil;
}

function createAviationstackReport(
  status: FlightSourceDetail['status'],
  reason: string,
  usedInResult: boolean,
  raw: Record<string, unknown> | null = null,
): FlightSourceDetail {
  return {
    source: 'aviationstack',
    status,
    usedInResult,
    reason,
    raw,
  };
}

function summarizeAviationstackMatch(match: AviationstackFlightEnrichment): Record<string, unknown> {
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

export function isAviationstackConfigured(): boolean {
  return Boolean(getAccessKey());
}

function buildSyntheticIcao24(identifier: string): string {
  return `as-${normalizeIdentifier(identifier).toLowerCase()}`;
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

  const variants: SearchVariant[] = [];
  const seenKeys = new Set<string>();
  const pushVariant = (cacheKey: string, params: Record<string, string>) => {
    if (seenKeys.has(cacheKey)) {
      return;
    }

    seenKeys.add(cacheKey);
    variants.push({ cacheKey, params });
  };

  if (/^[A-Z]{2}\d[A-Z\d]*$/.test(normalizedIdentifier)) {
    pushVariant(`iata:${normalizedIdentifier}`, { flight_iata: normalizedIdentifier });
  }

  if (/^[A-Z]{3}\d[A-Z\d]*$/.test(normalizedIdentifier)) {
    pushVariant(`icao:${normalizedIdentifier}`, { flight_icao: normalizedIdentifier });
  }

  const numericPart = normalizedIdentifier.replace(/^[A-Z]+/, '');
  if (numericPart) {
    pushVariant(`number:${numericPart}`, { flight_number: numericPart });
  }

  if (variants.length === 0) {
    pushVariant(`number:${normalizedIdentifier}`, { flight_number: normalizedIdentifier });
  }

  return variants;
}

async function fetchFlights(params: Record<string, string>): Promise<AviationstackFlightRecord[]> {
  const accessKey = getAccessKey();
  if (!accessKey || isRateLimited()) {
    return [];
  }

  const url = new URL(`${AVIATIONSTACK_API_BASE}/flights`);
  url.searchParams.set('access_key', accessKey);
  url.searchParams.set('limit', '10');

  for (const [key, value] of Object.entries(params)) {
    if (!value) continue;
    url.searchParams.set(key, value);
  }

  const response = await fetch(url, {
    cache: 'no-store',
  });

  const payload = await response.json().catch(() => ({}) as AviationstackFlightsResponse) as AviationstackFlightsResponse;
  const errorCode = String(payload.error?.code ?? response.status);

  if (!response.ok || payload.error) {
    if (
      response.status === 429
      || errorCode === 'usage_limit_reached'
      || errorCode === 'rate_limit_reached'
      || errorCode === '429'
      || errorCode === 'function_access_restricted'
    ) {
      providerCooldownUntil = Date.now() + PROVIDER_COOLDOWN_MS;
      return [];
    }

    throw new Error(payload.error?.message || `Aviationstack request failed with status ${response.status}`);
  }

  return Array.isArray(payload.data) ? payload.data : [];
}

function getRecordMatchScore(record: AviationstackFlightRecord, identifier: string): number {
  const normalizedIdentifier = normalizeIdentifier(identifier);
  const normalizedFlightIata = normalizeIdentifier(record.flight?.iata);
  const normalizedFlightIcao = normalizeIdentifier(record.flight?.icao);
  const normalizedFlightNumber = normalizeIdentifier(record.flight?.number);
  const normalizedAirlineIata = normalizeIdentifier(record.airline?.iata);
  const normalizedAirlineIcao = normalizeIdentifier(record.airline?.icao);
  const combinedIata = normalizedAirlineIata && normalizedFlightNumber
    ? `${normalizedAirlineIata}${normalizedFlightNumber}`
    : '';
  const combinedIcao = normalizedAirlineIcao && normalizedFlightNumber
    ? `${normalizedAirlineIcao}${normalizedFlightNumber}`
    : '';

  if (normalizedIdentifier === normalizedFlightIata) return 120;
  if (normalizedIdentifier === normalizedFlightIcao) return 115;
  if (normalizedIdentifier === combinedIata) return 110;
  if (normalizedIdentifier === combinedIcao) return 105;
  if (normalizedIdentifier === normalizedFlightNumber) return 90;
  if (normalizedFlightIata.includes(normalizedIdentifier) || normalizedFlightIcao.includes(normalizedIdentifier)) return 60;
  if (combinedIata.includes(normalizedIdentifier) || combinedIcao.includes(normalizedIdentifier)) return 55;
  return 0;
}

function toEnrichment(record: AviationstackFlightRecord, identifier: string): AviationstackFlightEnrichment {
  const normalizedIdentifier = normalizeIdentifier(identifier);
  const flightIata = normalizeIdentifier(record.flight?.iata);
  const flightIcao = normalizeIdentifier(record.flight?.icao);
  const flightNumber = toNullableString(record.flight?.number);
  const airlineIata = toNullableString(record.airline?.iata)?.toUpperCase() ?? null;
  const airlineIcao = toNullableString(record.airline?.icao)?.toUpperCase() ?? null;
  const callsign = flightIata
    || flightIcao
    || (airlineIata && flightNumber ? `${airlineIata}${flightNumber}` : '')
    || (airlineIcao && flightNumber ? `${airlineIcao}${flightNumber}` : '')
    || normalizedIdentifier;

  const departureAirport = toNullableString(record.departure?.icao)?.toUpperCase()
    ?? toNullableString(record.departure?.iata)?.toUpperCase()
    ?? null;
  const arrivalAirport = toNullableString(record.arrival?.icao)?.toUpperCase()
    ?? toNullableString(record.arrival?.iata)?.toUpperCase()
    ?? null;
  const firstSeen = toTimestampSeconds(record.departure?.actual)
    ?? toTimestampSeconds(record.departure?.estimated)
    ?? toTimestampSeconds(record.departure?.scheduled);
  const lastSeen = toTimestampSeconds(record.arrival?.actual)
    ?? toTimestampSeconds(record.arrival?.estimated)
    ?? toTimestampSeconds(record.arrival?.scheduled);

  const heading = toNullableNumber(record.live?.direction);
  const altitude = toNullableNumber(record.live?.altitude);
  const livePoint = projectPoint({
    latitude: toNullableNumber(record.live?.latitude),
    longitude: toNullableNumber(record.live?.longitude),
    time: toTimestampSeconds(record.live?.updated),
    altitude,
    heading,
    onGround: Boolean(record.live?.is_ground),
  });

  return {
    provider: 'aviationstack',
    identifier: toNullableString(record.aircraft?.icao24) || buildSyntheticIcao24(callsign),
    callsign,
    flightNumber,
    route: {
      departureAirport,
      arrivalAirport,
      departureAirportName: toNullableString(record.departure?.airport),
      arrivalAirportName: toNullableString(record.arrival?.airport),
      firstSeen,
      lastSeen,
    },
    airline: {
      name: toNullableString(record.airline?.name),
      iata: airlineIata,
      icao: airlineIcao,
    },
    aircraft: {
      registration: toNullableString(record.aircraft?.registration),
      iata: toNullableString(record.aircraft?.iata)?.toUpperCase() ?? null,
      icao: toNullableString(record.aircraft?.icao)?.toUpperCase() ?? null,
      icao24: toNullableString(record.aircraft?.icao24)?.toUpperCase() ?? null,
      model: toNullableString(record.aircraft?.iata)?.toUpperCase()
        ?? toNullableString(record.aircraft?.icao)?.toUpperCase()
        ?? null,
    },
    current: livePoint,
    velocity: (() => {
      const speedKmH = toNullableNumber(record.live?.speed_horizontal);
      return speedKmH == null ? null : speedKmH / 3.6;
    })(),
    heading,
    geoAltitude: altitude,
    onGround: Boolean(record.live?.is_ground),
  };
}

export async function lookupAviationstackFlightWithReport(identifier: string): Promise<AviationstackLookupResult> {
  const normalizedIdentifier = normalizeIdentifier(identifier);
  if (!normalizedIdentifier) {
    return {
      match: null,
      report: createAviationstackReport('skipped', 'Aviationstack lookup skipped because no flight identifier was provided.', false),
    };
  }

  if (!isAviationstackConfigured()) {
    return {
      match: null,
      report: createAviationstackReport(
        'skipped',
        'Aviationstack lookup skipped because `AVIATION_STACK_API_KEY` is not configured.',
        false,
        { identifier: normalizedIdentifier },
      ),
    };
  }

  if (isRateLimited()) {
    return {
      match: null,
      report: createAviationstackReport(
        'no-data',
        'Aviationstack is temporarily cooling down after a rate-limit response.',
        false,
        { identifier: normalizedIdentifier, cooldownUntil: providerCooldownUntil },
      ),
    };
  }

  const cachedEntry = lookupCache.get(normalizedIdentifier);
  if (cachedEntry) {
    if (Date.now() < cachedEntry.expiresAt) {
      return {
        match: cachedEntry.payload,
        report: cachedEntry.payload
          ? createAviationstackReport(
              'used',
              'Aviationstack returned a cached match and its data was merged into this snapshot.',
              true,
              { identifier: normalizedIdentifier, cached: true, match: summarizeAviationstackMatch(cachedEntry.payload) },
            )
          : createAviationstackReport(
              'no-data',
              'Aviationstack was queried recently but no matching flight was returned.',
              false,
              { identifier: normalizedIdentifier, cached: true },
            ),
      };
    }

    lookupCache.delete(normalizedIdentifier);
  }

  let bestMatch: AviationstackFlightEnrichment | null = null;
  let bestScore = 0;
  const attempts: Array<Record<string, unknown>> = [];

  try {
    for (const variant of buildSearchVariants(normalizedIdentifier)) {
      const records = await fetchFlights(variant.params);
      attempts.push({
        variant: variant.cacheKey,
        params: variant.params,
        returnedRecords: records.length,
      });

      for (const record of records) {
        const score = getRecordMatchScore(record, normalizedIdentifier);
        if (score <= bestScore) {
          continue;
        }

        bestScore = score;
        bestMatch = toEnrichment(record, normalizedIdentifier);
      }

      if (bestScore >= 110) {
        break;
      }
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Aviationstack request failed unexpectedly.';
    return {
      match: null,
      report: createAviationstackReport('error', reason, false, {
        identifier: normalizedIdentifier,
        attempts,
      }),
    };
  }

  lookupCache.set(normalizedIdentifier, {
    payload: bestMatch,
    expiresAt: Date.now() + getCacheTtlMs(),
  });

  if (!bestMatch) {
    return {
      match: null,
      report: createAviationstackReport(
        'no-data',
        'Aviationstack was queried but returned no matching flight for this identifier.',
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
    report: createAviationstackReport(
      'used',
      'Aviationstack returned a matching flight and its data was merged into this snapshot.',
      true,
      {
        identifier: normalizedIdentifier,
        attempts,
        match: summarizeAviationstackMatch(bestMatch),
      },
    ),
  };
}

export async function lookupAviationstackFlight(identifier: string): Promise<AviationstackFlightEnrichment | null> {
  const result = await lookupAviationstackFlightWithReport(identifier);
  if (result.report.status === 'error') {
    throw new Error(result.report.reason);
  }

  return result.match;
}

export async function lookupAviationstackFlightsWithReport(identifiers: string[]): Promise<Map<string, AviationstackLookupResult>> {
  const results = await Promise.all(
    identifiers.map(async (identifier) => ({
      identifier,
      result: await lookupAviationstackFlightWithReport(identifier),
    })),
  );

  const reports = new Map<string, AviationstackLookupResult>();
  for (const entry of results) {
    reports.set(entry.identifier, entry.result);
  }

  return reports;
}

export async function lookupAviationstackFlights(identifiers: string[]): Promise<Map<string, AviationstackFlightEnrichment>> {
  const results = await lookupAviationstackFlightsWithReport(identifiers);
  const matches = new Map<string, AviationstackFlightEnrichment>();

  for (const [identifier, result] of results.entries()) {
    if (result.match) {
      matches.set(identifier, result.match);
    }
  }

  return matches;
}
