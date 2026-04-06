import type { TrackedFlight } from '~/components/tracker/flight/types';

const AUTO_LOCK_WINDOW_HOURS = 36;
const AUTO_LOCK_LOOKBACK_DAYS = 7;

export interface FriendFlightLeg {
  id: string;
  flightNumber: string;
  departureTime: string;
  from?: string | null;
  to?: string | null;
  note?: string | null;
  resolvedIcao24?: string | null;
  lastResolvedAt?: number | null;
}

export interface FriendTravelConfig {
  id: string;
  name: string;
  flights: FriendFlightLeg[];
}

export interface FriendsTrackerConfig {
  updatedAt: number | null;
  updatedBy: string | null;
  friends: FriendTravelConfig[];
}

export interface FriendFlightStatus {
  friend: FriendTravelConfig;
  leg: FriendFlightLeg;
  flight: TrackedFlight | null;
  label: string;
  canAutoLock: boolean;
  status: 'matched' | 'scheduled' | 'awaiting';
}

function normalizeOptionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
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
    from: null,
    to: null,
    note: null,
    resolvedIcao24: null,
    lastResolvedAt: null,
  };
}

export function createEmptyFriendConfig(): FriendTravelConfig {
  return {
    id: '',
    name: '',
    flights: [createEmptyFriendFlightLeg()],
  };
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
    flights,
  };
}

export function normalizeFriendsTrackerConfig(
  input: Partial<FriendsTrackerConfig> | null | undefined,
): FriendsTrackerConfig {
  return {
    updatedAt: typeof input?.updatedAt === 'number' && Number.isFinite(input.updatedAt) ? input.updatedAt : null,
    updatedBy: normalizeOptionalText(input?.updatedBy),
    friends: Array.isArray(input?.friends)
      ? input.friends.map((friend, friendIndex) => normalizeFriendConfig(friend, friendIndex))
      : [],
  };
}

export function extractFriendTrackerIdentifiers(config: FriendsTrackerConfig): string[] {
  return Array.from(
    new Set(
      config.friends.flatMap((friend) => friend.flights)
        .map((leg) => normalizeFriendFlightIdentifier(leg.resolvedIcao24 || leg.flightNumber))
        .filter(Boolean),
    ),
  );
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
): TrackedFlight | null {
  const lockedIcao24 = normalizeFriendFlightIdentifier(leg.resolvedIcao24);
  if (lockedIcao24) {
    return flights.find((flight) => normalizeFriendFlightIdentifier(flight.icao24) === lockedIcao24) ?? null;
  }

  const normalizedFlightNumber = normalizeFriendFlightIdentifier(leg.flightNumber);
  if (!normalizedFlightNumber) {
    return null;
  }

  const scheduledTime = Date.parse(leg.departureTime);
  const matchingFlights = flights.filter((flight) => doesFlightMatchIdentifier(flight, normalizedFlightNumber));
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
      const flight = findMatchingTrackedFlightForLeg(flights, leg);
      const scheduledTime = Date.parse(leg.departureTime);

      return {
        friend,
        leg,
        flight,
        label: buildFriendFlightLabel(friend, leg, legIndex),
        canAutoLock: shouldAutoLockFriendFlight(leg, flight, now),
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
): { config: FriendsTrackerConfig; changed: boolean } {
  const statuses = buildFriendFlightStatuses(config, flights, now);
  const lockedIcao24ByLegId = new Map(
    statuses
      .filter((status) => status.canAutoLock && status.flight)
      .map((status) => [status.leg.id, normalizeFriendFlightIdentifier(status.flight?.icao24)]),
  );

  if (lockedIcao24ByLegId.size === 0) {
    return { config, changed: false };
  }

  let changed = false;
  const nextConfig = normalizeFriendsTrackerConfig({
    ...config,
    friends: config.friends.map((friend) => ({
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
  });

  return {
    config: nextConfig,
    changed,
  };
}
