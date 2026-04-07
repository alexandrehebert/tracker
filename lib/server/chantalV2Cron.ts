import 'server-only';

import {
  buildFriendFlightStatuses,
  extractFriendTrackerIdentifiers,
  findMatchingTrackedFlightForLeg,
  getCurrentTripConfig,
  normalizeFriendsTrackerConfig,
  type FriendFlightStatus,
  type FriendTravelConfig,
} from '~/lib/friendsTracker';
import type { TrackedFlight } from '~/components/tracker/flight/types';
import type { ChantalFriendPosition, ChantalPositionSnapshot, ChantalV2CronResult } from '~/lib/chantalV2';
import { readFriendsTrackerConfig } from './friendsTracker';
import { searchFlights } from './opensky';
import { savePositionSnapshot } from './chantalV2Snapshots';

let cronRunSequence = 0;

function normalizeIdentifier(value: string): string {
  return value.replace(/\s+/g, '').trim().toUpperCase();
}

/**
 * Picks the most relevant flight status for a single friend.
 *
 * Priority:
 * 1. A matched, airborne flight (newest last-contact wins if multiple).
 * 2. A matched, on-ground flight.
 * 3. A scheduled upcoming flight.
 * 4. The most recently departed leg.
 */
function pickPreferredFriendStatus(
  statuses: FriendFlightStatus[],
  now: number,
): FriendFlightStatus | null {
  if (statuses.length === 0) {
    return null;
  }

  // Matched + airborne
  const airborne = statuses.filter((s) => s.status === 'matched' && s.flight && !s.flight.onGround);
  if (airborne.length > 0) {
    return airborne.reduce<FriendFlightStatus | null>((best, s) => {
      if (!best) return s;
      const aBest = (best.flight?.lastContact ?? 0);
      const aCurr = (s.flight?.lastContact ?? 0);
      return aCurr >= aBest ? s : best;
    }, null);
  }

  // Matched + on-ground
  const onGround = statuses.filter((s) => s.status === 'matched' && s.flight?.onGround);
  if (onGround.length > 0) {
    return onGround.reduce<FriendFlightStatus | null>((best, s) => {
      if (!best) return s;
      const aBest = (best.flight?.lastContact ?? 0);
      const aCurr = (s.flight?.lastContact ?? 0);
      return aCurr >= aBest ? s : best;
    }, null);
  }

  // Scheduled future
  const scheduled = statuses
    .map((s) => ({ s, t: Date.parse(s.leg.departureTime) }))
    .filter(({ s, t }) => s.status === 'scheduled' && Number.isFinite(t) && t > now)
    .sort((a, b) => a.t - b.t);
  if (scheduled.length > 0) {
    return scheduled[0]!.s;
  }

  // Awaiting / most recently departed
  const past = statuses
    .map((s) => ({ s, t: Date.parse(s.leg.departureTime) }))
    .filter(({ t }) => Number.isFinite(t))
    .sort((a, b) => b.t - a.t);
  if (past.length > 0) {
    return past[0]!.s;
  }

  return statuses[0] ?? null;
}

function buildFriendPosition(
  friend: FriendTravelConfig,
  status: FriendFlightStatus | null,
  now: number,
): ChantalFriendPosition {
  if (!status) {
    return {
      friendId: friend.id,
      friendName: friend.name,
      avatarUrl: friend.avatarUrl ?? null,
      status: 'awaiting',
      latitude: null,
      longitude: null,
      altitude: null,
      heading: null,
      onGround: false,
      flightNumber: null,
      fromAirport: null,
      toAirport: null,
      lastContactAt: null,
    };
  }

  const flight: TrackedFlight | null = status.flight ?? null;
  const leg = status.leg;

  // Resolve position from the matched flight.
  const currentPoint = flight?.current ?? flight?.track.at(-1) ?? flight?.rawTrack?.at(-1) ?? null;

  const fromAirport = leg.from
    ?? (flight?.route.departureAirport ?? null);
  const toAirport = leg.to
    ?? (flight?.route.arrivalAirport ?? null);

  // Determine status label.
  let positionStatus: ChantalFriendPosition['status'];
  if (status.status === 'matched' && flight) {
    positionStatus = flight.onGround ? 'on-ground' : 'airborne';
  } else if (status.status === 'scheduled') {
    const dep = Date.parse(leg.departureTime);
    positionStatus = Number.isFinite(dep) && dep > now ? 'scheduled' : 'awaiting';
  } else {
    positionStatus = 'awaiting';
  }

  return {
    friendId: friend.id,
    friendName: friend.name,
    avatarUrl: friend.avatarUrl ?? null,
    status: positionStatus,
    latitude: currentPoint?.latitude ?? null,
    longitude: currentPoint?.longitude ?? null,
    altitude: currentPoint?.altitude ?? null,
    heading: currentPoint?.heading ?? flight?.heading ?? null,
    onGround: flight?.onGround ?? false,
    flightNumber: flight?.flightNumber || leg.flightNumber || null,
    fromAirport: typeof fromAirport === 'string' && fromAirport.trim() ? fromAirport.trim().toUpperCase() : null,
    toAirport: typeof toAirport === 'string' && toAirport.trim() ? toAirport.trim().toUpperCase() : null,
    lastContactAt: flight?.lastContact ?? null,
  };
}

export async function runChantalV2CronJob(): Promise<ChantalV2CronResult> {
  cronRunSequence++;
  const capturedAt = Date.now();
  const snapshotId = `chantal-v2-snapshot:${capturedAt}:${Math.random().toString(36).slice(2, 8)}`;

  try {
    const rawConfig = await readFriendsTrackerConfig();
    const config = normalizeFriendsTrackerConfig(rawConfig);
    const currentTrip = getCurrentTripConfig(config);

    if (!currentTrip) {
      return {
        success: false,
        snapshotId: null,
        capturedAt,
        friendCount: 0,
        positionsResolved: 0,
        error: 'No active trip configured.',
      };
    }

    const friends = currentTrip.friends;
    if (friends.length === 0) {
      return {
        success: false,
        snapshotId: null,
        capturedAt,
        friendCount: 0,
        positionsResolved: 0,
        error: 'No friends in the current trip.',
      };
    }

    // Collect all flight identifiers for the current trip.
    const identifiers = Array.from(
      new Set(
        extractFriendTrackerIdentifiers(config)
          .map(normalizeIdentifier)
          .filter(Boolean),
      ),
    );

    // Fetch (from cache or live) each identifier's flight data.
    const searchResults = await Promise.allSettled(
      identifiers.map((id) => searchFlights(id, { forceRefresh: false })),
    );

    const allFlights: TrackedFlight[] = [];
    const seenIcao24 = new Set<string>();

    for (const result of searchResults) {
      if (result.status === 'fulfilled') {
        for (const flight of result.value.flights) {
          if (!seenIcao24.has(flight.icao24)) {
            seenIcao24.add(flight.icao24);
            allFlights.push(flight);
          }
        }
      }
    }

    const now = Date.now();
    const statuses = buildFriendFlightStatuses(config, allFlights, now);

    const positions: ChantalFriendPosition[] = friends.map((friend) => {
      const friendStatuses = statuses.filter((s) => s.friend.id === friend.id);
      const preferred = pickPreferredFriendStatus(friendStatuses, now);
      return buildFriendPosition(friend, preferred, now);
    });

    const snapshot: ChantalPositionSnapshot = {
      id: snapshotId,
      capturedAt,
      tripId: currentTrip.id,
      tripName: currentTrip.name,
      positions,
    };

    await savePositionSnapshot(snapshot);

    const positionsResolved = positions.filter((p) => p.latitude != null && p.longitude != null).length;

    return {
      success: true,
      snapshotId,
      capturedAt,
      friendCount: friends.length,
      positionsResolved,
      error: null,
    };
  } catch (error) {
    return {
      success: false,
      snapshotId: null,
      capturedAt,
      friendCount: 0,
      positionsResolved: 0,
      error: error instanceof Error ? error.message : 'Unexpected error in Chantal V2 cron.',
    };
  }
}
