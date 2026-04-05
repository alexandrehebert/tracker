import { MongoClient, type Collection } from 'mongodb';
import { searchFlights } from './opensky';

const DEFAULT_DB_NAME = 'tracker';
const TRACKER_CRON_CONFIG_COLLECTION_NAME = 'tracker_cron_config';
const TRACKER_CRON_HISTORY_COLLECTION_NAME = 'tracker_cron_history';
const DEFAULT_HISTORY_LIMIT = 100;
export const TRACKER_CRON_SCHEDULE = '*/15 * * * *';

export type TrackerCronTrigger = 'vercel-cron' | 'manual-admin' | 'manual-api';
export type TrackerCronRunStatus = 'running' | 'success' | 'partial' | 'error' | 'skipped';
export type TrackerCronFlightStatus = 'matched' | 'not-found' | 'error';

export interface TrackerCronConfig {
  enabled: boolean;
  identifiers: string[];
  schedule: string;
  updatedAt: number | null;
  updatedBy: string | null;
}

export interface TrackerCronFlightResult {
  identifier: string;
  status: TrackerCronFlightStatus;
  fetchedAt: number | null;
  matchedIdentifiers: string[];
  notFoundIdentifiers: string[];
  flightCount: number;
  cachedIcao24s: string[];
  error: string | null;
}

export interface TrackerCronRunSummary {
  totalIdentifiers: number;
  matchedIdentifiers: number;
  notFoundIdentifiers: number;
  errors: number;
  flightsFetched: number;
}

export interface TrackerCronRun {
  id: string;
  trigger: TrackerCronTrigger;
  requestedBy: string | null;
  status: TrackerCronRunStatus;
  startedAt: number;
  finishedAt: number | null;
  durationMs: number | null;
  identifiers: string[];
  results: TrackerCronFlightResult[];
  summary: TrackerCronRunSummary;
  error: string | null;
}

export interface TrackerCronDashboard {
  mongoConfigured: boolean;
  config: TrackerCronConfig;
  history: TrackerCronRun[];
}

type TrackerCronConfigDocument = TrackerCronConfig & {
  _id: 'default';
};

type TrackerCronRunDocument = TrackerCronRun & {
  _id: string;
};

const DEFAULT_CONFIG: TrackerCronConfig = {
  enabled: true,
  identifiers: [],
  schedule: TRACKER_CRON_SCHEDULE,
  updatedAt: null,
  updatedBy: null,
};

let mongoClientPromise: Promise<MongoClient> | null = null;
let trackerCronConfigIndexesReady: Promise<void> | null = null;
let trackerCronHistoryIndexesReady: Promise<void> | null = null;
let mongoWarningLogged = false;
let trackerCronRunSequence = 0;

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
  console.warn('MongoDB tracker cron storage is unavailable.', error);
}

function normalizeTrackerCronIdentifier(value: string | null | undefined): string {
  return typeof value === 'string' ? value.replace(/\s+/g, '').trim().toUpperCase() : '';
}

export function normalizeTrackerCronIdentifiers(input: string | string[]): string[] {
  const rawValues = Array.isArray(input)
    ? input.flatMap((value) => value.split(/[\n,]+/))
    : input.split(/[\n,]+/);

  return Array.from(new Set(rawValues.map(normalizeTrackerCronIdentifier).filter(Boolean)));
}

function normalizeTrackerCronConfig(config: Partial<TrackerCronConfig> | null | undefined): TrackerCronConfig {
  return {
    enabled: config?.enabled ?? DEFAULT_CONFIG.enabled,
    identifiers: normalizeTrackerCronIdentifiers(config?.identifiers ?? []),
    schedule: typeof config?.schedule === 'string' && config.schedule.trim()
      ? config.schedule.trim()
      : TRACKER_CRON_SCHEDULE,
    updatedAt: typeof config?.updatedAt === 'number' && Number.isFinite(config.updatedAt)
      ? config.updatedAt
      : null,
    updatedBy: typeof config?.updatedBy === 'string' && config.updatedBy.trim()
      ? config.updatedBy.trim()
      : null,
  };
}

function createEmptySummary(totalIdentifiers: number): TrackerCronRunSummary {
  return {
    totalIdentifiers,
    matchedIdentifiers: 0,
    notFoundIdentifiers: 0,
    errors: 0,
    flightsFetched: 0,
  };
}

function summarizeResults(results: TrackerCronFlightResult[]): TrackerCronRunSummary {
  return results.reduce<TrackerCronRunSummary>((summary, result) => ({
    totalIdentifiers: summary.totalIdentifiers + 1,
    matchedIdentifiers: summary.matchedIdentifiers + (result.status === 'matched' ? 1 : 0),
    notFoundIdentifiers: summary.notFoundIdentifiers + (result.status === 'not-found' ? 1 : 0),
    errors: summary.errors + (result.status === 'error' ? 1 : 0),
    flightsFetched: summary.flightsFetched + result.flightCount,
  }), createEmptySummary(0));
}

function resolveRunStatus(
  identifiers: string[],
  results: TrackerCronFlightResult[],
  runError: string | null,
): TrackerCronRunStatus {
  if (identifiers.length === 0) {
    return 'skipped';
  }

  const summary = summarizeResults(results);

  if (runError && summary.errors === identifiers.length) {
    return 'error';
  }

  if (summary.errors > 0 || summary.notFoundIdentifiers > 0) {
    return 'partial';
  }

  return 'success';
}

async function getTrackerCronConfigCollection(): Promise<Collection<TrackerCronConfigDocument> | null> {
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

    const collection = client.db(getMongoDbName()).collection<TrackerCronConfigDocument>(TRACKER_CRON_CONFIG_COLLECTION_NAME);

    if (!trackerCronConfigIndexesReady) {
      trackerCronConfigIndexesReady = Promise.all([
        collection.createIndex({ updatedAt: -1 }),
      ]).then(() => undefined);
    }

    try {
      await trackerCronConfigIndexesReady;
    } catch (error) {
      trackerCronConfigIndexesReady = null;
      throw error;
    }

    return collection;
  } catch (error) {
    logMongoWarning(error);
    return null;
  }
}

async function getTrackerCronHistoryCollection(): Promise<Collection<TrackerCronRunDocument> | null> {
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

    const collection = client.db(getMongoDbName()).collection<TrackerCronRunDocument>(TRACKER_CRON_HISTORY_COLLECTION_NAME);

    if (!trackerCronHistoryIndexesReady) {
      trackerCronHistoryIndexesReady = Promise.all([
        collection.createIndex({ startedAt: -1 }),
        collection.createIndex({ status: 1, startedAt: -1 }),
      ]).then(() => undefined);
    }

    try {
      await trackerCronHistoryIndexesReady;
    } catch (error) {
      trackerCronHistoryIndexesReady = null;
      throw error;
    }

    return collection;
  } catch (error) {
    logMongoWarning(error);
    return null;
  }
}

async function persistTrackerCronRun(run: TrackerCronRun): Promise<void> {
  const collection = await getTrackerCronHistoryCollection();
  if (!collection) {
    return;
  }

  try {
    await collection.updateOne(
      { _id: run.id } as Parameters<typeof collection.updateOne>[0],
      {
        $set: {
          ...run,
          _id: run.id,
        },
      },
      { upsert: true },
    );
  } catch (error) {
    logMongoWarning(error);
  }
}

export function isTrackerCronStorageConfigured(): boolean {
  return isMongoConfigured();
}

export async function readTrackerCronConfig(): Promise<TrackerCronConfig> {
  const collection = await getTrackerCronConfigCollection();
  if (!collection) {
    return { ...DEFAULT_CONFIG };
  }

  try {
    const document = await collection.findOne({ _id: 'default' } as Parameters<typeof collection.findOne>[0]);
    return normalizeTrackerCronConfig(document);
  } catch (error) {
    logMongoWarning(error);
    return { ...DEFAULT_CONFIG };
  }
}

export async function writeTrackerCronConfig(input: {
  identifiers: string | string[];
  enabled?: boolean;
  updatedBy?: string | null;
}): Promise<TrackerCronConfig> {
  const currentConfig = await readTrackerCronConfig();
  const nextConfig = normalizeTrackerCronConfig({
    ...currentConfig,
    enabled: input.enabled ?? currentConfig.enabled,
    identifiers: normalizeTrackerCronIdentifiers(input.identifiers),
    updatedAt: Date.now(),
    updatedBy: typeof input.updatedBy === 'string' ? input.updatedBy.trim() : null,
  });

  const collection = await getTrackerCronConfigCollection();
  if (!collection) {
    return nextConfig;
  }

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

  return nextConfig;
}

export async function listTrackerCronRuns(limit = DEFAULT_HISTORY_LIMIT): Promise<TrackerCronRun[]> {
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 500) : DEFAULT_HISTORY_LIMIT;
  const collection = await getTrackerCronHistoryCollection();
  if (!collection) {
    return [];
  }

  try {
    const documents = await collection.find({} as Parameters<typeof collection.find>[0])
      .sort({ startedAt: -1 })
      .limit(safeLimit)
      .toArray();

    return documents.map((document) => ({
      id: document.id,
      trigger: document.trigger,
      requestedBy: document.requestedBy ?? null,
      status: document.status,
      startedAt: document.startedAt,
      finishedAt: document.finishedAt ?? null,
      durationMs: document.durationMs ?? null,
      identifiers: normalizeTrackerCronIdentifiers(document.identifiers ?? []),
      results: Array.isArray(document.results) ? document.results : [],
      summary: document.summary ?? createEmptySummary(Array.isArray(document.identifiers) ? document.identifiers.length : 0),
      error: document.error ?? null,
    }));
  } catch (error) {
    logMongoWarning(error);
    return [];
  }
}

export async function getTrackerCronDashboard(limit = DEFAULT_HISTORY_LIMIT): Promise<TrackerCronDashboard> {
  const [config, history] = await Promise.all([
    readTrackerCronConfig(),
    listTrackerCronRuns(limit),
  ]);

  return {
    mongoConfigured: isMongoConfigured(),
    config,
    history,
  };
}

export async function runTrackerCronJob(options: {
  trigger?: TrackerCronTrigger;
  overrideIdentifiers?: string[];
  requestedBy?: string | null;
} = {}): Promise<TrackerCronRun> {
  const config = await readTrackerCronConfig();
  const identifiers = normalizeTrackerCronIdentifiers(options.overrideIdentifiers ?? config.identifiers);
  const sequence = trackerCronRunSequence++;
  const startedAt = Date.now() + sequence;
  const runId = `tracker-cron:${startedAt}:${Math.random().toString(36).slice(2, 8)}`;

  const baseRun: TrackerCronRun = {
    id: runId,
    trigger: options.trigger ?? 'manual-api',
    requestedBy: typeof options.requestedBy === 'string' && options.requestedBy.trim()
      ? options.requestedBy.trim()
      : null,
    status: 'running',
    startedAt,
    finishedAt: null,
    durationMs: null,
    identifiers,
    results: [],
    summary: createEmptySummary(identifiers.length),
    error: null,
  };

  await persistTrackerCronRun(baseRun);

  if (!config.enabled && !options.overrideIdentifiers) {
    const finishedAt = Date.now();
    const skippedRun: TrackerCronRun = {
      ...baseRun,
      status: 'skipped',
      finishedAt,
      durationMs: finishedAt - startedAt,
      error: 'Tracker cron is disabled in the saved configuration.',
    };
    await persistTrackerCronRun(skippedRun);
    return skippedRun;
  }

  if (identifiers.length === 0) {
    const finishedAt = Date.now();
    const skippedRun: TrackerCronRun = {
      ...baseRun,
      status: 'skipped',
      finishedAt,
      durationMs: finishedAt - startedAt,
      error: 'No flights are configured for the tracker cron.',
    };
    await persistTrackerCronRun(skippedRun);
    return skippedRun;
  }

  const results: TrackerCronFlightResult[] = [];
  let runError: string | null = null;

  for (const identifier of identifiers) {
    try {
      const payload = await searchFlights(identifier, { forceRefresh: true });
      const normalizedIdentifier = normalizeTrackerCronIdentifier(identifier);
      const matchedIdentifiers = (payload.matchedIdentifiers ?? []).map((value) => normalizeTrackerCronIdentifier(value)).filter(Boolean);
      const matched = matchedIdentifiers.includes(normalizedIdentifier) || payload.flights.length > 0;

      results.push({
        identifier: normalizedIdentifier,
        status: matched ? 'matched' : 'not-found',
        fetchedAt: typeof payload.fetchedAt === 'number' ? payload.fetchedAt : null,
        matchedIdentifiers,
        notFoundIdentifiers: (payload.notFoundIdentifiers ?? []).map((value) => normalizeTrackerCronIdentifier(value)).filter(Boolean),
        flightCount: payload.flights.length,
        cachedIcao24s: payload.flights.map((flight) => flight.icao24),
        error: null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Tracker cron fetch failed unexpectedly.';
      runError = runError ?? message;

      results.push({
        identifier: normalizeTrackerCronIdentifier(identifier),
        status: 'error',
        fetchedAt: null,
        matchedIdentifiers: [],
        notFoundIdentifiers: [],
        flightCount: 0,
        cachedIcao24s: [],
        error: message,
      });
    }
  }

  const finishedAt = Date.now();
  const summary = summarizeResults(results);
  const completedRun: TrackerCronRun = {
    ...baseRun,
    status: resolveRunStatus(identifiers, results, runError),
    finishedAt,
    durationMs: finishedAt - startedAt,
    results,
    summary,
    error: runError,
  };

  await persistTrackerCronRun(completedRun);
  return completedRun;
}
