import { describe, expect, it } from 'vitest';
import {
  getCurrentTripLegs,
  type FriendFlightStatus,
  type FriendTravelConfig,
} from '~/lib/friendsTracker';

describe('getCurrentTripLegs', () => {
  function makeFriend(flights: FriendTravelConfig['flights']): FriendTravelConfig {
    return { id: 'f1', name: 'Alice', flights };
  }

  const noStatuses: FriendFlightStatus[] = [];

  it('returns all legs when no destination is set', () => {
    const friend = makeFriend([
      { id: 'l1', flightNumber: 'AF1', departureTime: '2026-04-14T08:00:00Z', from: 'CDG', to: 'AMS' },
      { id: 'l2', flightNumber: 'KL1', departureTime: '2026-04-15T10:00:00Z', from: 'AMS', to: 'MIA' },
      { id: 'l3', flightNumber: 'AA1', departureTime: '2026-04-20T14:00:00Z', from: 'MIA', to: 'CDG' },
    ]);

    expect(getCurrentTripLegs(friend, noStatuses, null)).toHaveLength(3);
  });

  it('returns sorted outbound legs when first trip has future legs', () => {
    const now = Date.UTC(2026, 3, 13, 12, 0); // April 13
    const friend = makeFriend([
      { id: 'l1', flightNumber: 'AF1', departureTime: '2026-04-14T08:00:00Z', from: 'CDG', to: 'AMS' },
      { id: 'l2', flightNumber: 'KL1', departureTime: '2026-04-14T12:00:00Z', from: 'AMS', to: 'MIA' },
      { id: 'l3', flightNumber: 'AA1', departureTime: '2026-04-20T14:00:00Z', from: 'MIA', to: 'CDG' },
    ]);

    const result = getCurrentTripLegs(friend, noStatuses, 'MIA', now);
    expect(result).toHaveLength(2);
    expect(result[0]?.id).toBe('l1');
    expect(result[1]?.id).toBe('l2');
  });

  it('returns return legs when outbound is done and return is upcoming', () => {
    const now = Date.UTC(2026, 3, 16, 12, 0); // April 16 — after outbound, before return
    const friend = makeFriend([
      { id: 'l1', flightNumber: 'AF1', departureTime: '2026-04-14T08:00:00Z', from: 'CDG', to: 'MIA' },
      { id: 'l2', flightNumber: 'AA1', departureTime: '2026-04-20T14:00:00Z', from: 'MIA', to: 'CDG' },
    ]);

    const result = getCurrentTripLegs(friend, noStatuses, 'MIA', now);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('l2');
  });

  it('prioritizes a trip with an active (matched) leg', () => {
    const now = Date.UTC(2026, 3, 14, 10, 0); // April 14 during outbound
    const friend = makeFriend([
      { id: 'l1', flightNumber: 'AF1', departureTime: '2026-04-14T08:00:00Z', from: 'CDG', to: 'MIA' },
      { id: 'l2', flightNumber: 'AA1', departureTime: '2026-04-20T14:00:00Z', from: 'MIA', to: 'CDG' },
    ]);

    const matchedStatuses: FriendFlightStatus[] = [
      {
        friend,
        leg: friend.flights[0]!,
        flight: null,
        label: 'Alice',
        canAutoLock: false,
        status: 'matched',
      },
      {
        friend,
        leg: friend.flights[1]!,
        flight: null,
        label: 'Alice',
        canAutoLock: false,
        status: 'scheduled',
      },
    ];

    const result = getCurrentTripLegs(friend, matchedStatuses, 'MIA', now);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('l1');
  });

  it('falls back to last trip when all are past', () => {
    const now = Date.UTC(2026, 3, 25, 12, 0); // April 25 — all trips done
    const friend = makeFriend([
      { id: 'l1', flightNumber: 'AF1', departureTime: '2026-04-14T08:00:00Z', from: 'CDG', to: 'MIA' },
      { id: 'l2', flightNumber: 'AA1', departureTime: '2026-04-20T14:00:00Z', from: 'MIA', to: 'CDG' },
    ]);

    const result = getCurrentTripLegs(friend, noStatuses, 'MIA', now);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('l2');
  });

  it('returns all legs sorted when destination not in any leg', () => {
    const now = Date.UTC(2026, 3, 15, 12, 0);
    const friend = makeFriend([
      { id: 'l1', flightNumber: 'AF1', departureTime: '2026-04-14T08:00:00Z', from: 'CDG', to: 'AMS' },
      { id: 'l2', flightNumber: 'KL1', departureTime: '2026-04-16T10:00:00Z', from: 'AMS', to: 'JFK' },
    ]);

    const result = getCurrentTripLegs(friend, noStatuses, 'MIA', now);
    expect(result).toHaveLength(2);
  });

  it('treats comma-separated airports as valid meeting destinations', () => {
    const now = Date.UTC(2026, 3, 16, 12, 0);
    const friend = makeFriend([
      { id: 'l1', flightNumber: 'AF1', departureTime: '2026-04-14T08:00:00Z', from: 'CDG', to: 'AMS' },
      { id: 'l2', flightNumber: 'KL1', departureTime: '2026-04-14T12:00:00Z', from: 'AMS', to: 'EWR' },
      { id: 'l3', flightNumber: 'UA1', departureTime: '2026-04-20T14:00:00Z', from: 'EWR', to: 'CDG' },
    ]);

    const result = getCurrentTripLegs(friend, noStatuses, 'JFK, EWR', now);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('l3');
  });
});
