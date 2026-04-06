import {
  createEmptyFriendConfig,
  createEmptyFriendFlightLeg,
  createEmptyTripConfig,
  normalizeFriendsTrackerConfig,
  type FriendFlightLeg,
  type FriendTravelConfig,
  type FriendsTrackerConfig,
  type FriendsTrackerTripConfig,
} from '~/lib/friendsTracker';

export function createClientId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export function moveArrayItem<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= items.length || toIndex >= items.length) {
    return items;
  }

  const nextItems = [...items];
  const [movedItem] = nextItems.splice(fromIndex, 1);

  if (movedItem == null) {
    return items;
  }

  nextItems.splice(toIndex, 0, movedItem);
  return nextItems;
}

export function buildSaveableConfigSnapshot(config: FriendsTrackerConfig, demoReferenceTime?: number): string {
  const normalized = normalizeFriendsTrackerConfig(
    config,
    demoReferenceTime == null ? undefined : { demoReferenceTime },
  );

  return JSON.stringify({
    currentTripId: normalized.currentTripId ?? null,
    cronEnabled: normalized.cronEnabled ?? true,
    trips: normalized.trips ?? [],
  });
}

export function createDraftFriend(): FriendTravelConfig {
  const friend = createEmptyFriendConfig();
  return {
    ...friend,
    id: createClientId('friend'),
    name: '',
    flights: [{
      ...createEmptyFriendFlightLeg(),
      id: createClientId('leg'),
    }],
  };
}

export function createDraftLeg(): FriendFlightLeg {
  return {
    ...createEmptyFriendFlightLeg(),
    id: createClientId('leg'),
  };
}

export function createDraftTrip(): FriendsTrackerTripConfig {
  const trip = createEmptyTripConfig();
  return {
    ...trip,
    id: createClientId('trip'),
    name: 'New trip',
  };
}
