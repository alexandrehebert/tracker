import { MongoClient, type Collection } from 'mongodb';
import type { FlightSourceName } from '~/components/tracker/flight/types';

const DEFAULT_DB_NAME = 'tracker';
const PROVIDER_HISTORY_COLLECTION_NAME = 'provider_fetch_history';

type ProviderHistoryDocument<T> = {
  _id: string;
  provider: FlightSourceName;
  identifier: string;
  fetchedAt: Date;
  match: T | null;
};

let mongoClientPromise: Promise<MongoClient> | null = null;
let providerHistoryIndexesReady: Promise<void> | null = null;
let mongoWarningLogged = false;

function isMongoConfigured(): boolean {
  return Boolean(process.env.MONGODB_URI?.trim());
}

function getMongoDbName(): string {
  return process.env.MONGODB_DB_NAME?.trim() || DEFAULT_DB_NAME;
}

function logMongoWarning(error: unknown) {
  if (mongoWarningLogged) {
    return;
  }

  mongoWarningLogged = true;
  console.warn('MongoDB provider history is unavailable.', error);
}

async function getProviderHistoryCollection<T>(): Promise<Collection<ProviderHistoryDocument<T>> | null> {
  const mongoUri = process.env.MONGODB_URI?.trim();
  if (!mongoUri) {
    return null;
  }

  try {
    if (!mongoClientPromise) {
      const client = new MongoClient(mongoUri);
      mongoClientPromise = client.connect();
    }

    let client: MongoClient;
    try {
      client = await mongoClientPromise;
    } catch (error) {
      mongoClientPromise = null;
      throw error;
    }

    const collection = client.db(getMongoDbName()).collection<ProviderHistoryDocument<T>>(PROVIDER_HISTORY_COLLECTION_NAME);

    if (!providerHistoryIndexesReady) {
      providerHistoryIndexesReady = Promise.all([
        collection.createIndex({ provider: 1, identifier: 1, fetchedAt: -1 }),
      ]).then(() => undefined);
    }

    try {
      await providerHistoryIndexesReady;
    } catch (error) {
      providerHistoryIndexesReady = null;
      throw error;
    }

    return collection;
  } catch (error) {
    logMongoWarning(error);
    return null;
  }
}

export function isProviderHistoryConfigured(): boolean {
  return isMongoConfigured();
}

export async function readLatestProviderHistory<T>(
  provider: FlightSourceName,
  identifier: string,
  maxAgeMs: number,
): Promise<T | null> {
  const normalizedIdentifier = identifier.trim().toUpperCase();
  if (!normalizedIdentifier) {
    return null;
  }

  const collection = await getProviderHistoryCollection<T>();
  if (!collection) {
    return null;
  }

  try {
    const cutoffMs = Date.now() - maxAgeMs;
    const documents = await collection.find(
      { provider, identifier: normalizedIdentifier } as Parameters<typeof collection.find>[0],
    ).sort({ fetchedAt: -1 }).limit(1).toArray();

    const document = documents[0] ?? null;
    if (!document) {
      return null;
    }

    const fetchedAtMs = document.fetchedAt instanceof Date ? document.fetchedAt.getTime() : 0;
    if (fetchedAtMs < cutoffMs) {
      return null;
    }

    return document.match ?? null;
  } catch (error) {
    logMongoWarning(error);
    return null;
  }
}

export async function writeProviderHistory<T>(
  provider: FlightSourceName,
  identifier: string,
  match: T | null,
): Promise<void> {
  const normalizedIdentifier = identifier.trim().toUpperCase();
  if (!normalizedIdentifier) {
    return;
  }

  const collection = await getProviderHistoryCollection<T>();
  if (!collection) {
    return;
  }

  const now = new Date();
  const id = `${provider}:${normalizedIdentifier}:${now.getTime()}`;

  try {
    await collection.updateOne(
      { _id: id } as Parameters<typeof collection.updateOne>[0],
      {
        $set: {
          provider,
          identifier: normalizedIdentifier,
          fetchedAt: now,
          match,
        },
      },
      { upsert: true },
    );
  } catch (error) {
    logMongoWarning(error);
  }
}
