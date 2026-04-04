import { geoNaturalEarth1 } from 'd3-geo';
import type { FlightSourceDetail } from '~/components/tracker/flight/types';
import { isProviderEnabled } from './index';
import { isProviderHistoryConfigured, readLatestProviderHistory, writeProviderHistory } from './history';

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

const projection = geoNaturalEarth1();
projection.fitSize([TRACKER_MAP_VIEWBOX.width, TRACKER_MAP_VIEWBOX.height], { type: 'Sphere' } as never);

let providerCooldownUntil = 0;
const inMemoryFallbackCache = new Map<string, { payload: FlightAwareFlightEnrichment | null; expiresAt: number }>();

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

export function isFlightAwareConfigured(): boolean {
  return Boolean(getApiKey()) && isProviderEnabled('flightaware');
}

function buildSyntheticIcao24(identifier: string): string {
  return `fa-${normalizeIdentifier(identifier).toLowerCase()}`;
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

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'x-apikey': apiKey,
    },
    cache: 'no-store',
  });

  if (response.status === 404) {
    return null;
  }

  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const message = typeof payload.message === 'string'
      ? payload.message
      : typeof payload.error === 'string'
        ? payload.error
        : `FlightAware request failed with status ${response.status}`;

    if (response.status === 402 || response.status === 429 || /(rate|quota|credit|limit)/i.test(message)) {
      providerCooldownUntil = Date.now() + PROVIDER_COOLDOWN_MS;
      return null;
    }

    throw new Error(message);
  }

  return payload as T;
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
  if (identIcao.includes(normalizedIdentifier) || identIata.includes(normalizedIdentifier) || ident.includes(normalizedIdentifier)) return 60;
  if (combinedIcao.includes(normalizedIdentifier) || combinedIata.includes(normalizedIdentifier)) return 55;
  return 0;
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
  const routeFirstSeen = toTimestampSeconds(record.actual_out)
    ?? toTimestampSeconds(record.actual_off)
    ?? toTimestampSeconds(record.actual_runway_off)
    ?? toTimestampSeconds(record.estimated_out)
    ?? toTimestampSeconds(record.estimated_off)
    ?? toTimestampSeconds(record.scheduled_out)
    ?? toTimestampSeconds(record.scheduled_off);
  const routeLastSeen = toTimestampSeconds(record.actual_in)
    ?? toTimestampSeconds(record.actual_on)
    ?? toTimestampSeconds(record.actual_runway_on)
    ?? toTimestampSeconds(record.estimated_in)
    ?? toTimestampSeconds(record.estimated_on)
    ?? toTimestampSeconds(record.scheduled_in)
    ?? toTimestampSeconds(record.scheduled_on);
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
    identifier: toNullableString(record.fa_flight_id) || buildSyntheticIcao24(callsign),
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

export async function lookupFlightAwareFlightWithReport(identifier: string): Promise<FlightAwareLookupResult> {
  const normalizedIdentifier = normalizeIdentifier(identifier);
  if (!normalizedIdentifier) {
    return {
      match: null,
      report: createFlightAwareReport('skipped', 'FlightAware lookup skipped because no flight identifier was provided.', false),
    };
  }

  if (!isFlightAwareConfigured()) {
    return {
      match: null,
      report: createFlightAwareReport(
        'skipped',
        'FlightAware lookup skipped because `FLIGHT_AWARE_API_KEY` (or legacy `FLIGHTAWARE_API_KEY`) is not configured.',
        false,
        { identifier: normalizedIdentifier },
      ),
    };
  }

  if (isRateLimited()) {
    return {
      match: null,
      report: createFlightAwareReport(
        'no-data',
        'FlightAware AeroAPI is temporarily cooling down after a rate-limit or quota response.',
        false,
        { identifier: normalizedIdentifier, cooldownUntil: providerCooldownUntil },
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
        const score = getRecordMatchScore(record, normalizedIdentifier);
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

export async function lookupFlightAwareFlight(identifier: string): Promise<FlightAwareFlightEnrichment | null> {
  const result = await lookupFlightAwareFlightWithReport(identifier);
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
