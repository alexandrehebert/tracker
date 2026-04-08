import { MongoClient, type Collection } from 'mongodb';
import { ALL_PROVIDERS, type ProviderName } from './index';

const DEFAULT_DB_NAME = 'tracker';
const PROVIDER_OVERRIDES_COLLECTION_NAME = 'provider_overrides';
const OVERRIDES_CACHE_TTL_MS = 30_000;

export type ProviderOverrideState = 'enabled' | 'disabled' | null;

export type ProviderOverridesMap = Record<ProviderName, ProviderOverrideState>;

type ProviderOverrideDocument = {
  _id: ProviderName;
  state: 'enabled' | 'disabled';
  updatedAt: number;
  updatedBy: string | null;
};

let mongoClientPromise: Promise<MongoClient> | null = null;
let mongoWarningLogged = false;
let overridesCache: ProviderOverridesMap | null = null;
let overridesCacheExpiry = 0;

function isMongoConfigured(): boolean {
  return Boolean(process.env.MONGODB_URI?.trim());
}

function getMongoDbName(): string {
  return process.env.MONGODB_DB_NAME?.trim() || DEFAULT_DB_NAME;
}

function logMongoWarning(error: unknown): void {
  if (mongoWarningLogged) {
    return;
  }

  mongoWarningLogged = true;
  console.warn('MongoDB provider overrides storage is unavailable.', error);
}

async function getOverridesCollection(): Promise<Collection<ProviderOverrideDocument> | null> {
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

    return client.db(getMongoDbName()).collection<ProviderOverrideDocument>(PROVIDER_OVERRIDES_COLLECTION_NAME);
  } catch (error) {
    logMongoWarning(error);
    return null;
  }
}

function buildEmptyOverridesMap(): ProviderOverridesMap {
  return Object.fromEntries(ALL_PROVIDERS.map((name) => [name, null])) as ProviderOverridesMap;
}

export function isProviderOverridesStorageConfigured(): boolean {
  return isMongoConfigured();
}

export async function readProviderOverrides(): Promise<ProviderOverridesMap> {
  const collection = await getOverridesCollection();
  if (!collection) {
    return buildEmptyOverridesMap();
  }

  try {
    const documents = await collection.find({} as Parameters<typeof collection.find>[0]).toArray();
    const result = buildEmptyOverridesMap();

    for (const doc of documents) {
      if ((ALL_PROVIDERS as readonly string[]).includes(doc._id)) {
        result[doc._id as ProviderName] = doc.state ?? null;
      }
    }

    return result;
  } catch (error) {
    logMongoWarning(error);
    return buildEmptyOverridesMap();
  }
}

export async function writeProviderOverride(
  name: ProviderName,
  state: ProviderOverrideState,
  updatedBy: string | null = null,
): Promise<void> {
  const collection = await getOverridesCollection();
  if (!collection) {
    return;
  }

  try {
    if (state === null) {
      await collection.deleteOne({ _id: name } as Parameters<typeof collection.deleteOne>[0]);
    } else {
      await collection.updateOne(
        { _id: name } as Parameters<typeof collection.updateOne>[0],
        { $set: { _id: name, state, updatedAt: Date.now(), updatedBy } },
        { upsert: true },
      );
    }

    overridesCache = null;
    overridesCacheExpiry = 0;
  } catch (error) {
    logMongoWarning(error);
  }
}

export async function getCachedProviderOverrides(): Promise<ProviderOverridesMap> {
  if (overridesCache && Date.now() < overridesCacheExpiry) {
    return overridesCache;
  }

  const result = await readProviderOverrides();
  overridesCache = result;
  overridesCacheExpiry = Date.now() + OVERRIDES_CACHE_TTL_MS;
  return result;
}
