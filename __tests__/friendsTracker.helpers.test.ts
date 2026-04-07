import { describe, expect, it, vi } from 'vitest';
import type { TrackedFlight } from '~/components/tracker/flight/types';
import {
  buildFriendFlightStatuses,
  extractFriendTrackerIdentifiers,
  normalizeFriendsTrackerConfig,
  type FriendTravelConfig,
  type FriendsTrackerConfig,
} from '~/lib/friendsTracker';

function createTrackedFlight(
  identifier: string,
  icao24: string,
  options: {
    firstSeen?: number | null;
    lastContact?: number | null;
  } = {},
): TrackedFlight {
  return {
    icao24,
    callsign: identifier,
    originCountry: 'Testland',
    matchedBy: [identifier],
    lastContact: options.lastContact ?? options.firstSeen ?? 1_700_000_000,
    current: null,
    originPoint: null,
    track: [],
    rawTrack: [],
    onGround: false,
    velocity: null,
    heading: null,
    verticalRate: null,
    geoAltitude: null,
    baroAltitude: null,
    squawk: null,
    category: null,
    route: {
      departureAirport: 'CDG',
      arrivalAirport: 'LIS',
      firstSeen: options.firstSeen ?? null,
      lastSeen: options.lastContact ?? options.firstSeen ?? null,
    },
    dataSource: 'opensky',
    sourceDetails: [],
    fetchHistory: [],
  };
}

describe('friends tracker helpers', () => {
  it('prefers locked ICAO24 identifiers and de-duplicates configured legs', () => {
    const config: FriendsTrackerConfig = {
      updatedAt: null,
      updatedBy: null,
      friends: [
        {
          id: 'friend-1',
          name: 'Alice',
          flights: [
            {
              id: 'leg-1',
              flightNumber: 'af 123',
              departureTime: '2026-04-14T09:30:00.000Z',
              resolvedIcao24: '3c675a',
            },
            {
              id: 'leg-2',
              flightNumber: 'AF123',
              departureTime: '2026-04-14T13:30:00.000Z',
            },
          ],
        },
      ],
    };

    expect(extractFriendTrackerIdentifiers(config)).toEqual(['3C675A', 'AF123']);
  });

  it('matches configured friends to flights and enables ICAO24 locking near departure time', () => {
    const departureTime = Date.UTC(2026, 3, 14, 9, 30);
    const config: FriendsTrackerConfig = {
      updatedAt: null,
      updatedBy: null,
      friends: [
        {
          id: 'friend-1',
          name: 'Alice',
          flights: [
            {
              id: 'leg-1',
              flightNumber: 'AF123',
              departureTime: new Date(departureTime).toISOString(),
            },
          ],
        },
      ],
    };

    const [status] = buildFriendFlightStatuses(
      config,
      [createTrackedFlight('AF123', '3c675a', { firstSeen: Math.floor(departureTime / 1000) })],
      departureTime + (60 * 60 * 1000),
    );

    expect(status?.friend.name).toBe('Alice');
    expect(status?.flight?.icao24).toBe('3c675a');
    expect(status?.label).toBe('Alice');
    expect(status?.canAutoLock).toBe(true);
  });

  it('does not treat a repeated daily flight as live when the configured departure is still far in the future', () => {
    const departureTime = Date.UTC(2026, 3, 14, 9, 30);
    const now = Date.UTC(2026, 3, 5, 9, 30);
    const config: FriendsTrackerConfig = {
      updatedAt: null,
      updatedBy: null,
      friends: [
        {
          id: 'friend-1',
          name: 'Alice',
          flights: [
            {
              id: 'leg-1',
              flightNumber: 'AF123',
              departureTime: new Date(departureTime).toISOString(),
            },
          ],
        },
      ],
    };

    const [status] = buildFriendFlightStatuses(
      config,
      [createTrackedFlight('AF123', '3c675a', { firstSeen: Math.floor(now / 1000) })],
      now,
    );

    expect(status?.flight).toBeNull();
    expect(status?.status).toBe('scheduled');
    expect(status?.canAutoLock).toBe(false);
  });

  it('rejects same-number matches from the previous service day or much later that day', () => {
    const departureTime = Date.UTC(2026, 3, 14, 0, 0);
    const now = departureTime + (30 * 60 * 1000);
    const config: FriendsTrackerConfig = {
      updatedAt: null,
      updatedBy: null,
      friends: [
        {
          id: 'friend-1',
          name: 'Alice',
          flights: [
            {
              id: 'leg-1',
              flightNumber: 'AF123',
              departureTime: new Date(departureTime).toISOString(),
            },
          ],
        },
      ],
    };

    const [status] = buildFriendFlightStatuses(
      config,
      [
        createTrackedFlight('AF123', '3c675a', { firstSeen: Math.floor(Date.UTC(2026, 3, 13, 23, 15) / 1000) }),
        createTrackedFlight('AF123', '3c675b', { firstSeen: Math.floor(Date.UTC(2026, 3, 14, 15, 0) / 1000) }),
      ],
      now,
    );

    expect(status?.flight).toBeNull();
    expect(status?.status).toBe('awaiting');
    expect(status?.canAutoLock).toBe(false);
  });

  it('normalizes imported JSON configs with missing ids and casing differences', () => {
    const config = normalizeFriendsTrackerConfig({
      cronEnabled: false,
      friends: [
        {
          name: 'Alice',
          flights: [
            {
              flightNumber: 'af 123',
              departureTime: '2026-04-14T09:30:00+02:00',
              resolvedIcao24: '3c675a',
            },
          ],
        },
      ],
    } as Partial<FriendsTrackerConfig>);

    expect(config.friends).toHaveLength(1);
    expect(config.cronEnabled).toBe(false);
    expect(config.friends[0]?.id).toBeTruthy();
    expect(config.friends[0]?.flights[0]?.id).toBeTruthy();
    expect(config.friends[0]?.flights[0]?.flightNumber).toBe('AF123');
    expect(config.friends[0]?.flights[0]?.resolvedIcao24).toBe('3C675A');
  });

  it('preserves destinationAirport when normalizing config', () => {
    const config = normalizeFriendsTrackerConfig({
      destinationAirport: '  mia  ',
      friends: [],
    } as Partial<FriendsTrackerConfig>);

    expect(config.destinationAirport).toBe('mia');
  });

  it('migrates a legacy single-trip config into trips and injects the demo test trip', () => {
    const config = normalizeFriendsTrackerConfig({
      destinationAirport: 'LIS',
      friends: [
        {
          id: 'friend-1',
          name: 'Alice',
          flights: [
            {
              id: 'leg-1',
              flightNumber: 'AF123',
              departureTime: '2026-04-14T09:30:00.000Z',
              from: 'CDG',
              to: 'LIS',
            },
          ],
        },
      ],
    } as Partial<FriendsTrackerConfig>);

    expect(config.trips.length).toBeGreaterThanOrEqual(2);
    expect(config.currentTripId).toBeTruthy();

    const currentTrip = config.trips.find((trip) => trip.id === config.currentTripId);
    expect(currentTrip?.destinationAirport).toBe('LIS');
    expect(currentTrip?.friends[0]?.name).toBe('Alice');

    const demoTrip = config.trips.find((trip) => trip.id === 'demo-test-trip');
    expect(demoTrip).toBeTruthy();
    expect(demoTrip?.friends.length ?? 0).toBeGreaterThanOrEqual(6);
    expect(demoTrip?.friends.filter((friend) => friend.flights.length > 1).length ?? 0).toBeGreaterThanOrEqual(3);
    expect(demoTrip?.friends.flatMap((friend) => friend.flights.map((leg) => leg.flightNumber))).toEqual(
      expect.arrayContaining(['TEST1', 'TEST2', 'TEST3', 'TEST4', 'TEST5']),
    );
  });

  it('refreshes the built-in demo trip when a stale saved copy exists', () => {
    const config = normalizeFriendsTrackerConfig({
      currentTripId: 'demo-test-trip',
      trips: [
        {
          id: 'demo-test-trip',
          name: 'Old demo trip',
          destinationAirport: 'LAX',
          isDemo: true,
          friends: [
            {
              id: 'old-friend',
              name: 'Old Demo',
              flights: [
                {
                  id: 'old-leg',
                  flightNumber: 'OLD1',
                  departureTime: '2026-04-14T09:30:00.000Z',
                  from: 'SFO',
                  to: 'LAX',
                },
              ],
            },
          ],
        },
      ],
    } as Partial<FriendsTrackerConfig>);

    const demoTrip = config.trips.find((trip) => trip.id === 'demo-test-trip');
    expect(demoTrip?.destinationAirport).toBe('LAX');
    expect(demoTrip?.friends.map((friend) => friend.name)).toEqual(
      expect.arrayContaining(['Alice Demo', 'Bruno Demo', 'Chloe Demo', 'Diego Demo', 'Emma Demo', 'Farah Demo']),
    );
    expect(demoTrip?.friends.flatMap((friend) => friend.flights.map((leg) => leg.flightNumber))).toEqual(
      expect.arrayContaining(['TEST1', 'TEST2', 'TEST3', 'TEST4', 'TEST5']),
    );
  });

  it('preserves saved demo customizations while refreshing the built-in relative timings', () => {
    const config = normalizeFriendsTrackerConfig({
      currentTripId: 'demo-test-trip',
      trips: [
        {
          id: 'demo-test-trip',
          name: 'Customized demo',
          destinationAirport: 'EWR',
          isDemo: true,
          friends: [
            {
              id: 'demo-friend-1',
              name: 'Alice Custom',
              avatarUrl: 'data:image/png;base64,abc',
              flights: [
                {
                  id: 'demo-leg-1',
                  flightNumber: 'TEST1',
                  departureTime: '2000-01-01T00:00:00.000Z',
                  from: 'CDG',
                  to: 'EWR',
                  note: 'Custom demo note',
                },
              ],
            },
          ],
        },
      ],
    } as Partial<FriendsTrackerConfig>);

    const demoTrip = config.trips.find((trip) => trip.id === 'demo-test-trip');
    const firstFriend = demoTrip?.friends.find((friend) => friend.id === 'demo-friend-1');

    expect(demoTrip?.name).toBe('Customized demo');
    expect(demoTrip?.destinationAirport).toBe('EWR');
    expect(firstFriend?.name).toBe('Alice Custom');
    expect(firstFriend?.avatarUrl).toBe('data:image/png;base64,abc');
    expect(firstFriend?.flights[0]?.note).toBe('Custom demo note');
    expect(firstFriend?.flights[0]?.departureTime).not.toBe('2000-01-01T00:00:00.000Z');
  });

  it('keeps demo trip timestamps stable across repeated normalizations during hydration', () => {
    vi.useFakeTimers();

    try {
      vi.setSystemTime(new Date('2026-04-06T12:00:05.000Z'));
      const firstConfig = normalizeFriendsTrackerConfig({ friends: [] } as Partial<FriendsTrackerConfig>);

      vi.setSystemTime(new Date('2026-04-06T12:00:45.000Z'));
      const secondConfig = normalizeFriendsTrackerConfig({ friends: [] } as Partial<FriendsTrackerConfig>);

      const firstDemoTrip = firstConfig.trips.find((trip) => trip.id === 'demo-test-trip');
      const secondDemoTrip = secondConfig.trips.find((trip) => trip.id === 'demo-test-trip');

      expect(firstDemoTrip?.friends[0]?.flights[0]?.departureTime).toBe(secondDemoTrip?.friends[0]?.flights[0]?.departureTime);
    } finally {
      vi.useRealTimers();
    }
  });

  it('exposes only the selected current trip at the top level for the live map and cron sync', () => {
    const config = normalizeFriendsTrackerConfig({
      currentTripId: 'demo-trip',
      trips: [
        {
          id: 'live-trip',
          name: 'Live trip',
          destinationAirport: 'LIS',
          friends: [
            {
              id: 'friend-1',
              name: 'Alice',
              flights: [
                {
                  id: 'leg-1',
                  flightNumber: 'AF123',
                  departureTime: '2026-04-14T09:30:00.000Z',
                  from: 'CDG',
                  to: 'LIS',
                },
              ],
            },
          ],
        },
        {
          id: 'demo-trip',
          name: 'Demo trip',
          destinationAirport: 'JFK',
          friends: [
            {
              id: 'friend-2',
              name: 'Bob',
              flights: [
                {
                  id: 'leg-2',
                  flightNumber: 'TEST2',
                  departureTime: '2026-04-15T12:30:00.000Z',
                  from: 'LHR',
                  to: 'JFK',
                },
              ],
            },
          ],
        },
      ],
    } as Partial<FriendsTrackerConfig>);

    expect(config.destinationAirport).toBe('JFK');
    expect(config.friends.map((friend) => friend.name)).toEqual(['Bob']);
    expect(extractFriendTrackerIdentifiers(config)).toEqual(['TEST2']);
  });
});
