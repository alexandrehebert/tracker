import type { FlightSourceDetail, TrackedFlight } from '~/components/tracker/flight/types';
import { getFlightPointTimeMs } from '~/lib/flightHistory';

const AUTO_LOCK_WINDOW_HOURS = 36;
const AUTO_LOCK_LOOKBACK_DAYS = 7;
const FLIGHT_MATCH_WINDOW_HOURS = 6;
const DEMO_REFERENCE_BUCKET_MS = 15 * 60 * 1000;

export type FriendFlightValidationStatus = 'matched' | 'warning' | 'not-found' | 'error' | 'skipped';

export interface FriendFlightValidationProviderSnapshot {
  status?: FriendFlightValidationStatus | null;
  providerLabel?: string | null;
  message?: string | null;
  matchedIcao24?: string | null;
  matchedFlightNumber?: string | null;
  matchedDepartureTime?: string | null;
  matchedArrivalTime?: string | null;
  matchedDepartureAirport?: string | null;
  matchedArrivalAirport?: string | null;
  matchedRoute?: string | null;
  departureDeltaMinutes?: number | null;
  lastCheckedAt?: number | null;
}

export interface FriendFlightValidationSnapshot extends FriendFlightValidationProviderSnapshot {
  providerMatches?: FriendFlightValidationProviderSnapshot[] | null;
}

export interface FriendFlightLeg {
  id: string;
  flightNumber: string;
  departureTime: string;
  arrivalTime?: string | null;
  departureTimezone?: string | null;
  from?: string | null;
  to?: string | null;
  note?: string | null;
  resolvedIcao24?: string | null;
  lastResolvedAt?: number | null;
  validatedFlight?: FriendFlightValidationSnapshot | null;
}

export interface FriendTravelConfig {
  id: string;
  name: string;
  avatarUrl?: string | null;
  color?: string | null;
  colorOverride?: string | null;
  currentAirport?: string | null;
  flights: FriendFlightLeg[];
}

export interface FriendsTrackerTripConfig {
  id: string;
  name: string;
  destinationAirport?: string | null;
  friends: FriendTravelConfig[];
  isDemo?: boolean | null;
}

export interface FriendsTrackerConfig {
  updatedAt: number | null;
  updatedBy: string | null;
  cronEnabled?: boolean | null;
  currentTripId?: string | null;
  trips?: FriendsTrackerTripConfig[];
  destinationAirport?: string | null;
  airportTimezones?: Record<string, string> | null;
  friends: FriendTravelConfig[];
}

export type NormalizedFriendsTrackerConfig = FriendsTrackerConfig & {
  currentTripId: string | null;
  trips: FriendsTrackerTripConfig[];
  destinationAirport: string | null;
  airportTimezones: Record<string, string>;
  friends: FriendTravelConfig[];
};

export interface FriendFlightStatus {
  friend: FriendTravelConfig;
  leg: FriendFlightLeg;
  flight: TrackedFlight | null;
  label: string;
  canAutoLock: boolean;
  status: 'matched' | 'scheduled' | 'awaiting';
}

function getTrackedFlightEarliestRelevantTimeMs(flight: TrackedFlight): number | null {
  let earliestMs: number | null = null;

  const considerTimestamp = (value: number | null | undefined) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return;
    }

    earliestMs = earliestMs == null ? value : Math.min(earliestMs, value);
  };

  considerTimestamp(typeof flight.route.firstSeen === 'number' ? flight.route.firstSeen * 1000 : null);
  considerTimestamp(typeof flight.lastContact === 'number' ? flight.lastContact * 1000 : null);

  for (const point of [flight.originPoint, ...flight.track, ...(flight.rawTrack ?? []), flight.current]) {
    considerTimestamp(getFlightPointTimeMs(point));
  }

  for (const snapshot of flight.fetchHistory ?? []) {
    considerTimestamp(snapshot.capturedAt);
    considerTimestamp(typeof snapshot.route.firstSeen === 'number' ? snapshot.route.firstSeen * 1000 : null);
    considerTimestamp(getFlightPointTimeMs(snapshot.current));
  }

  return earliestMs;
}

function isTrackedFlightRelevantAtTime(flight: TrackedFlight, referenceTimeMs: number): boolean {
  const earliestRelevantTimeMs = getTrackedFlightEarliestRelevantTimeMs(flight);
  return earliestRelevantTimeMs == null || referenceTimeMs >= earliestRelevantTimeMs;
}

function isMatchedStatusActiveAtTime(status: FriendFlightStatus | undefined, referenceTimeMs: number): boolean {
  if (status?.status !== 'matched') {
    return false;
  }

  if (!status.flight) {
    const scheduledTimeMs = Date.parse(status.leg.departureTime);
    if (!Number.isFinite(scheduledTimeMs)) {
      return true;
    }

    const fallbackStartMs = scheduledTimeMs - (FLIGHT_MATCH_WINDOW_HOURS * 60 * 60 * 1000);
    const fallbackEndMs = scheduledTimeMs + (AUTO_LOCK_WINDOW_HOURS * 60 * 60 * 1000);
    return referenceTimeMs >= fallbackStartMs && referenceTimeMs <= fallbackEndMs;
  }

  if (!isTrackedFlightRelevantAtTime(status.flight, referenceTimeMs)) {
    return false;
  }

  const firstSeenMs = typeof status.flight.route.firstSeen === 'number'
    ? status.flight.route.firstSeen * 1000
    : null;
  const lastSeenMs = typeof status.flight.route.lastSeen === 'number'
    ? status.flight.route.lastSeen * 1000
    : null;

  if (firstSeenMs != null && referenceTimeMs < firstSeenMs) {
    return false;
  }

  if (lastSeenMs != null && referenceTimeMs > lastSeenMs) {
    return false;
  }

  if (!status.flight.onGround) {
    return true;
  }

  if (firstSeenMs == null || lastSeenMs == null) {
    return false;
  }

  return referenceTimeMs >= firstSeenMs && referenceTimeMs <= lastSeenMs;
}

function normalizeOptionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

const VALIDATION_PROVIDER_LABELS: Record<FlightSourceDetail['source'], string> = {
  opensky: 'OpenSky',
  aviationstack: 'Aviationstack',
  flightaware: 'FlightAware',
  airlabs: 'AirLabs',
  aerodatabox: 'AeroDataBox',
};

function isFriendFlightValidationStatus(value: unknown): value is FriendFlightValidationStatus {
  return value === 'matched'
    || value === 'warning'
    || value === 'not-found'
    || value === 'error'
    || value === 'skipped';
}

function resolveValidationProviderLabel(source: FlightSourceDetail['source'] | null | undefined): string | null {
  return source ? VALIDATION_PROVIDER_LABELS[source] ?? source : null;
}

const CSS_HEX_COLOR_PATTERN = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const CSS_FUNCTION_COLOR_PATTERN = /^(?:rgb|rgba|hsl|hsla)\(([^)]+)\)$/i;
const AUTO_FRIEND_COLOR_PALETTE = [
  '#ef4444',
  '#06b6d4',
  '#f59e0b',
  '#8b5cf6',
  '#22c55e',
  '#ec4899',
  '#3b82f6',
  '#84cc16',
  '#f97316',
  '#14b8a6',
  '#e11d48',
  '#6366f1',
] as const;
const AUTO_FRIEND_COLOR_STEP = 5;

export function normalizeConfiguredFriendColor(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  return CSS_HEX_COLOR_PATTERN.test(normalized) || CSS_FUNCTION_COLOR_PATTERN.test(normalized)
    ? normalized
    : null;
}

function hashFriendColorSeed(value: string): number {
  let hash = 0;

  for (const character of value) {
    hash = ((hash * 31) + character.charCodeAt(0)) >>> 0;
  }

  return hash;
}

function getGeneratedFriendColorFromSeed(seedIndex: number, attempt = 0): string {
  const paletteIndex = (seedIndex + (attempt * AUTO_FRIEND_COLOR_STEP)) % AUTO_FRIEND_COLOR_PALETTE.length;
  return AUTO_FRIEND_COLOR_PALETTE[paletteIndex]!;
}

function assignAutoFriendColors(friends: FriendTravelConfig[]): FriendTravelConfig[] {
  const usedColors = new Set<string>();

  return friends.map((friend, friendIndex) => {
    const storedAutoColor = normalizeConfiguredFriendColor(friend.color);
    const normalizedOverrideColor = normalizeConfiguredFriendColor(friend.colorOverride);

    if (storedAutoColor) {
      usedColors.add(storedAutoColor);
      return {
        ...friend,
        color: storedAutoColor,
        colorOverride: normalizedOverrideColor,
      };
    }

    const seed = [friend.id, friend.name]
      .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
      .map((value) => value.trim().toLowerCase())
      .join(':');
    const seedIndex = seed ? hashFriendColorSeed(seed) : friendIndex;

    let resolvedColor = getGeneratedFriendColorFromSeed(seedIndex);
    for (let attempt = 0; attempt < AUTO_FRIEND_COLOR_PALETTE.length; attempt += 1) {
      const candidateColor = getGeneratedFriendColorFromSeed(seedIndex, attempt);
      if (!usedColors.has(candidateColor)) {
        resolvedColor = candidateColor;
        break;
      }
    }

    usedColors.add(resolvedColor);
    return {
      ...friend,
      color: resolvedColor,
      colorOverride: normalizedOverrideColor,
    };
  });
}

export function resolveAutoFriendAccentColor(
  friend: Pick<Partial<FriendTravelConfig>, 'id' | 'name' | 'color'> | null | undefined,
  fallbackIndex = 0,
): string {
  const storedAutoColor = normalizeConfiguredFriendColor(friend?.color);
  if (storedAutoColor) {
    return storedAutoColor;
  }

  const seed = [friend?.id, friend?.name]
    .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
    .map((value) => value.trim().toLowerCase())
    .join(':');

  const seedIndex = seed ? hashFriendColorSeed(seed) : fallbackIndex;
  return getGeneratedFriendColorFromSeed(seedIndex);
}

export function resolveFriendAccentColor(
  friend: Pick<Partial<FriendTravelConfig>, 'id' | 'name' | 'color' | 'colorOverride'> | null | undefined,
  fallbackIndex = 0,
): string {
  const overrideColor = normalizeConfiguredFriendColor(friend?.colorOverride);
  if (overrideColor) {
    return overrideColor;
  }

  return resolveAutoFriendAccentColor(friend, fallbackIndex);
}

function getServiceDayKey(timestampMs: number, timeZone: string | null | undefined): string {
  const normalizedTimeZone = normalizeOptionalText(timeZone) ?? 'UTC';

  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: normalizedTimeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(timestampMs));
  } catch {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(timestampMs));
  }
}

function isSameServiceDay(
  referenceTimeMs: number,
  scheduledTimeMs: number,
  timeZone: string | null | undefined,
): boolean {
  return getServiceDayKey(referenceTimeMs, timeZone) === getServiceDayKey(scheduledTimeMs, timeZone);
}

function doesFlightRouteMatchLeg(flight: TrackedFlight, leg: FriendFlightLeg): boolean {
  const configuredFrom = normalizeOptionalText(leg.from)?.toUpperCase() ?? null;
  const configuredTo = normalizeOptionalText(leg.to)?.toUpperCase() ?? null;
  const departureAirport = normalizeOptionalText(flight.route.departureAirport)?.toUpperCase() ?? null;
  const arrivalAirport = normalizeOptionalText(flight.route.arrivalAirport)?.toUpperCase() ?? null;

  if (configuredFrom && departureAirport && configuredFrom !== departureAirport) {
    return false;
  }

  if (configuredTo && arrivalAirport && configuredTo !== arrivalAirport) {
    return false;
  }

  return true;
}

export function parseDestinationAirportCodes(value: string | null | undefined): string[] {
  if (typeof value !== 'string') {
    return [];
  }

  return Array.from(
    new Set(
      value
        .split(/[\n,;]+/)
        .map((entry) => entry.trim().toUpperCase())
        .filter(Boolean),
    ),
  );
}

function normalizeDateTime(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }

  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return '';
  }

  const parsedTime = Date.parse(trimmedValue);
  return Number.isNaN(parsedTime) ? trimmedValue : new Date(parsedTime).toISOString();
}

function normalizeFriendFlightValidationProviderSnapshot(
  input: Partial<FriendFlightValidationProviderSnapshot> | null | undefined,
): FriendFlightValidationProviderSnapshot | null {
  if (!input) {
    return null;
  }

  const status = isFriendFlightValidationStatus(input.status) ? input.status : null;
  const providerLabel = normalizeOptionalText(input.providerLabel);
  const message = normalizeOptionalText(input.message);
  const matchedIcao24 = normalizeFriendFlightIdentifier(input.matchedIcao24 ?? null) || null;
  const matchedFlightNumber = normalizeFriendFlightIdentifier(input.matchedFlightNumber ?? null) || null;
  const matchedDepartureTime = normalizeDateTime(input.matchedDepartureTime);
  const matchedArrivalTime = normalizeDateTime(input.matchedArrivalTime);
  const matchedDepartureAirport = normalizeOptionalText(input.matchedDepartureAirport)?.toUpperCase() ?? null;
  const matchedArrivalAirport = normalizeOptionalText(input.matchedArrivalAirport)?.toUpperCase() ?? null;
  const matchedRoute = normalizeOptionalText(input.matchedRoute);
  const departureDeltaMinutes = typeof input.departureDeltaMinutes === 'number' && Number.isFinite(input.departureDeltaMinutes)
    ? input.departureDeltaMinutes
    : null;
  const lastCheckedAt = typeof input.lastCheckedAt === 'number' && Number.isFinite(input.lastCheckedAt)
    ? input.lastCheckedAt
    : null;

  const hasContent = status != null
    || providerLabel != null
    || message != null
    || matchedIcao24 != null
    || matchedFlightNumber != null
    || Boolean(matchedDepartureTime)
    || Boolean(matchedArrivalTime)
    || matchedDepartureAirport != null
    || matchedArrivalAirport != null
    || matchedRoute != null
    || departureDeltaMinutes != null
    || lastCheckedAt != null;

  if (!hasContent) {
    return null;
  }

  return {
    status,
    providerLabel,
    message,
    matchedIcao24,
    matchedFlightNumber,
    matchedDepartureTime: matchedDepartureTime || null,
    matchedArrivalTime: matchedArrivalTime || null,
    matchedDepartureAirport,
    matchedArrivalAirport,
    matchedRoute,
    departureDeltaMinutes,
    lastCheckedAt,
  };
}

function dedupeFriendFlightValidationProviderSnapshots(
  snapshots: Array<Partial<FriendFlightValidationProviderSnapshot> | null | undefined>,
): FriendFlightValidationProviderSnapshot[] {
  const deduped: FriendFlightValidationProviderSnapshot[] = [];
  const seenKeys = new Set<string>();

  for (const snapshot of snapshots) {
    const normalizedSnapshot = normalizeFriendFlightValidationProviderSnapshot(snapshot);
    if (!normalizedSnapshot) {
      continue;
    }

    const key = [
      normalizedSnapshot.providerLabel ?? '',
      normalizedSnapshot.matchedIcao24 ?? '',
      normalizedSnapshot.matchedFlightNumber ?? '',
      normalizedSnapshot.matchedDepartureTime ?? '',
      normalizedSnapshot.matchedArrivalTime ?? '',
      normalizedSnapshot.matchedDepartureAirport ?? '',
      normalizedSnapshot.matchedArrivalAirport ?? '',
    ].join('|');

    if (seenKeys.has(key)) {
      continue;
    }

    seenKeys.add(key);
    deduped.push(normalizedSnapshot);
  }

  return deduped;
}

function normalizeFriendFlightValidationSnapshot(
  input: Partial<FriendFlightValidationSnapshot> | null | undefined,
): FriendFlightValidationSnapshot | null {
  if (!input) {
    return null;
  }

  const normalizedSnapshot = normalizeFriendFlightValidationProviderSnapshot(input);
  const providerMatches = dedupeFriendFlightValidationProviderSnapshots(
    Array.isArray(input.providerMatches) ? input.providerMatches : [],
  );

  if (!normalizedSnapshot && providerMatches.length === 0) {
    return null;
  }

  return {
    ...(normalizedSnapshot ?? {}),
    providerMatches: providerMatches.length > 0 ? providerMatches : null,
  };
}

function getFallbackId(prefix: string, firstIndex: number, secondIndex?: number): string {
  return secondIndex == null
    ? `${prefix}-${firstIndex + 1}`
    : `${prefix}-${firstIndex + 1}-${secondIndex + 1}`;
}

function resolveFlightReferenceTimeMs(flight: TrackedFlight): number | null {
  if (typeof flight.route.firstSeen === 'number' && Number.isFinite(flight.route.firstSeen)) {
    return flight.route.firstSeen * 1000;
  }

  if (typeof flight.lastContact === 'number' && Number.isFinite(flight.lastContact)) {
    return flight.lastContact * 1000;
  }

  if (typeof flight.route.lastSeen === 'number' && Number.isFinite(flight.route.lastSeen)) {
    return flight.route.lastSeen * 1000;
  }

  return null;
}

function hasTrackedFlightTelemetry(flight: TrackedFlight): boolean {
  return flight.current != null
    || flight.originPoint != null
    || flight.track.length > 0
    || (flight.rawTrack?.length ?? 0) > 0
    || (flight.fetchHistory?.length ?? 0) > 0
    || (typeof flight.lastContact === 'number' && Number.isFinite(flight.lastContact))
    || (typeof flight.route.firstSeen === 'number' && Number.isFinite(flight.route.firstSeen))
    || (typeof flight.route.lastSeen === 'number' && Number.isFinite(flight.route.lastSeen));
}

function isFlightTimingPlausibleForLeg(
  flight: TrackedFlight,
  leg: FriendFlightLeg,
  now = Date.now(),
  options?: { isLockedMatch?: boolean },
): boolean {
  if (!doesFlightRouteMatchLeg(flight, leg)) {
    return false;
  }

  const scheduledTime = Date.parse(leg.departureTime);
  if (!Number.isFinite(scheduledTime)) {
    return true;
  }

  const resolvedReferenceTime = resolveFlightReferenceTimeMs(flight);
  if (!options?.isLockedMatch && resolvedReferenceTime == null && scheduledTime > now && !hasTrackedFlightTelemetry(flight)) {
    return false;
  }

  const referenceTime = resolvedReferenceTime ?? now;
  const matchWindowHours = options?.isLockedMatch ? AUTO_LOCK_WINDOW_HOURS : FLIGHT_MATCH_WINDOW_HOURS;
  const matchWindowMs = matchWindowHours * 60 * 60 * 1000;

  if (!options?.isLockedMatch && !isSameServiceDay(referenceTime, scheduledTime, leg.departureTimezone)) {
    return false;
  }

  return Math.abs(referenceTime - scheduledTime) <= matchWindowMs;
}

export function normalizeFriendFlightIdentifier(value: string | null | undefined): string {
  return typeof value === 'string'
    ? value.replace(/\s+/g, '').trim().toUpperCase()
    : '';
}

export function resolveSuggestedFlightNumber(
  preferredIdentifier: string | null | undefined,
  suggestedFlightNumber: string | null | undefined,
): string {
  const normalizedSuggestedFlightNumber = normalizeFriendFlightIdentifier(suggestedFlightNumber);
  if (!normalizedSuggestedFlightNumber) {
    return '';
  }

  const normalizedPreferredIdentifier = normalizeFriendFlightIdentifier(preferredIdentifier);
  const suggestedIsNumericSuffix = /^\d+[A-Z]?$/.test(normalizedSuggestedFlightNumber);
  const preferredHasAirlinePrefix = /^[A-Z]{2,4}\d+[A-Z]?$/.test(normalizedPreferredIdentifier);

  if (suggestedIsNumericSuffix
    && preferredHasAirlinePrefix
    && normalizedPreferredIdentifier.endsWith(normalizedSuggestedFlightNumber)) {
    return normalizedPreferredIdentifier;
  }

  return normalizedSuggestedFlightNumber;
}

export function createEmptyFriendFlightLeg(): FriendFlightLeg {
  return {
    id: '',
    flightNumber: '',
    departureTime: '',
    arrivalTime: null,
    departureTimezone: null,
    from: null,
    to: null,
    note: null,
    resolvedIcao24: null,
    lastResolvedAt: null,
    validatedFlight: null,
  };
}

const DEFAULT_DEMO_TRIP_ID = 'demo-test-trip';

export function createEmptyFriendConfig(): FriendTravelConfig {
  return {
    id: '',
    name: '',
    avatarUrl: null,
    color: null,
    colorOverride: null,
    currentAirport: null,
    flights: [],
  };
}

export function createEmptyTripConfig(): FriendsTrackerTripConfig {
  return {
    id: '',
    name: '',
    destinationAirport: null,
    friends: [],
    isDemo: false,
  };
}

function getDemoReferenceTime(now = Date.now()): number {
  return Math.floor(now / DEMO_REFERENCE_BUCKET_MS) * DEMO_REFERENCE_BUCKET_MS;
}

function buildDefaultDemoTrip(now = getDemoReferenceTime()): FriendsTrackerTripConfig {
  return {
    id: DEFAULT_DEMO_TRIP_ID,
    name: 'Demo / Test Trip',
    destinationAirport: 'JFK',
    isDemo: true,
    friends: [
      {
        id: 'demo-friend-1',
        name: 'Alice Demo',
        flights: [
          {
            id: 'demo-leg-1',
            flightNumber: 'TEST1',
            departureTime: new Date(now + (45 * 60 * 1000)).toISOString(),
            from: 'CDG',
            to: 'JFK',
            note: 'Preset demo leg: pre-departure at Paris CDG.',
          },
        ],
      },
      {
        id: 'demo-friend-2',
        name: 'Bruno Demo',
        flights: [
          {
            id: 'demo-leg-2',
            flightNumber: 'TEST2',
            departureTime: new Date(now - (2 * 60 * 60 * 1000)).toISOString(),
            from: 'LHR',
            to: 'JFK',
            note: 'Preset demo leg: already airborne across the Atlantic.',
          },
        ],
      },
      {
        id: 'demo-friend-3',
        name: 'Chloe Demo',
        flights: [
          {
            id: 'demo-leg-3',
            flightNumber: 'TEST3',
            departureTime: new Date(now - (3 * 60 * 60 * 1000)).toISOString(),
            from: 'ATL',
            to: 'JFK',
            note: 'Preset demo leg: already arrived at New York JFK.',
          },
        ],
      },
      {
        id: 'demo-friend-4',
        name: 'Diego Demo',
        flights: [
          {
            id: 'demo-leg-4a',
            flightNumber: 'TEST5',
            departureTime: new Date(now - (4 * 60 * 60 * 1000)).toISOString(),
            from: 'BCN',
            to: 'AMS',
            note: 'Preset demo leg: landed at the connection stop in Amsterdam.',
          },
          {
            id: 'demo-leg-4b',
            flightNumber: 'TEST7',
            departureTime: new Date(now + (70 * 60 * 1000)).toISOString(),
            from: 'AMS',
            to: 'JFK',
            note: 'Preset demo leg: upcoming connection from Amsterdam to New York.',
          },
        ],
      },
      {
        id: 'demo-friend-5',
        name: 'Emma Demo',
        flights: [
          {
            id: 'demo-leg-5a',
            flightNumber: 'TEST8',
            departureTime: new Date(now - (5 * 60 * 60 * 1000)).toISOString(),
            from: 'LIS',
            to: 'MAD',
            note: 'Preset demo leg: feeder hop already completed into Madrid.',
          },
          {
            id: 'demo-leg-5b',
            flightNumber: 'TEST4',
            departureTime: new Date(now - (85 * 60 * 1000)).toISOString(),
            from: 'MAD',
            to: 'JFK',
            note: 'Preset demo leg: currently flying the long-haul connection to New York.',
          },
        ],
      },
      {
        id: 'demo-friend-6',
        name: 'Farah Demo',
        flights: [
          {
            id: 'demo-leg-6a',
            flightNumber: 'TEST9',
            departureTime: new Date(now + (7 * 60 * 60 * 1000)).toISOString(),
            from: 'FCO',
            to: 'CDG',
            note: 'Preset demo leg: future feeder flight to Paris.',
          },
          {
            id: 'demo-leg-6b',
            flightNumber: 'TEST10',
            departureTime: new Date(now + (10 * 60 * 60 * 1000)).toISOString(),
            from: 'CDG',
            to: 'JFK',
            note: 'Preset demo leg: not started yet and still awaiting telemetry.',
          },
        ],
      },
      {
        id: 'demo-friend-7',
        name: 'Hana Demo',
        flights: [
          {
            id: 'demo-leg-7',
            flightNumber: 'TEST6',
            departureTime: new Date(now - (95 * 60 * 1000)).toISOString(),
            from: 'DFW',
            to: 'ICN',
            note: 'Preset demo leg: westbound Pacific crossing near the dateline for 2D map edge validation.',
          },
        ],
      },
    ],
  };
}

function mergeDemoFriend(
  freshFriend: FriendTravelConfig,
  existingFriend: FriendTravelConfig | undefined,
): FriendTravelConfig {
  if (!existingFriend) {
    return freshFriend;
  }

  const mergedFlights = freshFriend.flights.map((freshLeg) => {
    const existingLeg = existingFriend.flights.find((leg) => leg.id === freshLeg.id)
      ?? existingFriend.flights.find((leg) => normalizeFriendFlightIdentifier(leg.flightNumber) === normalizeFriendFlightIdentifier(freshLeg.flightNumber));

    if (!existingLeg) {
      return freshLeg;
    }

    return {
      ...freshLeg,
      departureTime: freshLeg.departureTime,
      arrivalTime: freshLeg.arrivalTime ?? existingLeg.arrivalTime,
      from: existingLeg.from ?? freshLeg.from,
      to: existingLeg.to ?? freshLeg.to,
      note: existingLeg.note ?? freshLeg.note,
      resolvedIcao24: existingLeg.resolvedIcao24 ?? freshLeg.resolvedIcao24,
      lastResolvedAt: existingLeg.lastResolvedAt ?? freshLeg.lastResolvedAt,
      validatedFlight: existingLeg.validatedFlight ?? freshLeg.validatedFlight ?? null,
    };
  });

  const extraFlights = existingFriend.flights.filter((existingLeg) => !mergedFlights.some((flight) => (
    flight.id === existingLeg.id
    || normalizeFriendFlightIdentifier(flight.flightNumber) === normalizeFriendFlightIdentifier(existingLeg.flightNumber)
  )));

  return {
    ...freshFriend,
    name: existingFriend.name || freshFriend.name,
    avatarUrl: existingFriend.avatarUrl ?? freshFriend.avatarUrl,
    color: normalizeConfiguredFriendColor(existingFriend.color) ?? freshFriend.color,
    colorOverride: normalizeConfiguredFriendColor(existingFriend.colorOverride) ?? freshFriend.colorOverride ?? null,
    currentAirport: normalizeOptionalText(existingFriend.currentAirport) ?? freshFriend.currentAirport ?? null,
    flights: [...mergedFlights, ...extraFlights],
  };
}

function mergeDemoTrip(
  freshDemoTrip: FriendsTrackerTripConfig,
  existingTrip: FriendsTrackerTripConfig | undefined,
): FriendsTrackerTripConfig {
  if (!existingTrip) {
    return freshDemoTrip;
  }

  const mergedFriends = freshDemoTrip.friends.map((freshFriend) => (
    mergeDemoFriend(
      freshFriend,
      existingTrip.friends.find((friend) => friend.id === freshFriend.id),
    )
  ));

  const extraFriends = existingTrip.friends.filter((existingFriend) => !mergedFriends.some((friend) => friend.id === existingFriend.id));

  return {
    ...freshDemoTrip,
    name: existingTrip.name || freshDemoTrip.name,
    destinationAirport: existingTrip.destinationAirport ?? freshDemoTrip.destinationAirport,
    friends: [...mergedFriends, ...extraFriends],
  };
}

function ensureDemoTrip(
  trips: FriendsTrackerTripConfig[],
  demoReferenceTime = getDemoReferenceTime(),
): FriendsTrackerTripConfig[] {
  const freshDemoTrip = normalizeFriendsTrackerTripConfig(
    buildDefaultDemoTrip(getDemoReferenceTime(demoReferenceTime)),
  );
  let hasDemoTrip = false;

  const refreshedTrips = trips.map((trip) => {
    if (trip.id !== DEFAULT_DEMO_TRIP_ID) {
      return trip;
    }

    hasDemoTrip = true;
    return mergeDemoTrip(freshDemoTrip, trip);
  });

  return hasDemoTrip ? refreshedTrips : [...refreshedTrips, freshDemoTrip];
}

export function normalizeFriendFlightLeg(
  input: Partial<FriendFlightLeg> | null | undefined,
  friendIndex = 0,
  legIndex = 0,
): FriendFlightLeg {
  const flightNumber = normalizeFriendFlightIdentifier(input?.flightNumber ?? null);
  const resolvedIcao24 = normalizeFriendFlightIdentifier(input?.resolvedIcao24 ?? null);

  return {
    id: typeof input?.id === 'string' && input.id.trim() ? input.id.trim() : getFallbackId('leg', friendIndex, legIndex),
    flightNumber,
    departureTime: normalizeDateTime(input?.departureTime),
    arrivalTime: normalizeDateTime(input?.arrivalTime) || null,
    departureTimezone: normalizeOptionalText(input?.departureTimezone),
    from: normalizeOptionalText(input?.from),
    to: normalizeOptionalText(input?.to),
    note: normalizeOptionalText(input?.note),
    resolvedIcao24: resolvedIcao24 || null,
    lastResolvedAt: typeof input?.lastResolvedAt === 'number' && Number.isFinite(input.lastResolvedAt)
      ? input.lastResolvedAt
      : null,
    validatedFlight: normalizeFriendFlightValidationSnapshot(input?.validatedFlight),
  };
}

export function normalizeFriendConfig(
  input: Partial<FriendTravelConfig> | null | undefined,
  friendIndex = 0,
): FriendTravelConfig {
  const flights = Array.isArray(input?.flights)
    ? input.flights.map((leg, legIndex) => normalizeFriendFlightLeg(leg, friendIndex, legIndex))
    : [];
  const id = typeof input?.id === 'string' && input.id.trim() ? input.id.trim() : getFallbackId('friend', friendIndex);
  const name = typeof input?.name === 'string' && input.name.trim() ? input.name.trim() : `Friend ${friendIndex + 1}`;

  return {
    id,
    name,
    avatarUrl: typeof input?.avatarUrl === 'string' && input.avatarUrl ? input.avatarUrl : null,
    color: normalizeConfiguredFriendColor(input?.color),
    colorOverride: normalizeConfiguredFriendColor(input?.colorOverride),
    currentAirport: normalizeOptionalText(input?.currentAirport),
    flights,
  };
}

export function normalizeFriendsTrackerTripConfig(
  input: Partial<FriendsTrackerTripConfig> | null | undefined,
  tripIndex = 0,
  fallbackName?: string,
): FriendsTrackerTripConfig {
  const baseFriends = Array.isArray(input?.friends)
    ? input.friends.map((friend, friendIndex) => normalizeFriendConfig(friend, friendIndex))
    : [];
  const friends = assignAutoFriendColors(baseFriends);

  return {
    id: typeof input?.id === 'string' && input.id.trim() ? input.id.trim() : getFallbackId('trip', tripIndex),
    name: typeof input?.name === 'string' && input.name.trim() ? input.name.trim() : (fallbackName ?? `Trip ${tripIndex + 1}`),
    destinationAirport: normalizeOptionalText(input?.destinationAirport),
    friends,
    isDemo: typeof input?.isDemo === 'boolean' ? input.isDemo : false,
  };
}

export function getCurrentTripConfig(config: FriendsTrackerConfig): FriendsTrackerTripConfig | null {
  const currentTripId = normalizeOptionalText(config.currentTripId);
  const trips = config.trips ?? [];

  return trips.find((trip) => trip.id === currentTripId)
    ?? trips.find((trip) => !trip.isDemo)
    ?? trips[0]
    ?? null;
}

export function normalizeFriendsTrackerConfig(
  input: Partial<FriendsTrackerConfig> | null | undefined,
  options?: { demoReferenceTime?: number },
): NormalizedFriendsTrackerConfig {
  const normalizedTrips = Array.isArray(input?.trips) && input.trips.length > 0
    ? input.trips.map((trip, tripIndex) => normalizeFriendsTrackerTripConfig(trip, tripIndex))
    : (() => {
      const legacyTrip = normalizeFriendsTrackerTripConfig({
        id: 'primary-trip',
        name: 'Main trip',
        destinationAirport: input?.destinationAirport,
        friends: Array.isArray(input?.friends) ? input.friends : [],
      }, 0, 'Main trip');

      return legacyTrip.destinationAirport || legacyTrip.friends.length > 0
        ? [legacyTrip]
        : [];
    })();

  const trips = ensureDemoTrip(normalizedTrips, options?.demoReferenceTime);
  const requestedCurrentTripId = normalizeOptionalText(input?.currentTripId);
  const currentTrip = trips.find((trip) => trip.id === requestedCurrentTripId)
    ?? trips.find((trip) => !trip.isDemo)
    ?? trips[0]
    ?? null;

  const airportTimezones = input?.airportTimezones && typeof input.airportTimezones === 'object' && !Array.isArray(input.airportTimezones)
    ? Object.fromEntries(
      Object.entries(input.airportTimezones)
        .filter((entry): entry is [string, string] => typeof entry[0] === 'string' && Boolean(entry[0].trim()) && typeof entry[1] === 'string' && Boolean(entry[1].trim()))
        .map(([code, timezone]) => [code.trim().toUpperCase(), timezone.trim()]),
    )
    : {};

  return {
    updatedAt: typeof input?.updatedAt === 'number' && Number.isFinite(input.updatedAt) ? input.updatedAt : null,
    updatedBy: normalizeOptionalText(input?.updatedBy),
    cronEnabled: typeof input?.cronEnabled === 'boolean' ? input.cronEnabled : true,
    currentTripId: currentTrip?.id ?? null,
    trips,
    destinationAirport: currentTrip?.destinationAirport ?? null,
    airportTimezones,
    friends: currentTrip?.friends ?? [],
  };
}

export function extractFriendTrackerIdentifiers(config: FriendsTrackerConfig): string[] {
  const friends = getCurrentTripConfig(config)?.friends ?? config.friends;

  return Array.from(
    new Set(
      friends.flatMap((friend) => friend.flights)
        .map((leg) => normalizeFriendFlightIdentifier(leg.resolvedIcao24 || leg.flightNumber))
        .filter(Boolean),
    ),
  );
}

function updateCurrentTripInConfig(
  config: FriendsTrackerConfig,
  updater: (trip: FriendsTrackerTripConfig) => FriendsTrackerTripConfig,
): NormalizedFriendsTrackerConfig {
  const currentTrip = getCurrentTripConfig(config);
  if (!currentTrip) {
    return normalizeFriendsTrackerConfig(config);
  }

  return normalizeFriendsTrackerConfig({
    ...config,
    currentTripId: currentTrip.id,
    trips: (config.trips ?? []).map((trip) => trip.id === currentTrip.id ? updater(trip) : trip),
  });
}

export function buildFriendFlightLabel(friend: FriendTravelConfig, _leg: FriendFlightLeg, legIndex: number): string {
  return friend.name.trim() || `Friend ${legIndex + 1}`;
}

function doesFlightMatchIdentifier(flight: TrackedFlight, identifier: string): boolean {
  if (!identifier) {
    return false;
  }

  const normalizedCallsign = normalizeFriendFlightIdentifier(flight.callsign);
  const normalizedFlightNumber = normalizeFriendFlightIdentifier(flight.flightNumber ?? null);
  const normalizedMatchedBy = (flight.matchedBy ?? []).map((value) => normalizeFriendFlightIdentifier(value));

  return normalizedCallsign === identifier
    || normalizedFlightNumber === identifier
    || normalizedMatchedBy.includes(identifier);
}

export function findMatchingTrackedFlightsForLeg(
  flights: TrackedFlight[],
  leg: FriendFlightLeg,
  now = Date.now(),
): TrackedFlight[] {
  const lockedIcao24 = normalizeFriendFlightIdentifier(leg.resolvedIcao24);
  if (lockedIcao24) {
    return flights
      .filter((flight) => normalizeFriendFlightIdentifier(flight.icao24) === lockedIcao24)
      .filter((flight) => isFlightTimingPlausibleForLeg(flight, leg, now, { isLockedMatch: true }));
  }

  const normalizedFlightNumber = normalizeFriendFlightIdentifier(leg.flightNumber);
  if (!normalizedFlightNumber) {
    return [];
  }

  const scheduledTime = Date.parse(leg.departureTime);
  const matchingFlights = flights
    .filter((flight) => doesFlightMatchIdentifier(flight, normalizedFlightNumber))
    .filter((flight) => isFlightTimingPlausibleForLeg(flight, leg, now));

  return [...matchingFlights].sort((left, right) => {
    const leftReferenceTime = resolveFlightReferenceTimeMs(left);
    const rightReferenceTime = resolveFlightReferenceTimeMs(right);
    const leftPenalty = Number.isFinite(scheduledTime) && leftReferenceTime != null
      ? Math.abs(leftReferenceTime - scheduledTime)
      : Number.POSITIVE_INFINITY;
    const rightPenalty = Number.isFinite(scheduledTime) && rightReferenceTime != null
      ? Math.abs(rightReferenceTime - scheduledTime)
      : Number.POSITIVE_INFINITY;

    if (leftPenalty !== rightPenalty) {
      return leftPenalty - rightPenalty;
    }

    const leftUsedSources = (left.sourceDetails ?? []).filter((detail) => detail.usedInResult).length;
    const rightUsedSources = (right.sourceDetails ?? []).filter((detail) => detail.usedInResult).length;
    return rightUsedSources - leftUsedSources;
  });
}

export function findMatchingTrackedFlightForLeg(
  flights: TrackedFlight[],
  leg: FriendFlightLeg,
  now = Date.now(),
): TrackedFlight | null {
  return findMatchingTrackedFlightsForLeg(flights, leg, now)[0] ?? null;
}

function toValidationSnapshotDateTime(value: number | null | undefined): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  const timestampMs = value > 1_000_000_000_000 ? value : value * 1000;
  return new Date(timestampMs).toISOString();
}

function buildValidationRouteSummary(
  departureAirport: string | null,
  arrivalAirport: string | null,
): string | null {
  return departureAirport || arrivalAirport
    ? `${departureAirport ?? '???'} → ${arrivalAirport ?? '???'}`
    : null;
}

function choosePreferredValidationProviderSnapshot(
  snapshots: FriendFlightValidationProviderSnapshot[],
): FriendFlightValidationProviderSnapshot | null {
  let preferredSnapshot: FriendFlightValidationProviderSnapshot | null = null;
  let preferredScore = Number.NEGATIVE_INFINITY;

  for (const snapshot of snapshots) {
    let score = snapshot.status === 'matched' ? 100 : snapshot.status === 'warning' ? 80 : 0;
    if (snapshot.matchedIcao24) {
      score += 20;
    }
    if (snapshot.matchedFlightNumber) {
      score += 10;
    }
    if (snapshot.departureDeltaMinutes != null) {
      score += Math.max(0, 30 - Math.abs(snapshot.departureDeltaMinutes));
    }

    if (score > preferredScore) {
      preferredScore = score;
      preferredSnapshot = snapshot;
    }
  }

  return preferredSnapshot;
}

function buildValidationProviderSnapshotsForFlight(
  leg: FriendFlightLeg,
  flight: TrackedFlight,
  lastCheckedAt: number,
): FriendFlightValidationProviderSnapshot[] {
  const matchedIcao24 = normalizeFriendFlightIdentifier(flight.aircraft?.icao24 ?? flight.icao24) || null;
  const matchedFlightNumber = resolveSuggestedFlightNumber(
    leg.resolvedIcao24 || leg.flightNumber,
    flight.flightNumber ?? flight.callsign ?? null,
  ) || null;
  const matchedDepartureTime = toValidationSnapshotDateTime(flight.route.firstSeen);
  const matchedArrivalTime = toValidationSnapshotDateTime(flight.route.lastSeen);
  const matchedDepartureAirport = normalizeOptionalText(flight.route.departureAirport)?.toUpperCase() ?? null;
  const matchedArrivalAirport = normalizeOptionalText(flight.route.arrivalAirport)?.toUpperCase() ?? null;
  const matchedRoute = buildValidationRouteSummary(matchedDepartureAirport, matchedArrivalAirport);
  const scheduledDepartureTimeMs = Date.parse(leg.departureTime);
  const matchedDepartureTimeMs = matchedDepartureTime ? Date.parse(matchedDepartureTime) : Number.NaN;
  const departureDeltaMinutes = Number.isFinite(scheduledDepartureTimeMs) && Number.isFinite(matchedDepartureTimeMs)
    ? Math.round((matchedDepartureTimeMs - scheduledDepartureTimeMs) / (1000 * 60))
    : null;
  const status: FriendFlightValidationStatus = departureDeltaMinutes != null && Math.abs(departureDeltaMinutes) > 180
    ? 'warning'
    : 'matched';

  const sharedFields = {
    status,
    matchedIcao24,
    matchedFlightNumber,
    matchedDepartureTime,
    matchedArrivalTime,
    matchedDepartureAirport,
    matchedArrivalAirport,
    matchedRoute,
    departureDeltaMinutes,
    lastCheckedAt,
  } satisfies FriendFlightValidationProviderSnapshot;

  const usedSourceDetails = (flight.sourceDetails ?? []).filter((detail) => detail.usedInResult && detail.status === 'used');

  if (usedSourceDetails.length === 0) {
    const fallbackProviderLabel = flight.dataSource === 'hybrid'
      ? 'Tracker search'
      : (flight.dataSource === 'opensky'
          || flight.dataSource === 'flightaware'
          || flight.dataSource === 'aviationstack'
          || flight.dataSource === 'airlabs'
          || flight.dataSource === 'aerodatabox')
        ? resolveValidationProviderLabel(flight.dataSource)
        : null;

    return [{
      ...sharedFields,
      providerLabel: fallbackProviderLabel ?? 'Tracker search',
      message: 'Tracker search confirmed a matching flight for this leg during the scheduled enrichment run.',
    }];
  }

  return usedSourceDetails.map((detail) => ({
    ...sharedFields,
    providerLabel: resolveValidationProviderLabel(detail.source) ?? 'Tracker search',
    message: normalizeOptionalText(detail.reason) ?? 'Provider matched this scheduled leg.',
  }));
}

function extractPersistedValidationProviderMatches(
  snapshot: FriendFlightValidationSnapshot | null | undefined,
): FriendFlightValidationProviderSnapshot[] {
  const normalizedSnapshot = normalizeFriendFlightValidationSnapshot(snapshot);
  if (!normalizedSnapshot) {
    return [];
  }

  if (Array.isArray(normalizedSnapshot.providerMatches) && normalizedSnapshot.providerMatches.length > 0) {
    return normalizedSnapshot.providerMatches;
  }

  const fallbackSnapshot = normalizeFriendFlightValidationProviderSnapshot(normalizedSnapshot);
  return fallbackSnapshot ? [fallbackSnapshot] : [];
}

function buildAutoValidationSnapshotForLeg(
  leg: FriendFlightLeg,
  matchingFlights: TrackedFlight[],
  now = Date.now(),
): FriendFlightValidationSnapshot | null {
  const providerMatches = dedupeFriendFlightValidationProviderSnapshots(
    matchingFlights.flatMap((flight) => buildValidationProviderSnapshotsForFlight(leg, flight, now)),
  );
  const preferredSnapshot = choosePreferredValidationProviderSnapshot(providerMatches);

  if (!preferredSnapshot) {
    return null;
  }

  const providerLabels = Array.from(new Set(
    providerMatches
      .map((snapshot) => normalizeOptionalText(snapshot.providerLabel))
      .filter((value): value is string => Boolean(value)),
  ));
  const providerLabel = providerLabels.join(' + ') || preferredSnapshot.providerLabel || null;
  const resolvedIdentifier = resolveSuggestedFlightNumber(leg.flightNumber, preferredSnapshot.matchedFlightNumber) || null;

  return {
    ...preferredSnapshot,
    status: providerMatches.some((snapshot) => snapshot.status === 'matched') ? 'matched' : preferredSnapshot.status,
    providerLabel,
    message: providerMatches.length > 1
      ? `${providerLabel ?? 'Tracker search'} matched ${(resolvedIdentifier || normalizeFriendFlightIdentifier(leg.flightNumber) || 'this leg')}. ${providerMatches.length} providers confirmed this leg.`
      : preferredSnapshot.message,
    matchedFlightNumber: resolvedIdentifier,
    providerMatches,
    lastCheckedAt: preferredSnapshot.lastCheckedAt ?? now,
  };
}

function mergeValidationSnapshots(
  existingSnapshot: FriendFlightValidationSnapshot | null | undefined,
  incomingSnapshot: FriendFlightValidationSnapshot,
  identifier: string,
): FriendFlightValidationSnapshot {
  const mergedProviderMatches = dedupeFriendFlightValidationProviderSnapshots([
    ...extractPersistedValidationProviderMatches(existingSnapshot),
    ...(incomingSnapshot.providerMatches ?? []),
  ]);
  const preferredSnapshot = choosePreferredValidationProviderSnapshot(mergedProviderMatches)
    ?? normalizeFriendFlightValidationProviderSnapshot(incomingSnapshot)
    ?? normalizeFriendFlightValidationProviderSnapshot(existingSnapshot)
    ?? incomingSnapshot;
  const providerLabels = Array.from(new Set(
    mergedProviderMatches
      .map((snapshot) => normalizeOptionalText(snapshot.providerLabel))
      .filter((value): value is string => Boolean(value)),
  ));
  const providerLabel = providerLabels.join(' + ')
    || normalizeOptionalText(incomingSnapshot.providerLabel)
    || normalizeOptionalText(existingSnapshot?.providerLabel)
    || null;
  const matchedFlightNumber = resolveSuggestedFlightNumber(
    identifier,
    preferredSnapshot.matchedFlightNumber ?? incomingSnapshot.matchedFlightNumber ?? existingSnapshot?.matchedFlightNumber ?? null,
  ) || null;

  return normalizeFriendFlightValidationSnapshot({
    ...existingSnapshot,
    ...incomingSnapshot,
    ...preferredSnapshot,
    status: preferredSnapshot.status ?? incomingSnapshot.status ?? existingSnapshot?.status ?? null,
    providerLabel,
    message: mergedProviderMatches.length > 1
      ? `${providerLabel ?? 'Tracker search'} matched ${(matchedFlightNumber || normalizeFriendFlightIdentifier(identifier) || 'this leg')}. ${mergedProviderMatches.length} providers confirmed this leg.`
      : preferredSnapshot.message ?? incomingSnapshot.message ?? existingSnapshot?.message ?? null,
    matchedFlightNumber,
    providerMatches: mergedProviderMatches,
    lastCheckedAt: incomingSnapshot.lastCheckedAt ?? existingSnapshot?.lastCheckedAt ?? Date.now(),
  }) ?? incomingSnapshot;
}

export function applyAutoValidatedFriendFlights(
  config: FriendsTrackerConfig,
  flights: TrackedFlight[],
  now = Date.now(),
): { config: NormalizedFriendsTrackerConfig; changed: boolean } {
  if (flights.length === 0) {
    return { config: normalizeFriendsTrackerConfig(config), changed: false };
  }

  const airportTimezones = config.airportTimezones ?? {};
  let changed = false;
  const nextConfig = updateCurrentTripInConfig(config, (trip) => ({
    ...trip,
    friends: trip.friends.map((friend) => ({
      ...friend,
      flights: friend.flights.map((leg) => {
        const matchingFlights = findMatchingTrackedFlightsForLeg(flights, leg, now);
        if (matchingFlights.length === 0) {
          return leg;
        }

        const autoValidationSnapshot = buildAutoValidationSnapshotForLeg(leg, matchingFlights, now);
        if (!autoValidationSnapshot) {
          return leg;
        }

        const mergedValidation = mergeValidationSnapshots(leg.validatedFlight ?? null, autoValidationSnapshot, leg.flightNumber);
        const matchedFlightNumber = resolveSuggestedFlightNumber(leg.flightNumber, mergedValidation.matchedFlightNumber);
        const nextLeg: FriendFlightLeg = {
          ...leg,
          flightNumber: matchedFlightNumber || leg.flightNumber,
          departureTime: mergedValidation.matchedDepartureTime || leg.departureTime,
          arrivalTime: mergedValidation.matchedArrivalTime ?? leg.arrivalTime ?? null,
          departureTimezone: mergedValidation.matchedDepartureAirport
            ? airportTimezones[mergedValidation.matchedDepartureAirport] ?? leg.departureTimezone ?? null
            : leg.departureTimezone ?? null,
          from: mergedValidation.matchedDepartureAirport ?? leg.from ?? null,
          to: mergedValidation.matchedArrivalAirport ?? leg.to ?? null,
          resolvedIcao24: mergedValidation.matchedIcao24 ?? leg.resolvedIcao24 ?? null,
          lastResolvedAt: mergedValidation.matchedIcao24
            ? mergedValidation.lastCheckedAt ?? now
            : leg.lastResolvedAt ?? null,
          validatedFlight: mergedValidation,
        };

        const currentSnapshot = normalizeFriendFlightValidationSnapshot(leg.validatedFlight ?? null);
        const currentFingerprint = JSON.stringify({
          ...leg,
          validatedFlight: currentSnapshot,
        });
        const nextFingerprint = JSON.stringify({
          ...nextLeg,
          validatedFlight: normalizeFriendFlightValidationSnapshot(nextLeg.validatedFlight ?? null),
        });

        if (currentFingerprint === nextFingerprint) {
          return leg;
        }

        changed = true;
        return nextLeg;
      }),
    })),
  }));

  return {
    config: nextConfig,
    changed,
  };
}

export function shouldAutoLockFriendFlight(
  leg: FriendFlightLeg,
  flight: TrackedFlight | null,
  now = Date.now(),
): boolean {
  if (!flight || normalizeFriendFlightIdentifier(leg.resolvedIcao24)) {
    return false;
  }

  const scheduledTime = Date.parse(leg.departureTime);
  if (!Number.isFinite(scheduledTime)) {
    return true;
  }

  const referenceTime = resolveFlightReferenceTimeMs(flight) ?? now;
  const hoursFromSchedule = Math.abs(referenceTime - scheduledTime) / (1000 * 60 * 60);
  const timeSinceSchedule = now - scheduledTime;

  return hoursFromSchedule <= AUTO_LOCK_WINDOW_HOURS
    || (timeSinceSchedule >= 0 && timeSinceSchedule <= AUTO_LOCK_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
}

export function buildFriendFlightStatuses(
  config: FriendsTrackerConfig,
  flights: TrackedFlight[],
  now = Date.now(),
): FriendFlightStatus[] {
  return config.friends.flatMap((friend) => {
    return friend.flights.map((leg, legIndex) => {
      const matchedFlight = findMatchingTrackedFlightForLeg(flights, leg, now);
      const flight = matchedFlight && isTrackedFlightRelevantAtTime(matchedFlight, now)
        ? matchedFlight
        : null;
      const scheduledTime = Date.parse(leg.departureTime);

      return {
        friend,
        leg,
        flight,
        label: buildFriendFlightLabel(friend, leg, legIndex),
        canAutoLock: shouldAutoLockFriendFlight(leg, matchedFlight, now),
        status: flight
          ? 'matched'
          : (Number.isFinite(scheduledTime) && scheduledTime > now ? 'scheduled' : 'awaiting'),
      } satisfies FriendFlightStatus;
    });
  });
}

export function applyAutoLockedFriendFlights(
  config: FriendsTrackerConfig,
  flights: TrackedFlight[],
  now = Date.now(),
): { config: NormalizedFriendsTrackerConfig; changed: boolean } {
  const statuses = buildFriendFlightStatuses(config, flights, now);
  const lockedIcao24ByLegId = new Map(
    statuses
      .filter((status) => status.canAutoLock && status.flight)
      .map((status) => [status.leg.id, normalizeFriendFlightIdentifier(status.flight?.icao24)]),
  );

  if (lockedIcao24ByLegId.size === 0) {
    return { config: normalizeFriendsTrackerConfig(config), changed: false };
  }

  let changed = false;
  const nextConfig = updateCurrentTripInConfig(config, (trip) => ({
    ...trip,
    friends: trip.friends.map((friend) => ({
      ...friend,
      flights: friend.flights.map((leg) => {
        const lockedIcao24 = lockedIcao24ByLegId.get(leg.id);
        if (!lockedIcao24 || normalizeFriendFlightIdentifier(leg.resolvedIcao24) === lockedIcao24) {
          return leg;
        }

        changed = true;
        return {
          ...leg,
          resolvedIcao24: lockedIcao24,
          lastResolvedAt: now,
        } satisfies FriendFlightLeg;
      }),
    })),
  }));

  return {
    config: nextConfig,
    changed,
  };
}

/**
 * Builds the ordered list of unique airport codes from a sequence of flight legs.
 * Returns [leg[0].from, leg[0].to, leg[1].to, ...], skipping nulls and consecutive duplicates.
 */
export function buildAirportChain(legs: FriendFlightLeg[]): string[] {
  const airports: string[] = [];

  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];

    if (i === 0 && leg.from) {
      airports.push(leg.from.toUpperCase());
    }

    if (leg.to) {
      const normalized = leg.to.toUpperCase();
      if (airports[airports.length - 1] !== normalized) {
        airports.push(normalized);
      }
    }
  }

  return airports;
}

/**
 * Returns only the legs belonging to the friend's "current trip":
 * either the outbound journey (to the destination) or the return journey,
 * based on the destination airport and the current time.
 *
 * If no destination is configured, all legs are returned as-is.
 */
export function getCurrentTripLegs(
  friend: FriendTravelConfig,
  statuses: FriendFlightStatus[],
  destinationAirport: string | null,
  now = Date.now(),
): FriendFlightLeg[] {
  const legs = friend.flights;
  if (!legs.length) {
    return legs;
  }

  const sorted = [...legs].sort((a, b) => {
    const timeA = Date.parse(a.departureTime) || 0;
    const timeB = Date.parse(b.departureTime) || 0;
    return timeA - timeB;
  });

  const destinationAirports = parseDestinationAirportCodes(destinationAirport);
  if (destinationAirports.length === 0) {
    return sorted;
  }

  // Split sorted legs into trips: each trip ends when a leg arrives at any configured destination airport.
  const trips: FriendFlightLeg[][] = [];
  let currentTrip: FriendFlightLeg[] = [];

  for (const leg of sorted) {
    currentTrip.push(leg);

    const arrivalAirport = (leg.to ?? '').toUpperCase().trim();
    if (arrivalAirport && destinationAirports.includes(arrivalAirport)) {
      trips.push(currentTrip);
      currentTrip = [];
    }
  }

  if (currentTrip.length > 0) {
    trips.push(currentTrip);
  }

  if (trips.length <= 1) {
    return sorted;
  }

  // Priority 1: any trip containing a currently active matched leg.
  for (const trip of trips) {
    const hasActiveLeg = trip.some((leg) => {
      const status = statuses.find((st) => st.leg.id === leg.id);
      return isMatchedStatusActiveAtTime(status, now);
    });
    if (hasActiveLeg) {
      return trip;
    }
  }

  // Priority 2: first trip with at least one future leg.
  for (const trip of trips) {
    const hasUpcomingLeg = trip.some((leg) => {
      const dep = Date.parse(leg.departureTime);
      return !Number.isNaN(dep) && dep > now;
    });
    if (hasUpcomingLeg) {
      return trip;
    }
  }

  // All trips are in the past — show the most recent one.
  return trips[trips.length - 1] ?? sorted;
}
