import 'server-only';

import { MongoClient, type Collection } from 'mongodb';
import type { ChantalPositionSnapshot } from '~/lib/chantalV2';

const DEFAULT_DB_NAME = 'tracker';
const COLLECTION_NAME = 'chantal_v2_position_snapshots';
/** Keep the last ~60 hours of snapshots at 5-minute intervals (720 docs). */
const MAX_SNAPSHOTS = 720;

type SnapshotDocument = ChantalPositionSnapshot & { _id: string };

let mongoClientPromise: Promise<MongoClient> | null = null;
let indexesReady: Promise<void> | null = null;
let mongoWarningLogged = false;

function getMongoDbName(): string {
  return process.env.MONGODB_DB_NAME?.trim() || DEFAULT_DB_NAME;
}

function logMongoWarning(error: unknown): void {
  if (mongoWarningLogged) {
    return;
  }

  mongoWarningLogged = true;
  console.warn('Chantal V2 snapshot storage is unavailable.', error);
}

async function getSnapshotCollection(): Promise<Collection<SnapshotDocument> | null> {
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

    const collection = client.db(getMongoDbName()).collection<SnapshotDocument>(COLLECTION_NAME);

    if (!indexesReady) {
      indexesReady = Promise.all([
        collection.createIndex({ capturedAt: -1 }),
        collection.createIndex({ tripId: 1, capturedAt: -1 }),
      ]).then(() => undefined);
    }

    try {
      await indexesReady;
    } catch (error) {
      indexesReady = null;
      throw error;
    }

    return collection;
  } catch (error) {
    logMongoWarning(error);
    return null;
  }
}

export function isChantalV2SnapshotStorageConfigured(): boolean {
  return Boolean(process.env.MONGODB_URI?.trim());
}

/** Persist a position snapshot. Old snapshots are pruned to stay within the limit. */
export async function savePositionSnapshot(snapshot: ChantalPositionSnapshot): Promise<void> {
  const collection = await getSnapshotCollection();
  if (!collection) {
    return;
  }

  try {
    await collection.updateOne(
      { _id: snapshot.id } as Parameters<typeof collection.updateOne>[0],
      {
        $set: {
          ...snapshot,
          _id: snapshot.id,
        },
      },
      { upsert: true },
    );

    // Prune oldest snapshots beyond the retention limit.
    const totalCount = await collection.countDocuments();
    if (totalCount > MAX_SNAPSHOTS) {
      const toDelete = totalCount - MAX_SNAPSHOTS;
      const oldest = await collection
        .find({} as Parameters<typeof collection.find>[0])
        .sort({ capturedAt: 1 })
        .limit(toDelete)
        .project({ _id: 1 })
        .toArray();

      const ids = oldest.map((doc) => doc._id);
      if (ids.length > 0) {
        await collection.deleteMany({ _id: { $in: ids } } as Parameters<typeof collection.deleteMany>[0]);
      }
    }
  } catch (error) {
    logMongoWarning(error);
  }
}

/** Returns the most recently captured position snapshot, or null if none. */
export async function getLatestPositionSnapshot(): Promise<ChantalPositionSnapshot | null> {
  const collection = await getSnapshotCollection();
  if (!collection) {
    return null;
  }

  try {
    const doc = await collection
      .find({} as Parameters<typeof collection.find>[0])
      .sort({ capturedAt: -1 })
      .limit(1)
      .toArray();

    return doc[0] ?? null;
  } catch (error) {
    logMongoWarning(error);
    return null;
  }
}

/**
 * Returns an ordered list of snapshot capturedAt timestamps (newest first),
 * up to the given limit.
 */
export async function listPositionSnapshotTimestamps(limit = MAX_SNAPSHOTS): Promise<number[]> {
  const collection = await getSnapshotCollection();
  if (!collection) {
    return [];
  }

  const safeLimit = Math.min(Math.max(limit, 1), MAX_SNAPSHOTS);

  try {
    const docs = await collection
      .find({} as Parameters<typeof collection.find>[0])
      .sort({ capturedAt: -1 })
      .limit(safeLimit)
      .project({ capturedAt: 1 })
      .toArray();

    return docs.map((doc) => doc.capturedAt);
  } catch (error) {
    logMongoWarning(error);
    return [];
  }
}

/**
 * Returns the snapshot whose capturedAt is closest to (and not after) the given
 * targetMs. Falls back to the oldest available snapshot when nothing precedes the
 * target time.
 */
export async function getPositionSnapshotAt(targetMs: number): Promise<ChantalPositionSnapshot | null> {
  const collection = await getSnapshotCollection();
  if (!collection) {
    return null;
  }

  try {
    const doc = await collection
      .find({ capturedAt: { $lte: targetMs } } as Parameters<typeof collection.find>[0])
      .sort({ capturedAt: -1 })
      .limit(1)
      .toArray();

    if (doc[0]) {
      return doc[0];
    }

    // Fallback: return the oldest available snapshot even if it's after targetMs.
    const oldest = await collection
      .find({} as Parameters<typeof collection.find>[0])
      .sort({ capturedAt: 1 })
      .limit(1)
      .toArray();

    return oldest[0] ?? null;
  } catch (error) {
    logMongoWarning(error);
    return null;
  }
}
