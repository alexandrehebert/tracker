import type { FriendTravelConfig, FriendsTrackerTripConfig } from '~/lib/friendsTracker';

// ---------------------------------------------------------------------------
// V2 core types
// ---------------------------------------------------------------------------

export type ChantalFriendPositionStatus = 'airborne' | 'on-ground' | 'awaiting' | 'scheduled';

export interface ChantalFriendPosition {
  friendId: string;
  friendName: string;
  avatarUrl: string | null;
  /** Flight status at the moment of this snapshot. */
  status: ChantalFriendPositionStatus;
  /** Geographic coordinates – null when position is unknown. */
  latitude: number | null;
  longitude: number | null;
  altitude: number | null;
  heading: number | null;
  onGround: boolean;
  /** Active flight leg context (used to draw the route on the map). */
  flightNumber: string | null;
  fromAirport: string | null;
  toAirport: string | null;
  /** Unix seconds – last contact time from the live tracking provider. */
  lastContactAt: number | null;
}

export interface ChantalPositionSnapshot {
  id: string;
  /** Unix ms – when this snapshot was captured. */
  capturedAt: number;
  tripId: string;
  tripName: string;
  positions: ChantalFriendPosition[];
}

// ---------------------------------------------------------------------------
// API response types
// ---------------------------------------------------------------------------

export interface ChantalV2SnapshotsResponse {
  /** The latest (or most-recent) snapshot, null if none saved yet. */
  latest: ChantalPositionSnapshot | null;
  /** Ordered list of snapshot capturedAt timestamps (ms, newest first). */
  snapshotTimestamps: number[];
}

export interface ChantalV2CronResult {
  success: boolean;
  snapshotId: string | null;
  capturedAt: number | null;
  friendCount: number;
  positionsResolved: number;
  error: string | null;
}

// ---------------------------------------------------------------------------
// V2 demo trip data
// ---------------------------------------------------------------------------

const DEMO_V2_TRIP_ID = 'demo-v2-global-meetup';
const DEMO_REFERENCE_BUCKET_MS = 15 * 60 * 1000;

function getDemoV2ReferenceTime(now = Date.now()): number {
  return Math.floor(now / DEMO_REFERENCE_BUCKET_MS) * DEMO_REFERENCE_BUCKET_MS;
}

/**
 * Builds the V2 demo trip: 7 friends flying from 7 different continents/regions
 * to a meeting in Tokyo (NRT), then returning home.
 *
 * Departure times are set relative to `now` so the demo is always "in progress":
 * most friends are currently somewhere en-route.
 */
export function buildDefaultDemoV2Trip(now = getDemoV2ReferenceTime()): FriendsTrackerTripConfig {
  const h = (hours: number) => hours * 60 * 60 * 1000;

  return {
    id: DEMO_V2_TRIP_ID,
    name: 'Global Meetup – Tokyo',
    destinationAirport: 'NRT',
    isDemo: true,
    friends: [
      // 1. Alice — London (LHR) → Tokyo (NRT), direct 12 h; return NRT → LHR
      {
        id: 'demo-v2-friend-1',
        name: 'Alice (London)',
        avatarUrl: null,
        flights: [
          {
            id: 'demo-v2-leg-1a',
            flightNumber: 'BA006',
            departureTime: new Date(now - h(6)).toISOString(),
            from: 'LHR',
            to: 'NRT',
            note: 'Direct LHR → NRT – mid-flight over Eurasia.',
          },
          {
            id: 'demo-v2-leg-1b',
            flightNumber: 'BA007',
            departureTime: new Date(now + h(60)).toISOString(),
            from: 'NRT',
            to: 'LHR',
            note: 'Return NRT → LHR – 3 days later.',
          },
        ],
      },

      // 2. Bruno — São Paulo (GRU) → Los Angeles (LAX) → Tokyo (NRT); return NRT → GRU
      {
        id: 'demo-v2-friend-2',
        name: 'Bruno (São Paulo)',
        avatarUrl: null,
        flights: [
          {
            id: 'demo-v2-leg-2a',
            flightNumber: 'UA837',
            departureTime: new Date(now - h(14)).toISOString(),
            from: 'GRU',
            to: 'LAX',
            note: 'GRU → LAX feeder leg – already arrived in Los Angeles.',
          },
          {
            id: 'demo-v2-leg-2b',
            flightNumber: 'NH106',
            departureTime: new Date(now - h(4)).toISOString(),
            from: 'LAX',
            to: 'NRT',
            note: 'LAX → NRT – currently flying across the Pacific.',
          },
          {
            id: 'demo-v2-leg-2c',
            flightNumber: 'NH105',
            departureTime: new Date(now + h(60)).toISOString(),
            from: 'NRT',
            to: 'GRU',
            note: 'Return NRT → GRU (direct).',
          },
        ],
      },

      // 3. Chloe — Sydney (SYD) → Tokyo (NRT), direct 9 h; return NRT → SYD
      {
        id: 'demo-v2-friend-3',
        name: 'Chloe (Sydney)',
        avatarUrl: null,
        flights: [
          {
            id: 'demo-v2-leg-3a',
            flightNumber: 'JL771',
            departureTime: new Date(now - h(4)).toISOString(),
            from: 'SYD',
            to: 'NRT',
            note: 'Direct SYD → NRT – over the Coral Sea, roughly mid-flight.',
          },
          {
            id: 'demo-v2-leg-3b',
            flightNumber: 'JL772',
            departureTime: new Date(now + h(62)).toISOString(),
            from: 'NRT',
            to: 'SYD',
            note: 'Return NRT → SYD.',
          },
        ],
      },

      // 4. Diego — New York (JFK) → Tokyo (NRT), direct 14 h; return NRT → JFK
      {
        id: 'demo-v2-friend-4',
        name: 'Diego (New York)',
        avatarUrl: null,
        flights: [
          {
            id: 'demo-v2-leg-4a',
            flightNumber: 'JL004',
            departureTime: new Date(now - h(8)).toISOString(),
            from: 'JFK',
            to: 'NRT',
            note: 'JFK → NRT – over the North Pacific, more than halfway.',
          },
          {
            id: 'demo-v2-leg-4b',
            flightNumber: 'JL003',
            departureTime: new Date(now + h(58)).toISOString(),
            from: 'NRT',
            to: 'JFK',
            note: 'Return NRT → JFK.',
          },
        ],
      },

      // 5. Emma — Nairobi (NBO) → Dubai (DXB) → Tokyo (NRT); return NRT → DXB → NBO
      {
        id: 'demo-v2-friend-5',
        name: 'Emma (Nairobi)',
        avatarUrl: null,
        flights: [
          {
            id: 'demo-v2-leg-5a',
            flightNumber: 'EK722',
            departureTime: new Date(now - h(10)).toISOString(),
            from: 'NBO',
            to: 'DXB',
            note: 'NBO → DXB feeder hop – arrived in Dubai ~6 h ago.',
          },
          {
            id: 'demo-v2-leg-5b',
            flightNumber: 'EK318',
            departureTime: new Date(now - h(5)).toISOString(),
            from: 'DXB',
            to: 'NRT',
            note: 'DXB → NRT – currently flying over the Indian Ocean / South Asia.',
          },
          {
            id: 'demo-v2-leg-5c',
            flightNumber: 'EK319',
            departureTime: new Date(now + h(63)).toISOString(),
            from: 'NRT',
            to: 'DXB',
            note: 'Return leg NRT → DXB.',
          },
          {
            id: 'demo-v2-leg-5d',
            flightNumber: 'EK723',
            departureTime: new Date(now + h(67)).toISOString(),
            from: 'DXB',
            to: 'NBO',
            note: 'Return DXB → NBO – final leg home.',
          },
        ],
      },

      // 6. Farah — Cape Town (CPT) → Dubai (DXB) → Tokyo (NRT); return NRT → CPT
      {
        id: 'demo-v2-friend-6',
        name: 'Farah (Cape Town)',
        avatarUrl: null,
        flights: [
          {
            id: 'demo-v2-leg-6a',
            flightNumber: 'EK764',
            departureTime: new Date(now - h(14)).toISOString(),
            from: 'CPT',
            to: 'DXB',
            note: 'CPT → DXB feeder – arrived Dubai ~3 h ago.',
          },
          {
            id: 'demo-v2-leg-6b',
            flightNumber: 'EK316',
            departureTime: new Date(now - h(2)).toISOString(),
            from: 'DXB',
            to: 'NRT',
            note: 'DXB → NRT – just departed, flying over the Persian Gulf / South Asia.',
          },
          {
            id: 'demo-v2-leg-6c',
            flightNumber: 'EK317',
            departureTime: new Date(now + h(65)).toISOString(),
            from: 'NRT',
            to: 'CPT',
            note: 'Return NRT → CPT (one-stop via DXB).',
          },
        ],
      },

      // 7. Gabriel — Toronto (YYZ) → Vancouver (YVR) → Tokyo (NRT); return NRT → YYZ
      {
        id: 'demo-v2-friend-7',
        name: 'Gabriel (Toronto)',
        avatarUrl: null,
        flights: [
          {
            id: 'demo-v2-leg-7a',
            flightNumber: 'AC163',
            departureTime: new Date(now - h(12)).toISOString(),
            from: 'YYZ',
            to: 'YVR',
            note: 'YYZ → YVR hop – landed Vancouver ~7 h ago.',
          },
          {
            id: 'demo-v2-leg-7b',
            flightNumber: 'AC003',
            departureTime: new Date(now - h(7)).toISOString(),
            from: 'YVR',
            to: 'NRT',
            note: 'YVR → NRT – deep over the North Pacific, roughly mid-flight.',
          },
          {
            id: 'demo-v2-leg-7c',
            flightNumber: 'AC004',
            departureTime: new Date(now + h(61)).toISOString(),
            from: 'NRT',
            to: 'YYZ',
            note: 'Return NRT → YYZ (direct).',
          },
        ],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function getDemoV2TripId(): string {
  return DEMO_V2_TRIP_ID;
}

export function isV2DemoTrip(trip: FriendsTrackerTripConfig): boolean {
  return trip.id === DEMO_V2_TRIP_ID;
}

/**
 * Merges a freshly-generated demo V2 trip into the list of trips,
 * preserving any resolved ICAO24s from the previous version.
 */
export function ensureDemoV2Trip(
  trips: FriendsTrackerTripConfig[],
  now = getDemoV2ReferenceTime(),
): FriendsTrackerTripConfig[] {
  const fresh = buildDefaultDemoV2Trip(now);
  const existingIndex = trips.findIndex((t) => t.id === DEMO_V2_TRIP_ID);

  if (existingIndex === -1) {
    return [...trips, fresh];
  }

  const existing = trips[existingIndex]!;
  const mergedFriends = fresh.friends.map((freshFriend) => {
    const existingFriend = existing.friends.find((f) => f.id === freshFriend.id);
    if (!existingFriend) {
      return freshFriend;
    }

    return {
      ...freshFriend,
      name: existingFriend.name || freshFriend.name,
      avatarUrl: existingFriend.avatarUrl ?? freshFriend.avatarUrl,
      flights: freshFriend.flights.map((freshLeg) => {
        const existingLeg = existingFriend.flights.find((l) => l.id === freshLeg.id);
        if (!existingLeg) {
          return freshLeg;
        }

        return {
          ...freshLeg,
          resolvedIcao24: existingLeg.resolvedIcao24 ?? freshLeg.resolvedIcao24,
          lastResolvedAt: existingLeg.lastResolvedAt ?? freshLeg.lastResolvedAt,
        };
      }),
    } satisfies FriendTravelConfig;
  });

  const merged: FriendsTrackerTripConfig = {
    ...fresh,
    friends: mergedFriends,
  };

  return trips.map((t, i) => (i === existingIndex ? merged : t));
}
