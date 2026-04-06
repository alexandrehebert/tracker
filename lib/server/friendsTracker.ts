import 'server-only';

import { MongoClient, type Collection } from 'mongodb';
import {
  extractFriendTrackerIdentifiers,
  normalizeFriendsTrackerConfig,
  type FriendsTrackerConfig,
} from '~/lib/friendsTracker';
import { readTrackerCronConfig, writeTrackerCronConfig } from './trackerCron';

const DEFAULT_DB_NAME = 'tracker';
const FRIENDS_TRACKER_CONFIG_COLLECTION_NAME = 'friends_tracker_config';

const DEFAULT_CONFIG: FriendsTrackerConfig = {
  updatedAt: null,
  updatedBy: null,
  cronEnabled: true,
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
    const identifiers = extractFriendTrackerIdentifiers(config);
    await writeTrackerCronConfig({
      identifiers,
      enabled: typeof config.cronEnabled === 'boolean' ? config.cronEnabled : true,
      updatedBy: config.updatedBy ?? 'chantal-config',
    });
  } catch (error) {
    console.warn('Unable to sync Chantal tracker identifiers into tracker cron config.', error);
  }
}

export async function readFriendsTrackerConfig(): Promise<FriendsTrackerConfig> {
  const [collection, trackerCronConfig] = await Promise.all([
    getFriendsTrackerConfigCollection(),
    readTrackerCronConfig(),
  ]);

  if (!collection) {
    return normalizeFriendsTrackerConfig({
      ...DEFAULT_CONFIG,
      cronEnabled: trackerCronConfig.enabled,
    });
  }

  try {
    const document = await collection.findOne({ _id: 'default' } as Parameters<typeof collection.findOne>[0]);
    return normalizeFriendsTrackerConfig({
      ...document,
      cronEnabled: trackerCronConfig.enabled,
    });
  } catch (error) {
    logMongoWarning(error);
    return normalizeFriendsTrackerConfig({
      ...DEFAULT_CONFIG,
      cronEnabled: trackerCronConfig.enabled,
    });
  }
}

export async function writeFriendsTrackerConfig(input: Partial<FriendsTrackerConfig> | null | undefined): Promise<FriendsTrackerConfig> {
  const currentConfig = await readFriendsTrackerConfig();
  const nextConfig = normalizeFriendsTrackerConfig({
    ...currentConfig,
    ...input,
    cronEnabled: typeof input?.cronEnabled === 'boolean' ? input.cronEnabled : currentConfig.cronEnabled,
    friends: Array.isArray(input?.friends) ? input.friends : currentConfig.friends,
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
