import type { TrackedFlight } from '~/components/tracker/flight/types';

const AUTO_LOCK_WINDOW_HOURS = 36;
const AUTO_LOCK_LOOKBACK_DAYS = 7;
const FLIGHT_MATCH_WINDOW_HOURS = 36;
const DEMO_REFERENCE_BUCKET_MS = 15 * 60 * 1000;

export interface FriendFlightLeg {
  id: string;
  flightNumber: string;
  departureTime: string;
  departureTimezone?: string | null;
  from?: string | null;
  to?: string | null;
  note?: string | null;
  resolvedIcao24?: string | null;
  lastResolvedAt?: number | null;
}

export interface FriendTravelConfig {
  id: string;
  name: string;
  avatarUrl?: string | null;
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

function getFlightPointTimeMs(point: TrackedFlight['current'] | TrackedFlight['originPoint'] | null | undefined): number | null {
  return typeof point?.time === 'number' && Number.isFinite(point.time)
    ? point.time * 1000
    : null;
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
  if (status?.status !== 'matched' || !status.flight) {
    return false;
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

function isFlightTimingPlausibleForLeg(
  flight: TrackedFlight,
  leg: FriendFlightLeg,
  now = Date.now(),
): boolean {
  const scheduledTime = Date.parse(leg.departureTime);
  if (!Number.isFinite(scheduledTime)) {
    return true;
  }

  const matchWindowMs = FLIGHT_MATCH_WINDOW_HOURS * 60 * 60 * 1000;
  const referenceTime = resolveFlightReferenceTimeMs(flight);

  if (referenceTime != null) {
    return Math.abs(referenceTime - scheduledTime) <= matchWindowMs;
  }

  return Math.abs(now - scheduledTime) <= matchWindowMs;
}

export function normalizeFriendFlightIdentifier(value: string | null | undefined): string {
  return typeof value === 'string'
    ? value.replace(/\s+/g, '').trim().toUpperCase()
    : '';
}

export function createEmptyFriendFlightLeg(): FriendFlightLeg {
  return {
    id: '',
    flightNumber: '',
    departureTime: '',
    departureTimezone: null,
    from: null,
    to: null,
    note: null,
    resolvedIcao24: null,
    lastResolvedAt: null,
  };
}

const DEFAULT_DEMO_TRIP_ID = 'demo-test-trip';

export function createEmptyFriendConfig(): FriendTravelConfig {
  return {
    id: '',
    name: '',
    avatarUrl: null,
    flights: [createEmptyFriendFlightLeg()],
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
            flightNumber: 'KL641',
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
            flightNumber: 'UX1153',
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
            flightNumber: 'AF1840',
            departureTime: new Date(now + (7 * 60 * 60 * 1000)).toISOString(),
            from: 'FCO',
            to: 'CDG',
            note: 'Preset demo leg: future feeder flight to Paris.',
          },
          {
            id: 'demo-leg-6b',
            flightNumber: 'AF022',
            departureTime: new Date(now + (10 * 60 * 60 * 1000)).toISOString(),
            from: 'CDG',
            to: 'JFK',
            note: 'Preset demo leg: not started yet and still awaiting telemetry.',
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
      from: existingLeg.from ?? freshLeg.from,
      to: existingLeg.to ?? freshLeg.to,
      note: existingLeg.note ?? freshLeg.note,
      resolvedIcao24: existingLeg.resolvedIcao24 ?? freshLeg.resolvedIcao24,
      lastResolvedAt: existingLeg.lastResolvedAt ?? freshLeg.lastResolvedAt,
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
  const freshDemoTrip = buildDefaultDemoTrip(getDemoReferenceTime(demoReferenceTime));
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
    departureTimezone: normalizeOptionalText(input?.departureTimezone),
    from: normalizeOptionalText(input?.from),
    to: normalizeOptionalText(input?.to),
    note: normalizeOptionalText(input?.note),
    resolvedIcao24: resolvedIcao24 || null,
    lastResolvedAt: typeof input?.lastResolvedAt === 'number' && Number.isFinite(input.lastResolvedAt)
      ? input.lastResolvedAt
      : null,
  };
}

export function normalizeFriendConfig(
  input: Partial<FriendTravelConfig> | null | undefined,
  friendIndex = 0,
): FriendTravelConfig {
  const flights = Array.isArray(input?.flights)
    ? input.flights.map((leg, legIndex) => normalizeFriendFlightLeg(leg, friendIndex, legIndex))
    : [normalizeFriendFlightLeg(null, friendIndex, 0)];

  return {
    id: typeof input?.id === 'string' && input.id.trim() ? input.id.trim() : getFallbackId('friend', friendIndex),
    name: typeof input?.name === 'string' && input.name.trim() ? input.name.trim() : `Friend ${friendIndex + 1}`,
    avatarUrl: typeof input?.avatarUrl === 'string' && input.avatarUrl ? input.avatarUrl : null,
    flights,
  };
}

export function normalizeFriendsTrackerTripConfig(
  input: Partial<FriendsTrackerTripConfig> | null | undefined,
  tripIndex = 0,
  fallbackName?: string,
): FriendsTrackerTripConfig {
  const friends = Array.isArray(input?.friends)
    ? input.friends.map((friend, friendIndex) => normalizeFriendConfig(friend, friendIndex))
    : [];

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
    || normalizedMatchedBy.includes(identifier)
    || normalizedCallsign.includes(identifier)
    || normalizedMatchedBy.some((value) => value.includes(identifier));
}

export function findMatchingTrackedFlightForLeg(
  flights: TrackedFlight[],
  leg: FriendFlightLeg,
  now = Date.now(),
): TrackedFlight | null {
  const lockedIcao24 = normalizeFriendFlightIdentifier(leg.resolvedIcao24);
  if (lockedIcao24) {
    const lockedMatch = flights.find((flight) => normalizeFriendFlightIdentifier(flight.icao24) === lockedIcao24) ?? null;
    return lockedMatch && isFlightTimingPlausibleForLeg(lockedMatch, leg, now)
      ? lockedMatch
      : null;
  }

  const normalizedFlightNumber = normalizeFriendFlightIdentifier(leg.flightNumber);
  if (!normalizedFlightNumber) {
    return null;
  }

  const scheduledTime = Date.parse(leg.departureTime);
  const matchingFlights = flights
    .filter((flight) => doesFlightMatchIdentifier(flight, normalizedFlightNumber))
    .filter((flight) => isFlightTimingPlausibleForLeg(flight, leg, now));
  if (matchingFlights.length <= 1) {
    return matchingFlights[0] ?? null;
  }

  let bestMatch: TrackedFlight | null = matchingFlights[0] ?? null;
  let bestPenalty = Number.POSITIVE_INFINITY;

  for (const flight of matchingFlights) {
    const referenceTime = resolveFlightReferenceTimeMs(flight);
    const timePenalty = Number.isFinite(scheduledTime) && referenceTime != null
      ? Math.abs(referenceTime - scheduledTime) / (1000 * 60 * 60)
      : 0;

    if (timePenalty < bestPenalty) {
      bestPenalty = timePenalty;
      bestMatch = flight;
    }
  }

  return bestMatch;
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
