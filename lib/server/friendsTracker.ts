import 'server-only';

import { MongoClient, type Collection } from 'mongodb';
import {
  extractFriendTrackerIdentifiers,
  getCurrentTripConfig,
  normalizeFriendsTrackerConfig,
  normalizeFriendsTrackerTripConfig,
  type FriendsTrackerConfig,
} from '~/lib/friendsTracker';
import { writeTrackerCronConfig } from './trackerCron';

const DEFAULT_DB_NAME = 'tracker';
const FRIENDS_TRACKER_CONFIG_COLLECTION_NAME = 'friends_tracker_config';

const DEFAULT_CONFIG: FriendsTrackerConfig = {
  updatedAt: null,
  updatedBy: null,
  cronEnabled: true,
  currentTripId: null,
  trips: [],
  friends: [],
};

type FriendsTrackerConfigDocument = FriendsTrackerConfig & {
  _id: 'default';
};

let mongoClientPromise: Promise<MongoClient> | null = null;
let friendsTrackerIndexesReady: Promise<void> | null = null;
let mongoWarningLogged = false;

function getMongoDbName(): string {
  return process.env.MONGODB_DB_NAME?.trim() || DEFAULT_DB_NAME;
}

function logMongoWarning(error: unknown) {
  if (mongoWarningLogged) {
    return;
  }

  mongoWarningLogged = true;
  console.warn('Friends tracker storage is unavailable.', error);
}

export function isFriendsTrackerStorageConfigured(): boolean {
  return Boolean(process.env.MONGODB_URI?.trim());
}

async function getFriendsTrackerConfigCollection(): Promise<Collection<FriendsTrackerConfigDocument> | null> {
  const mongoUri = process.env.MONGODB_URI?.trim();
  if (!mongoUri) {
    return null;
  }

  try {
    if (!mongoClientPromise) {
      mongoClientPromise = new MongoClient(mongoUri).connect();
    }

    let client: MongoClient;
    try {
      client = await mongoClientPromise;
    } catch (error) {
      mongoClientPromise = null;
      throw error;
    }

    const collection = client.db(getMongoDbName()).collection<FriendsTrackerConfigDocument>(FRIENDS_TRACKER_CONFIG_COLLECTION_NAME);

    if (!friendsTrackerIndexesReady) {
      friendsTrackerIndexesReady = Promise.all([
        collection.createIndex({ updatedAt: -1 }),
      ]).then(() => undefined);
    }

    try {
      await friendsTrackerIndexesReady;
    } catch (error) {
      friendsTrackerIndexesReady = null;
      throw error;
    }

    return collection;
  } catch (error) {
    logMongoWarning(error);
    return null;
  }
}

async function syncFriendsTrackerCron(config: FriendsTrackerConfig): Promise<void> {
  try {
    const identifiers = config.cronEnabled === false ? [] : extractFriendTrackerIdentifiers(config);
    await writeTrackerCronConfig({
      chantalIdentifiers: identifiers,
      updatedBy: config.updatedBy ?? 'chantal-config',
    });
  } catch (error) {
    console.warn('Unable to sync Chantal tracker identifiers into tracker cron config.', error);
  }
}

export async function readFriendsTrackerConfig(): Promise<FriendsTrackerConfig> {
  const collection = await getFriendsTrackerConfigCollection();

  if (!collection) {
    return normalizeFriendsTrackerConfig(DEFAULT_CONFIG);
  }

  try {
    const document = await collection.findOne({ _id: 'default' } as Parameters<typeof collection.findOne>[0]);
    return normalizeFriendsTrackerConfig(document ?? DEFAULT_CONFIG);
  } catch (error) {
    logMongoWarning(error);
    return normalizeFriendsTrackerConfig(DEFAULT_CONFIG);
  }
}

export async function writeFriendsTrackerConfig(input: Partial<FriendsTrackerConfig> | null | undefined): Promise<FriendsTrackerConfig> {
  const currentConfig = await readFriendsTrackerConfig();
  let requestedCurrentTripId = typeof input?.currentTripId === 'string' && input.currentTripId.trim()
    ? input.currentTripId.trim()
    : input?.currentTripId === null
    ? null
    : currentConfig.currentTripId;

  let nextTrips = Array.isArray(input?.trips) ? input.trips : currentConfig.trips;
  const destinationAirportProvided = Boolean(input && 'destinationAirport' in input);

  if (!Array.isArray(input?.trips) && (Array.isArray(input?.friends) || destinationAirportProvided)) {
    const baseConfig = normalizeFriendsTrackerConfig({
      ...currentConfig,
      currentTripId: requestedCurrentTripId,
      trips: currentConfig.trips,
    });
    const existingCurrentTrip = getCurrentTripConfig(baseConfig);
    const editableTrip = existingCurrentTrip && !existingCurrentTrip.isDemo
      ? existingCurrentTrip
      : (baseConfig.trips.find((trip) => !trip.isDemo) ?? null);

    if (editableTrip) {
      nextTrips = baseConfig.trips.map((trip) => trip.id === editableTrip.id
        ? {
          ...trip,
          destinationAirport: destinationAirportProvided ? input?.destinationAirport ?? null : trip.destinationAirport,
          friends: Array.isArray(input?.friends) ? input.friends : trip.friends,
        }
        : trip);
      requestedCurrentTripId = editableTrip.id;
    } else {
      const seededTrip = normalizeFriendsTrackerTripConfig({
        id: 'primary-trip',
        name: 'Main trip',
        destinationAirport: destinationAirportProvided ? input?.destinationAirport ?? null : null,
        friends: Array.isArray(input?.friends) ? input.friends : [],
      }, 0, 'Main trip');

      nextTrips = [seededTrip];
      requestedCurrentTripId = seededTrip.id;
    }
  }

  const nextConfig = normalizeFriendsTrackerConfig({
    ...currentConfig,
    ...input,
    cronEnabled: typeof input?.cronEnabled === 'boolean' ? input.cronEnabled : currentConfig.cronEnabled,
    currentTripId: requestedCurrentTripId,
    trips: nextTrips,
    updatedAt: Date.now(),
  });

  const collection = await getFriendsTrackerConfigCollection();
  if (collection) {
    try {
      await collection.updateOne(
        { _id: 'default' } as Parameters<typeof collection.updateOne>[0],
        {
          $set: {
            _id: 'default',
            ...nextConfig,
          },
        },
        { upsert: true },
      );
    } catch (error) {
      logMongoWarning(error);
    }
  }

  await syncFriendsTrackerCron(nextConfig);
  return nextConfig;
}
