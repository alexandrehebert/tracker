import { AsyncLocalStorage } from 'node:async_hooks';
import { MongoClient, type Collection } from 'mongodb';
import type { FlightSourceName } from '~/components/tracker/flight/types';
import { ALL_PROVIDERS, getProviderLabel } from './index';

const DEFAULT_DB_NAME = 'tracker';
const PROVIDER_REQUEST_LOG_COLLECTION_NAME = 'provider_request_logs';
const MAX_LOG_WINDOW = 500;
const SENSITIVE_KEY_PATTERN = /authorization|token|secret|password|cookie|api[-_]?key|access[-_]?key/i;

type ProviderRequestLogStatus = 'success' | 'cached' | 'no-data' | 'skipped' | 'error';
export type ProviderRequestCaller = 'cron' | 'on-demand' | 'config' | 'details' | 'debug' | 'system';

export type ProviderRequestContext = {
  caller: ProviderRequestCaller;
  source?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type ProviderRequestLogEntry = {
  id: string;
  provider: FlightSourceName;
  caller: ProviderRequestCaller | string;
  source?: string | null;
  operation: string;
  status: ProviderRequestLogStatus;
  durationMs: number | null;
  createdAt: string;
  request: Record<string, unknown> | null;
  response: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  error?: {
    message: string;
    name?: string | null;
    code?: string | number | null;
  } | null;
};

type ProviderRequestLogDocument = Omit<ProviderRequestLogEntry, 'id' | 'createdAt'> & {
  createdAt: Date;
};

export type ProviderRequestSummaryCount = {
  caller: string;
  count: number;
};

export type ProviderRequestProviderSummary = {
  name: FlightSourceName;
  label: string;
  totalRequests: number;
  successCount: number;
  errorCount: number;
  cachedCount: number;
  noDataCount: number;
  skippedCount: number;
  averageDurationMs: number | null;
  lastRequestAt: string | null;
  callers: ProviderRequestSummaryCount[];
};

export type ProvidersDashboard = {
  generatedAt: string;
  logWindowSize: number;
  mongoConfigured: boolean;
  overview: {
    totalRequests: number;
    successCount: number;
    errorCount: number;
    cachedCount: number;
    noDataCount: number;
    skippedCount: number;
    latestRequestAt: string | null;
    callers: ProviderRequestSummaryCount[];
  };
  providers: ProviderRequestProviderSummary[];
  recentLogs: ProviderRequestLogEntry[];
};

const providerRequestContextStorage = new AsyncLocalStorage<ProviderRequestContext>();

let mongoClientPromise: Promise<MongoClient> | null = null;
let providerLogIndexesReady: Promise<void> | null = null;
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
  console.warn('MongoDB provider request logging is unavailable.', error);
}

function shouldRedactKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key);
}

function truncateText(value: string, maxLength = 600): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1)}…`;
}

function sanitizeUrl(value: string): string {
  try {
    const parsed = new URL(value);
    for (const key of parsed.searchParams.keys()) {
      if (shouldRedactKey(key)) {
        parsed.searchParams.set(key, '[redacted]');
      }
    }

    return truncateText(parsed.toString());
  } catch {
    return truncateText(
      value
        .replace(/([?&](?:access_key|api_key|token|secret|password)=)[^&]+/gi, '$1[redacted]')
        .replace(/\s+/g, ' ')
        .trim(),
    );
  }
}

function sanitizeForStorage(value: unknown, depth = 0, key = ''): unknown {
  if (value == null) {
    return null;
  }

  if (depth > 4) {
    return '[truncated]';
  }

  if (typeof value === 'string') {
    if (shouldRedactKey(key)) {
      return '[redacted]';
    }

    return /^https?:\/\//i.test(value) ? sanitizeUrl(value) : truncateText(value.replace(/\s+/g, ' ').trim());
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'bigint') {
    return String(value);
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((entry) => sanitizeForStorage(entry, depth + 1, key));
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .slice(0, 40)
      .map(([entryKey, entryValue]) => [entryKey, sanitizeForStorage(entryValue, depth + 1, entryKey)] as const)
      .filter(([, entryValue]) => entryValue !== undefined);

    return Object.fromEntries(entries);
  }

  return truncateText(String(value));
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (value == null) {
    return null;
  }

  if (typeof value === 'object' && !Array.isArray(value)) {
    return sanitizeForStorage(value) as Record<string, unknown>;
  }

  return {
    value: sanitizeForStorage(value),
  };
}

function serializeError(error: unknown): ProviderRequestLogEntry['error'] {
  if (!error) {
    return null;
  }

  if (error instanceof Error) {
    const withCode = error as Error & { code?: string | number };
    return {
      message: truncateText(error.message || 'Unknown provider request error.'),
      name: error.name || null,
      code: withCode.code ?? null,
    };
  }

  if (typeof error === 'object' && error !== null) {
    const candidate = error as { message?: unknown; name?: unknown; code?: unknown };
    return {
      message: truncateText(typeof candidate.message === 'string' ? candidate.message : String(error)),
      name: typeof candidate.name === 'string' ? candidate.name : null,
      code: typeof candidate.code === 'string' || typeof candidate.code === 'number' ? candidate.code : null,
    };
  }

  return {
    message: truncateText(String(error)),
    name: null,
    code: null,
  };
}

async function getProviderRequestLogCollection(): Promise<Collection<ProviderRequestLogDocument> | null> {
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

    const collection = client.db(getMongoDbName()).collection<ProviderRequestLogDocument>(PROVIDER_REQUEST_LOG_COLLECTION_NAME);

    if (!providerLogIndexesReady) {
      providerLogIndexesReady = Promise.all([
        collection.createIndex({ provider: 1, createdAt: -1 }),
        collection.createIndex({ caller: 1, createdAt: -1 }),
        collection.createIndex({ status: 1, createdAt: -1 }),
      ]).then(() => undefined);
    }

    try {
      await providerLogIndexesReady;
    } catch (error) {
      providerLogIndexesReady = null;
      throw error;
    }

    return collection;
  } catch (error) {
    logMongoWarning(error);
    return null;
  }
}

function getEmptyDashboard(logWindowSize: number): ProvidersDashboard {
  const recentLogs: ProviderRequestLogEntry[] = [];
  const summarized = summarizeProviderRequestLogs(recentLogs);

  return {
    generatedAt: new Date().toISOString(),
    logWindowSize,
    mongoConfigured: isMongoConfigured(),
    ...summarized,
  };
}

export function isProviderObservabilityConfigured(): boolean {
  return isMongoConfigured();
}

export function getProviderRequestContext(): ProviderRequestContext | null {
  return providerRequestContextStorage.getStore() ?? null;
}

export async function withProviderRequestContext<T>(
  context: ProviderRequestContext,
  callback: () => Promise<T> | T,
): Promise<T> {
  const current = getProviderRequestContext();
  const nextContext: ProviderRequestContext = {
    caller: context.caller,
    source: context.source ?? current?.source ?? null,
    metadata: {
      ...(current?.metadata ?? {}),
      ...(context.metadata ?? {}),
    },
  };

  return providerRequestContextStorage.run(nextContext, () => Promise.resolve(callback()));
}

export async function recordProviderRequestLog(params: {
  provider: FlightSourceName;
  operation: string;
  status: ProviderRequestLogStatus;
  durationMs?: number | null;
  request?: unknown;
  response?: unknown;
  metadata?: Record<string, unknown> | null;
  source?: string | null;
  caller?: ProviderRequestCaller | string;
  error?: unknown;
}): Promise<void> {
  const collection = await getProviderRequestLogCollection();
  if (!collection) {
    return;
  }

  const context = getProviderRequestContext();
  const now = new Date();
  const entry: ProviderRequestLogDocument = {
    provider: params.provider,
    caller: params.caller ?? context?.caller ?? 'system',
    source: params.source ?? context?.source ?? null,
    operation: params.operation,
    status: params.status,
    durationMs: typeof params.durationMs === 'number' && Number.isFinite(params.durationMs)
      ? Math.max(0, Math.round(params.durationMs))
      : null,
    createdAt: now,
    request: toRecord(params.request),
    response: toRecord(params.response),
    metadata: toRecord({
      ...(context?.metadata ?? {}),
      ...(params.metadata ?? {}),
    }),
    error: serializeError(params.error),
  };

  try {
    await collection.insertOne?.(entry as Parameters<Collection<ProviderRequestLogDocument>['insertOne']>[0]);
  } catch (error) {
    logMongoWarning(error);
  }
}

function toLogEntry(document: ProviderRequestLogDocument & { _id?: unknown }): ProviderRequestLogEntry {
  return {
    id: document._id != null ? String(document._id) : `${document.provider}:${document.operation}:${document.createdAt.toISOString()}`,
    provider: document.provider,
    caller: document.caller,
    source: document.source ?? null,
    operation: document.operation,
    status: document.status,
    durationMs: document.durationMs ?? null,
    createdAt: document.createdAt instanceof Date ? document.createdAt.toISOString() : new Date(document.createdAt).toISOString(),
    request: document.request ?? null,
    response: document.response ?? null,
    metadata: document.metadata ?? null,
    error: document.error ?? null,
  };
}

function createCallerCounts(logs: ProviderRequestLogEntry[]): ProviderRequestSummaryCount[] {
  const counts = new Map<string, number>();

  for (const log of logs) {
    counts.set(log.caller, (counts.get(log.caller) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([caller, count]) => ({ caller, count }))
    .sort((left, right) => right.count - left.count || left.caller.localeCompare(right.caller));
}

export function formatProviderCallerLabel(caller: string): string {
  switch (caller) {
    case 'cron':
      return 'Cron';
    case 'on-demand':
      return 'On-demand';
    case 'config':
      return 'Config';
    case 'details':
      return 'Details';
    case 'debug':
      return 'Debug';
    case 'system':
      return 'System';
    default:
      return caller;
  }
}

export function summarizeProviderRequestLogs(logs: ProviderRequestLogEntry[]): Omit<ProvidersDashboard, 'generatedAt' | 'logWindowSize' | 'mongoConfigured'> {
  const orderedLogs = [...logs].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  const totalRequests = orderedLogs.length;
  const successCount = orderedLogs.filter((log) => log.status === 'success').length;
  const errorCount = orderedLogs.filter((log) => log.status === 'error').length;
  const cachedCount = orderedLogs.filter((log) => log.status === 'cached').length;
  const noDataCount = orderedLogs.filter((log) => log.status === 'no-data').length;
  const skippedCount = orderedLogs.filter((log) => log.status === 'skipped').length;

  const providers: ProviderRequestProviderSummary[] = [...ALL_PROVIDERS].map((provider) => {
    const providerLogs = orderedLogs.filter((log) => log.provider === provider);
    const durations = providerLogs
      .map((log) => log.durationMs)
      .filter((duration): duration is number => typeof duration === 'number' && Number.isFinite(duration));

    return {
      name: provider,
      label: getProviderLabel(provider),
      totalRequests: providerLogs.length,
      successCount: providerLogs.filter((log) => log.status === 'success').length,
      errorCount: providerLogs.filter((log) => log.status === 'error').length,
      cachedCount: providerLogs.filter((log) => log.status === 'cached').length,
      noDataCount: providerLogs.filter((log) => log.status === 'no-data').length,
      skippedCount: providerLogs.filter((log) => log.status === 'skipped').length,
      averageDurationMs: durations.length > 0
        ? Math.round(durations.reduce((total, duration) => total + duration, 0) / durations.length)
        : null,
      lastRequestAt: providerLogs[0]?.createdAt ?? null,
      callers: createCallerCounts(providerLogs),
    };
  });

  return {
    overview: {
      totalRequests,
      successCount,
      errorCount,
      cachedCount,
      noDataCount,
      skippedCount,
      latestRequestAt: orderedLogs[0]?.createdAt ?? null,
      callers: createCallerCounts(orderedLogs),
    },
    providers,
    recentLogs: orderedLogs,
  };
}

export async function getProvidersDashboard(limit = 200): Promise<ProvidersDashboard> {
  const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(Math.floor(limit), 1), MAX_LOG_WINDOW) : 200;
  const collection = await getProviderRequestLogCollection();

  if (!collection) {
    return getEmptyDashboard(safeLimit);
  }

  try {
    const documents = await collection
      .find({} as Parameters<Collection<ProviderRequestLogDocument>['find']>[0])
      .sort({ createdAt: -1 })
      .limit(safeLimit)
      .toArray();

    const recentLogs = documents.map((document) => toLogEntry(document));
    const summarized = summarizeProviderRequestLogs(recentLogs);

    return {
      generatedAt: new Date().toISOString(),
      logWindowSize: safeLimit,
      mongoConfigured: true,
      ...summarized,
    };
  } catch (error) {
    logMongoWarning(error);
    return getEmptyDashboard(safeLimit);
  }
}
