import { MongoClient, type Collection } from 'mongodb';
import type { AirportDetails, SelectedFlightDetails, TrackerApiResponse } from '~/components/tracker/flight/types';

const DEFAULT_CACHE_TTL_SECONDS = 300;
const DEFAULT_DETAILS_CACHE_TTL_SECONDS = 1_800;
const DEFAULT_AIRPORT_DIRECTORY_CACHE_TTL_SECONDS = 24 * 60 * 60;
const DEFAULT_DB_NAME = 'tracker';
const CACHE_COLLECTION_NAME = 'flight_search_cache';
const DETAILS_CACHE_COLLECTION_NAME = 'flight_details_cache';
const AIRPORT_DIRECTORY_CACHE_COLLECTION_NAME = 'airport_directory_cache';

type FlightSearchCacheDocument = {
  _id: string;
  payload: TrackerApiResponse;
  expiresAt: Date;
  updatedAt: Date;
};

type MemoryCacheEntry = {
  payload: TrackerApiResponse;
  expiresAt: number;
};

type AirportDirectoryCacheDocument = {
  _id: string;
  payload: AirportDetails[];
  expiresAt: Date;
  updatedAt: Date;
};

type AirportDirectoryMemoryCacheEntry = {
  payload: AirportDetails[];
  expiresAt: number;
};

type FlightDetailsCacheDocument = {
  _id: string;
  payload: SelectedFlightDetails;
  expiresAt: Date;
  updatedAt: Date;
};

type DetailsMemoryCacheEntry = {
  payload: SelectedFlightDetails;
  expiresAt: number;
};

declare global {
  var __trackerMongoClientPromise__: Promise<MongoClient> | undefined;
  var __trackerFlightCacheIndexesReady__: Promise<void> | undefined;
  var __trackerFlightDetailsCacheIndexesReady__: Promise<void> | undefined;
  var __trackerAirportDirectoryCacheIndexesReady__: Promise<void> | undefined;
}

const memoryCache = new Map<string, MemoryCacheEntry>();
const airportDirectoryMemoryCache = new Map<string, AirportDirectoryMemoryCacheEntry>();
const detailsMemoryCache = new Map<string, DetailsMemoryCacheEntry>();
let mongoWarningLogged = false;

function getCacheTtlSeconds(): number {
  const configuredValue = process.env.OPENSKY_CACHE_TTL_SECONDS?.trim();
  const parsedValue = configuredValue ? Number.parseInt(configuredValue, 10) : DEFAULT_CACHE_TTL_SECONDS;

  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : DEFAULT_CACHE_TTL_SECONDS;
}

function getDetailsCacheTtlSeconds(): number {
  const configuredValue = process.env.OPENSKY_DETAILS_CACHE_TTL_SECONDS?.trim();
  const parsedValue = configuredValue ? Number.parseInt(configuredValue, 10) : DEFAULT_DETAILS_CACHE_TTL_SECONDS;

  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : DEFAULT_DETAILS_CACHE_TTL_SECONDS;
}

function getAirportDirectoryCacheTtlSeconds(): number {
  const configuredValue = process.env.AIRPORT_DIRECTORY_CACHE_TTL_SECONDS?.trim();
  const parsedValue = configuredValue
    ? Number.parseInt(configuredValue, 10)
    : DEFAULT_AIRPORT_DIRECTORY_CACHE_TTL_SECONDS;

  return Number.isFinite(parsedValue) && parsedValue > 0
    ? parsedValue
    : DEFAULT_AIRPORT_DIRECTORY_CACHE_TTL_SECONDS;
}

function getMongoDbName(): string {
  const configuredName = process.env.MONGODB_DB_NAME?.trim();
  return configuredName || DEFAULT_DB_NAME;
}

function logMongoWarning(error: unknown) {
  if (mongoWarningLogged) {
    return;
  }

  mongoWarningLogged = true;
  console.warn('MongoDB flight cache is unavailable, falling back to the in-memory cache.', error);
}

function readFromMemory(cacheKey: string): TrackerApiResponse | null {
  const cachedEntry = memoryCache.get(cacheKey);
  if (!cachedEntry) {
    return null;
  }

  if (Date.now() >= cachedEntry.expiresAt) {
    memoryCache.delete(cacheKey);
    return null;
  }

  return cachedEntry.payload;
}

function writeToMemory(cacheKey: string, payload: TrackerApiResponse, ttlMs: number) {
  memoryCache.set(cacheKey, {
    payload,
    expiresAt: Date.now() + ttlMs,
  });
}

function readAirportDirectoryFromMemory(cacheKey: string): AirportDetails[] | null {
  const cachedEntry = airportDirectoryMemoryCache.get(cacheKey);
  if (!cachedEntry) {
    return null;
  }

  if (Date.now() >= cachedEntry.expiresAt) {
    airportDirectoryMemoryCache.delete(cacheKey);
    return null;
  }

  return cachedEntry.payload;
}

function writeAirportDirectoryToMemory(cacheKey: string, payload: AirportDetails[], ttlMs: number) {
  airportDirectoryMemoryCache.set(cacheKey, {
    payload,
    expiresAt: Date.now() + ttlMs,
  });
}

function readDetailsFromMemory(cacheKey: string): SelectedFlightDetails | null {
  const cachedEntry = detailsMemoryCache.get(cacheKey);
  if (!cachedEntry) {
    return null;
  }

  if (Date.now() >= cachedEntry.expiresAt) {
    detailsMemoryCache.delete(cacheKey);
    return null;
  }

  return cachedEntry.payload;
}

function writeDetailsToMemory(cacheKey: string, payload: SelectedFlightDetails, ttlMs: number) {
  detailsMemoryCache.set(cacheKey, {
    payload,
    expiresAt: Date.now() + ttlMs,
  });
}

async function getCacheCollection(): Promise<Collection<FlightSearchCacheDocument> | null> {
  const mongoUri = process.env.MONGODB_URI?.trim();
  if (!mongoUri) {
    return null;
  }

  try {
    if (!globalThis.__trackerMongoClientPromise__) {
      const client = new MongoClient(mongoUri);
      globalThis.__trackerMongoClientPromise__ = client.connect();
    }

    let client: MongoClient;
    try {
      client = await globalThis.__trackerMongoClientPromise__;
    } catch (error) {
      globalThis.__trackerMongoClientPromise__ = undefined;
      throw error;
    }

    const collection = client.db(getMongoDbName()).collection<FlightSearchCacheDocument>(CACHE_COLLECTION_NAME);

    if (!globalThis.__trackerFlightCacheIndexesReady__) {
      globalThis.__trackerFlightCacheIndexesReady__ = Promise.all([
        collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
        collection.createIndex({ updatedAt: -1 }),
      ]).then(() => undefined);
    }

    try {
      await globalThis.__trackerFlightCacheIndexesReady__;
    } catch (error) {
      globalThis.__trackerFlightCacheIndexesReady__ = undefined;
      throw error;
    }

    return collection;
  } catch (error) {
    logMongoWarning(error);
    return null;
  }
}

async function getDetailsCacheCollection(): Promise<Collection<FlightDetailsCacheDocument> | null> {
  const mongoUri = process.env.MONGODB_URI?.trim();
  if (!mongoUri) {
    return null;
  }

  try {
    if (!globalThis.__trackerMongoClientPromise__) {
      const client = new MongoClient(mongoUri);
      globalThis.__trackerMongoClientPromise__ = client.connect();
    }

    let client: MongoClient;
    try {
      client = await globalThis.__trackerMongoClientPromise__;
    } catch (error) {
      globalThis.__trackerMongoClientPromise__ = undefined;
      throw error;
    }

    const collection = client.db(getMongoDbName()).collection<FlightDetailsCacheDocument>(DETAILS_CACHE_COLLECTION_NAME);

    if (!globalThis.__trackerFlightDetailsCacheIndexesReady__) {
      globalThis.__trackerFlightDetailsCacheIndexesReady__ = Promise.all([
        collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
        collection.createIndex({ updatedAt: -1 }),
      ]).then(() => undefined);
    }

    try {
      await globalThis.__trackerFlightDetailsCacheIndexesReady__;
    } catch (error) {
      globalThis.__trackerFlightDetailsCacheIndexesReady__ = undefined;
      throw error;
    }

    return collection;
  } catch (error) {
    logMongoWarning(error);
    return null;
  }
}

async function getAirportDirectoryCacheCollection(): Promise<Collection<AirportDirectoryCacheDocument> | null> {
  const mongoUri = process.env.MONGODB_URI?.trim();
  if (!mongoUri) {
    return null;
  }

  try {
    if (!globalThis.__trackerMongoClientPromise__) {
      const client = new MongoClient(mongoUri);
      globalThis.__trackerMongoClientPromise__ = client.connect();
    }

    let client: MongoClient;
    try {
      client = await globalThis.__trackerMongoClientPromise__;
    } catch (error) {
      globalThis.__trackerMongoClientPromise__ = undefined;
      throw error;
    }

    const collection = client
      .db(getMongoDbName())
      .collection<AirportDirectoryCacheDocument>(AIRPORT_DIRECTORY_CACHE_COLLECTION_NAME);

    if (!globalThis.__trackerAirportDirectoryCacheIndexesReady__) {
      globalThis.__trackerAirportDirectoryCacheIndexesReady__ = Promise.all([
        collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
        collection.createIndex({ updatedAt: -1 }),
      ]).then(() => undefined);
    }

    try {
      await globalThis.__trackerAirportDirectoryCacheIndexesReady__;
    } catch (error) {
      globalThis.__trackerAirportDirectoryCacheIndexesReady__ = undefined;
      throw error;
    }

    return collection;
  } catch (error) {
    logMongoWarning(error);
    return null;
  }
}

export function getFlightSearchCacheTtlSeconds(): number {
  return getCacheTtlSeconds();
}

export async function readFlightSearchCache(cacheKey: string): Promise<TrackerApiResponse | null> {
  const cachedInMemory = readFromMemory(cacheKey);
  if (cachedInMemory) {
    return cachedInMemory;
  }

  const collection = await getCacheCollection();
  if (!collection) {
    return null;
  }

  try {
    const cachedDocument = await collection.findOne({
      _id: cacheKey,
      expiresAt: { $gt: new Date() },
    });

    if (!cachedDocument) {
      return null;
    }

    const remainingTtlMs = Math.max(1, cachedDocument.expiresAt.getTime() - Date.now());
    writeToMemory(cacheKey, cachedDocument.payload, remainingTtlMs);
    return cachedDocument.payload;
  } catch (error) {
    logMongoWarning(error);
    return null;
  }
}

export async function writeFlightSearchCache(cacheKey: string, payload: TrackerApiResponse): Promise<void> {
  const ttlMs = getCacheTtlSeconds() * 1000;
  const expiresAt = new Date(Date.now() + ttlMs);

  writeToMemory(cacheKey, payload, ttlMs);

  const collection = await getCacheCollection();
  if (!collection) {
    return;
  }

  try {
    await collection.updateOne(
      { _id: cacheKey },
      {
        $set: {
          payload,
          expiresAt,
          updatedAt: new Date(payload.fetchedAt),
        },
      },
      { upsert: true },
    );
  } catch (error) {
    logMongoWarning(error);
  }
}

export async function readAirportDirectoryCache(cacheKey: string): Promise<AirportDetails[] | null> {
  const cachedInMemory = readAirportDirectoryFromMemory(cacheKey);
  if (cachedInMemory) {
    return cachedInMemory;
  }

  const collection = await getAirportDirectoryCacheCollection();
  if (!collection) {
    return null;
  }

  try {
    const cachedDocument = await collection.findOne({
      _id: cacheKey,
      expiresAt: { $gt: new Date() },
    });

    if (!cachedDocument) {
      return null;
    }

    const remainingTtlMs = Math.max(1, cachedDocument.expiresAt.getTime() - Date.now());
    writeAirportDirectoryToMemory(cacheKey, cachedDocument.payload, remainingTtlMs);
    return cachedDocument.payload;
  } catch (error) {
    logMongoWarning(error);
    return null;
  }
}

export async function writeAirportDirectoryCache(cacheKey: string, payload: AirportDetails[]): Promise<void> {
  const ttlMs = getAirportDirectoryCacheTtlSeconds() * 1000;
  const expiresAt = new Date(Date.now() + ttlMs);

  writeAirportDirectoryToMemory(cacheKey, payload, ttlMs);

  const collection = await getAirportDirectoryCacheCollection();
  if (!collection) {
    return;
  }

  try {
    await collection.updateOne(
      { _id: cacheKey },
      {
        $set: {
          payload,
          expiresAt,
          updatedAt: new Date(),
        },
      },
      { upsert: true },
    );
  } catch (error) {
    logMongoWarning(error);
  }
}

export async function readFlightDetailsCache(cacheKey: string): Promise<SelectedFlightDetails | null> {
  const cachedInMemory = readDetailsFromMemory(cacheKey);
  if (cachedInMemory) {
    return cachedInMemory;
  }

  const collection = await getDetailsCacheCollection();
  if (!collection) {
    return null;
  }

  try {
    const cachedDocument = await collection.findOne({
      _id: cacheKey,
      expiresAt: { $gt: new Date() },
    });

    if (!cachedDocument) {
      return null;
    }

    const remainingTtlMs = Math.max(1, cachedDocument.expiresAt.getTime() - Date.now());
    writeDetailsToMemory(cacheKey, cachedDocument.payload, remainingTtlMs);
    return cachedDocument.payload;
  } catch (error) {
    logMongoWarning(error);
    return null;
  }
}

export async function writeFlightDetailsCache(cacheKey: string, payload: SelectedFlightDetails): Promise<void> {
  const ttlMs = getDetailsCacheTtlSeconds() * 1000;
  const expiresAt = new Date(Date.now() + ttlMs);

  writeDetailsToMemory(cacheKey, payload, ttlMs);

  const collection = await getDetailsCacheCollection();
  if (!collection) {
    return;
  }

  try {
    await collection.updateOne(
      { _id: cacheKey },
      {
        $set: {
          payload,
          expiresAt,
          updatedAt: new Date(payload.fetchedAt),
        },
      },
      { upsert: true },
    );
  } catch (error) {
    logMongoWarning(error);
  }
}
