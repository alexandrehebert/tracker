import { describe, expect, it } from 'vitest';
import type { TrackedFlight } from '~/components/tracker/flight/types';
import {
  buildFriendFlightStatuses,
  extractFriendTrackerIdentifiers,
  normalizeFriendsTrackerConfig,
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

  it('does not auto-lock a repeated daily flight too early', () => {
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

    expect(status?.flight?.icao24).toBe('3c675a');
    expect(status?.canAutoLock).toBe(false);
  });

  it('normalizes imported JSON configs with missing ids and casing differences', () => {
    const config = normalizeFriendsTrackerConfig({
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
    expect(config.friends[0]?.id).toBeTruthy();
    expect(config.friends[0]?.flights[0]?.id).toBeTruthy();
    expect(config.friends[0]?.flights[0]?.flightNumber).toBe('AF123');
    expect(config.friends[0]?.flights[0]?.resolvedIcao24).toBe('3C675A');
  });
});
