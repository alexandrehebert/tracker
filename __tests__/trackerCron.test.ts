import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackerApiResponse, TrackedFlight } from '~/components/tracker/flight/types';
import type { FriendsTrackerConfig } from '~/lib/friendsTracker';

const mockMongoCollections = new Map<string, Map<string, Record<string, unknown>>>();

function getMockMongoCollection(dbName: string, collectionName: string) {
  const key = `${dbName}:${collectionName}`;
  let store = mockMongoCollections.get(key);
  if (!store) {
    store = new Map<string, Record<string, unknown>>();
    mockMongoCollections.set(key, store);
  }

  return store;
}

vi.mock('mongodb', () => {
  class MongoClient {
    constructor(_uri: string) {}

    async connect() {
      return this;
    }

    db(dbName: string) {
      return {
        collection(collectionName: string) {
          const store = getMockMongoCollection(dbName, collectionName);

          return {
            async createIndex() {
              return `${collectionName}_idx`;
            },
            async findOne(query: { _id: string }) {
              const document = store.get(query._id);
              return document ? structuredClone(document) : null;
            },
            find(query: Record<string, unknown> = {}) {
              const documents = Array.from(store.values())
                .filter((document) => Object.entries(query).every(([key, value]) => document[key] === value));

              const cursor = {
                sort(sortDefinition: Record<string, 1 | -1>) {
                  const [[sortKey, sortDirection]] = Object.entries(sortDefinition);
                  const sorted = [...documents].sort((first, second) => {
                    const left = typeof first[sortKey] === 'number' ? first[sortKey] as number : 0;
                    const right = typeof second[sortKey] === 'number' ? second[sortKey] as number : 0;
                    return sortDirection === -1 ? right - left : left - right;
                  });

                  return {
                    limit(limitCount: number) {
                      return {
                        async toArray() {
                          return structuredClone(sorted.slice(0, limitCount));
                        },
                      };
                    },
                  };
                },
                async toArray() {
                  return documents.map((doc) => structuredClone(doc));
                },
              };

              return cursor;
            },
            async updateOne(
              filter: { _id: string },
              update: { $set: Record<string, unknown> },
            ) {
              const current = store.get(filter._id) ?? { _id: filter._id };
              const next = {
                ...current,
                ...structuredClone(update.$set),
                _id: filter._id,
              } satisfies Record<string, unknown>;

              store.set(filter._id, next);
              return {
                acknowledged: true,
                matchedCount: current._id ? 1 : 0,
                modifiedCount: 1,
                upsertedCount: current._id ? 0 : 1,
              };
            },
            async deleteOne(filter: { _id: string }) {
              store.delete(filter._id);
              return { acknowledged: true, deletedCount: 1 };
            },
          };
        },
      };
    }
  }

  return { MongoClient };
});

const searchFlightsMock = vi.fn<(
  query: string,
  options?: { forceRefresh?: boolean },
) => Promise<TrackerApiResponse>>();
const ensureOpenSkyAccessTokenMock = vi.fn().mockResolvedValue({
  providerConfigured: true,
  mongoConfigured: true,
  hasToken: true,
  cacheSource: 'memory',
  storageSource: 'oauth',
  tokenPreview: 'token-1…abcd',
  fetchedAt: 1_700_000_000_000,
  expiresAt: 1_700_001_800_000,
  expiresInMs: 1_800_000,
  isExpired: false,
});
const getOpenSkyTokenStatusMock = vi.fn().mockResolvedValue({
  providerConfigured: true,
  mongoConfigured: true,
  hasToken: true,
  cacheSource: 'memory',
  storageSource: 'oauth',
  tokenPreview: 'token-1…abcd',
  fetchedAt: 1_700_000_000_000,
  expiresAt: 1_700_001_800_000,
  expiresInMs: 1_800_000,
  isExpired: false,
});

vi.mock('~/lib/server/opensky', () => ({
  searchFlights: searchFlightsMock,
  ensureOpenSkyAccessToken: ensureOpenSkyAccessTokenMock,
  getOpenSkyTokenStatus: getOpenSkyTokenStatusMock,
}));

async function loadTrackerCronModule() {
  vi.resetModules();
  return await import('~/lib/server/trackerCron');
}

async function loadFriendsTrackerModule() {
  vi.resetModules();
  return await import('~/lib/server/friendsTracker');
}

async function loadChantalConfigRouteModule() {
  vi.resetModules();
  return await import('~/app/api/chantal/config/route');
}

function createTrackedFlight(identifier: string, icao24: string): TrackedFlight {
  return {
    icao24,
    callsign: identifier,
    originCountry: 'Testland',
    matchedBy: [identifier],
    lastContact: 1_700_000_000,
    current: null,
    originPoint: null,
    track: [],
    rawTrack: [],
    onGround: false,
    velocity: null,
    heading: null,
    verticalRate: null,
    geoAltitude: null,
    baroAltitude: null,
    squawk: null,
    category: null,
    route: {
      departureAirport: null,
      arrivalAirport: null,
      firstSeen: null,
      lastSeen: null,
    },
    dataSource: 'opensky',
    sourceDetails: [],
    fetchHistory: [],
  };
}

describe('tracker cron config and history', () => {
  const originalMongoDbUri = process.env.MONGODB_URI;
  const originalMongoDbName = process.env.MONGODB_DB_NAME;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    mockMongoCollections.clear();
    process.env.MONGODB_URI = 'mongodb://example.test:27017/tracker';
    process.env.MONGODB_DB_NAME = 'tracker-test';
  });

  afterEach(() => {
    if (originalMongoDbUri === undefined) {
      delete process.env.MONGODB_URI;
    } else {
      process.env.MONGODB_URI = originalMongoDbUri;
    }

    if (originalMongoDbName === undefined) {
      delete process.env.MONGODB_DB_NAME;
    } else {
      process.env.MONGODB_DB_NAME = originalMongoDbName;
    }
  });

  it('stores a normalized cron flight list in Mongo-backed config', async () => {
    const { getTrackerCronDashboard, writeTrackerCronConfig } = await loadTrackerCronModule();

    const saved = await writeTrackerCronConfig({
      identifiers: ' af123\nBA 117, af123 ',
      updatedBy: 'admin-ui',
    });

    expect(saved.identifiers).toEqual(['AF123', 'BA117']);
    expect(saved.updatedBy).toBe('admin-ui');

    const dashboard = await getTrackerCronDashboard();
    expect(dashboard.mongoConfigured).toBe(true);
    expect(dashboard.config.identifiers).toEqual(['AF123', 'BA117']);
    expect(dashboard.config.updatedBy).toBe('admin-ui');
  });

  it('preserves the saved flight list when only the cron enabled flag is updated', async () => {
    const { getTrackerCronDashboard, writeTrackerCronConfig } = await loadTrackerCronModule();

    await writeTrackerCronConfig({
      identifiers: ['AF123', 'BA117'],
      updatedBy: 'admin-ui',
    });

    const saved = await writeTrackerCronConfig({
      enabled: false,
      updatedBy: 'toggle-only',
    } as never);

    expect(saved.enabled).toBe(false);
    expect(saved.identifiers).toEqual(['AF123', 'BA117']);

    const dashboard = await getTrackerCronDashboard();
    expect(dashboard.config.enabled).toBe(false);
    expect(dashboard.config.identifiers).toEqual(['AF123', 'BA117']);
    expect(dashboard.config.updatedBy).toBe('toggle-only');
  });

  it('preserves the saved Chantal batch toggle and current demo trip when the map updates only the friend list', async () => {
    const { readFriendsTrackerConfig, writeFriendsTrackerConfig } = await loadFriendsTrackerModule();

    await writeFriendsTrackerConfig({
      updatedBy: 'chantal config page',
      cronEnabled: false,
      currentTripId: 'demo-test-trip',
      trips: [
        {
          id: 'trip-1',
          name: 'Lisbon',
          destinationAirport: 'LIS',
          friends: [
            {
              id: 'friend-live',
              name: 'Live Trip Friend',
              flights: [
                {
                  id: 'leg-live',
                  flightNumber: 'KL641',
                  departureTime: '2026-04-14T09:30:00.000Z',
                },
              ],
            },
          ],
        },
        {
          id: 'demo-test-trip',
          name: 'Demo / Test Trip',
          destinationAirport: 'JFK',
          isDemo: true,
          friends: [
            {
              id: 'friend-1',
              name: 'Alice',
              flights: [
                {
                  id: 'leg-1',
                  flightNumber: 'AF123',
                  departureTime: '2026-04-14T09:30:00.000Z',
                },
              ],
            },
          ],
        },
      ],
    });

    const autoLockedConfig = await writeFriendsTrackerConfig({
      updatedBy: 'chantal map auto-lock',
      friends: [
        {
          id: 'friend-1',
          name: 'Alice',
          flights: [
            {
              id: 'leg-1',
              flightNumber: 'AF123',
              departureTime: '2026-04-14T09:30:00.000Z',
              resolvedIcao24: '3c675a',
            },
          ],
        },
      ],
    });

    expect(autoLockedConfig.cronEnabled).toBe(false);
    expect(autoLockedConfig.currentTripId).toBe('demo-test-trip');

    const persisted = await readFriendsTrackerConfig();
    expect(persisted.cronEnabled).toBe(false);
    expect(persisted.currentTripId).toBe('demo-test-trip');
  });

  it('adds and removes Chantal-managed identifiers without changing the cron admin toggle', async () => {
    const { getTrackerCronDashboard, writeTrackerCronConfig } = await loadTrackerCronModule();
    const { writeFriendsTrackerConfig } = await loadFriendsTrackerModule();

    await writeTrackerCronConfig({
      identifiers: ['BA117'],
      enabled: false,
      updatedBy: 'tracker/cron admin page',
    });

    await writeFriendsTrackerConfig({
      updatedBy: 'chantal config page',
      cronEnabled: true,
      friends: [
        {
          id: 'friend-1',
          name: 'Alice',
          flights: [
            {
              id: 'leg-1',
              flightNumber: 'AF123',
              departureTime: '2026-04-14T09:30:00.000Z',
            },
          ],
        },
      ],
    });

    const enabledBatchDashboard = await getTrackerCronDashboard();
    expect(enabledBatchDashboard.config.enabled).toBe(false);
    expect(enabledBatchDashboard.config.identifiers).toEqual(['BA117', 'AF123']);
    expect(enabledBatchDashboard.config.manualIdentifiers).toEqual(['BA117']);
    expect(enabledBatchDashboard.config.chantalIdentifiers).toEqual(['AF123']);

    await writeFriendsTrackerConfig({
      updatedBy: 'chantal cron toggle',
      cronEnabled: false,
    });

    const disabledBatchDashboard = await getTrackerCronDashboard();
    expect(disabledBatchDashboard.config.enabled).toBe(false);
    expect(disabledBatchDashboard.config.identifiers).toEqual(['BA117']);
    expect(disabledBatchDashboard.config.manualIdentifiers).toEqual(['BA117']);
    expect(disabledBatchDashboard.config.chantalIdentifiers).toEqual([]);
  });

  it('preserves the saved friends when the Chantal cron toggle is saved on its own', async () => {
    const { readFriendsTrackerConfig, writeFriendsTrackerConfig } = await loadFriendsTrackerModule();
    const { PUT } = await loadChantalConfigRouteModule();

    await writeFriendsTrackerConfig({
      updatedBy: 'chantal config page',
      cronEnabled: true,
      friends: [
        {
          id: 'friend-1',
          name: 'Alice',
          flights: [
            {
              id: 'leg-1',
              flightNumber: 'AF123',
              departureTime: '2026-04-14T09:30:00.000Z',
            },
          ],
        },
      ],
    });

    const response = await PUT(new Request('http://localhost/api/chantal/config', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        updatedBy: 'chantal cron toggle',
        cronEnabled: false,
      }),
    }));

    const payload = await response.json() as FriendsTrackerConfig;

    expect(response.status).toBe(200);
    expect(payload.cronEnabled).toBe(false);
    expect(payload.friends).toHaveLength(1);
    expect(payload.friends[0]?.name).toBe('Alice');

    const persisted = await readFriendsTrackerConfig();
    expect(persisted.cronEnabled).toBe(false);
    expect(persisted.friends).toHaveLength(1);
  });

  it('still runs the Chantal batch when the manual tracker cron is disabled', async () => {
    searchFlightsMock.mockResolvedValueOnce({
      query: 'AF123',
      requestedIdentifiers: ['AF123'],
      matchedIdentifiers: ['AF123'],
      notFoundIdentifiers: [],
      fetchedAt: 1_700_000_001_000,
      flights: [createTrackedFlight('AF123', 'abc123')],
    });

    const { runTrackerCronJob, writeTrackerCronConfig } = await loadTrackerCronModule();
    const { writeFriendsTrackerConfig } = await loadFriendsTrackerModule();

    await writeTrackerCronConfig({
      identifiers: ['BA117'],
      enabled: false,
      updatedBy: 'tracker/cron admin page',
    });

    await writeFriendsTrackerConfig({
      updatedBy: 'chantal config page',
      cronEnabled: true,
      friends: [
        {
          id: 'friend-1',
          name: 'Alice',
          flights: [
            {
              id: 'leg-1',
              flightNumber: 'AF123',
              departureTime: '2026-04-14T09:30:00.000Z',
            },
          ],
        },
      ],
    });

    const run = await runTrackerCronJob({
      trigger: 'manual-admin',
      requestedBy: 'test-suite',
    });

    expect(run.status).toBe('success');
    expect(run.identifiers).toEqual(['AF123']);
    expect(searchFlightsMock).toHaveBeenCalledWith('AF123', {
      forceRefresh: true,
      forceFlightAwareRefresh: true,
    });
  });

  it('reuses cached FlightAware live data for scheduled Chantal cron runs but still allows manual cron refreshes', async () => {
    searchFlightsMock.mockResolvedValue({
      query: 'AF123',
      requestedIdentifiers: ['AF123'],
      matchedIdentifiers: ['AF123'],
      notFoundIdentifiers: [],
      fetchedAt: 1_700_000_001_000,
      flights: [createTrackedFlight('AF123', 'abc123')],
    });

    const { runTrackerCronJob } = await loadTrackerCronModule();
    const { writeFriendsTrackerConfig } = await loadFriendsTrackerModule();

    await writeFriendsTrackerConfig({
      updatedBy: 'chantal config page',
      cronEnabled: true,
      friends: [
        {
          id: 'friend-1',
          name: 'Alice',
          flights: [
            {
              id: 'leg-1',
              flightNumber: 'AF123',
              departureTime: '2026-04-14T09:30:00.000Z',
            },
          ],
        },
      ],
    });

    await runTrackerCronJob({
      trigger: 'vercel-cron',
      requestedBy: 'vercel-cron/1.0',
    });

    expect(searchFlightsMock).toHaveBeenNthCalledWith(1, 'AF123', {
      forceRefresh: true,
      externalDataMode: 'opensky-only',
    });

    await runTrackerCronJob({
      trigger: 'manual-admin',
      requestedBy: 'chantal config page',
    });

    expect(searchFlightsMock).toHaveBeenNthCalledWith(2, 'AF123', {
      forceRefresh: true,
      forceFlightAwareRefresh: true,
    });
  });

  it('lets a dedicated scheduled enrichment run opt back into the full provider fan-out', async () => {
    searchFlightsMock.mockResolvedValue({
      query: 'AF123',
      requestedIdentifiers: ['AF123'],
      matchedIdentifiers: ['AF123'],
      notFoundIdentifiers: [],
      fetchedAt: 1_700_000_001_000,
      flights: [createTrackedFlight('AF123', 'abc123')],
    });

    const { runTrackerCronJob } = await loadTrackerCronModule();
    const { writeFriendsTrackerConfig } = await loadFriendsTrackerModule();

    await writeFriendsTrackerConfig({
      updatedBy: 'chantal config page',
      cronEnabled: true,
      friends: [
        {
          id: 'friend-1',
          name: 'Alice',
          flights: [
            {
              id: 'leg-1',
              flightNumber: 'AF123',
              departureTime: '2026-04-14T09:30:00.000Z',
            },
          ],
        },
      ],
    });

    await runTrackerCronJob({
      trigger: 'vercel-cron',
      requestedBy: 'vercel-cron-enrichment/1.0',
      refreshMode: 'full',
    });

    expect(searchFlightsMock).toHaveBeenCalledWith('AF123', {
      forceRefresh: true,
    });
  });

  it('batches cron OpenSky refreshes so multiple identifiers are queried more gently', async () => {
    const originalBatchSize = process.env.TRACKER_CRON_OPENSKY_BATCH_SIZE;
    process.env.TRACKER_CRON_OPENSKY_BATCH_SIZE = '2';

    searchFlightsMock.mockResolvedValueOnce({
      query: 'AF123,BA117',
      requestedIdentifiers: ['AF123', 'BA117'],
      matchedIdentifiers: ['AF123'],
      notFoundIdentifiers: ['BA117'],
      fetchedAt: 1_700_000_001_000,
      flights: [createTrackedFlight('AF123', 'abc123')],
    });

    try {
      const { runTrackerCronJob, writeTrackerCronConfig } = await loadTrackerCronModule();
      await writeTrackerCronConfig({ identifiers: ['AF123', 'BA117'], updatedBy: 'admin-ui' });

      const run = await runTrackerCronJob({ trigger: 'manual-admin', requestedBy: 'dashboard' });

      expect(searchFlightsMock).toHaveBeenCalledTimes(1);
      expect(searchFlightsMock).toHaveBeenCalledWith('AF123,BA117', {
        forceRefresh: true,
        forceFlightAwareRefresh: true,
      });
      expect(run.results).toEqual(expect.arrayContaining([
        expect.objectContaining({ identifier: 'AF123', status: 'matched', flightCount: 1 }),
        expect.objectContaining({ identifier: 'BA117', status: 'not-found', flightCount: 0 }),
      ]));
    } finally {
      if (originalBatchSize === undefined) {
        delete process.env.TRACKER_CRON_OPENSKY_BATCH_SIZE;
      } else {
        process.env.TRACKER_CRON_OPENSKY_BATCH_SIZE = originalBatchSize;
      }
    }
  });

  it('records each cron execution and its per-flight results in history', async () => {
    searchFlightsMock
      .mockResolvedValueOnce({
        query: 'AF123,BA117',
        requestedIdentifiers: ['AF123', 'BA117'],
        matchedIdentifiers: ['AF123'],
        notFoundIdentifiers: ['BA117'],
        fetchedAt: 1_700_000_001_000,
        flights: [createTrackedFlight('AF123', 'abc123')],
      })
      .mockResolvedValueOnce({
        query: 'AF123',
        requestedIdentifiers: ['AF123'],
        matchedIdentifiers: ['AF123'],
        notFoundIdentifiers: [],
        fetchedAt: 1_700_000_003_000,
        flights: [createTrackedFlight('AF123', 'abc123')],
      });

    const { getTrackerCronDashboard, runTrackerCronJob, writeTrackerCronConfig } = await loadTrackerCronModule();

    await writeTrackerCronConfig({ identifiers: ['AF123', 'BA117'], updatedBy: 'admin-ui' });

    const firstRun = await runTrackerCronJob({ trigger: 'manual-admin', requestedBy: 'dashboard' });
    const secondRun = await runTrackerCronJob({ trigger: 'vercel-cron', overrideIdentifiers: ['AF123'] });

    expect(searchFlightsMock).toHaveBeenNthCalledWith(1, 'AF123,BA117', {
      forceRefresh: true,
      forceFlightAwareRefresh: true,
    });
    expect(searchFlightsMock).toHaveBeenNthCalledWith(2, 'AF123', {
      forceRefresh: true,
      externalDataMode: 'opensky-only',
    });
    expect(firstRun.status).toBe('partial');
    expect(firstRun.summary.totalIdentifiers).toBe(2);
    expect(firstRun.summary.matchedIdentifiers).toBe(1);
    expect(firstRun.summary.notFoundIdentifiers).toBe(1);
    expect(firstRun.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ identifier: 'AF123', status: 'matched', flightCount: 1 }),
      expect.objectContaining({ identifier: 'BA117', status: 'not-found', flightCount: 0 }),
    ]));

    expect(secondRun.status).toBe('success');
    expect(secondRun.results).toEqual([
      expect.objectContaining({ identifier: 'AF123', status: 'matched', flightCount: 1 }),
    ]);

    const dashboard = await getTrackerCronDashboard(10);
    expect(dashboard.history).toHaveLength(2);
    expect(dashboard.history[0]?.id).toBe(secondRun.id);
    expect(dashboard.history[1]?.id).toBe(firstRun.id);
    expect(dashboard.history[1]?.results).toHaveLength(2);
  });

  it('marks stale running executions as timed out on the dashboard', async () => {
    const historyStore = getMockMongoCollection('tracker-test', 'tracker_cron_history');
    const startedAt = Date.now() - 120_000;

    historyStore.set('tracker-cron:stale-run', {
      _id: 'tracker-cron:stale-run',
      id: 'tracker-cron:stale-run',
      trigger: 'vercel-cron',
      requestedBy: 'vercel-cron/1.0',
      status: 'running',
      startedAt,
      finishedAt: null,
      durationMs: null,
      identifiers: ['AF123'],
      results: [
        {
          identifier: 'AF123',
          status: 'matched',
          fetchedAt: startedAt + 5_000,
          matchedIdentifiers: ['AF123'],
          notFoundIdentifiers: [],
          flightCount: 1,
          cachedIcao24s: ['abc123'],
          error: null,
        },
      ],
      summary: {
        totalIdentifiers: 1,
        matchedIdentifiers: 1,
        notFoundIdentifiers: 0,
        errors: 0,
        flightsFetched: 1,
      },
      error: null,
    });

    const { getTrackerCronDashboard } = await loadTrackerCronModule();
    const dashboard = await getTrackerCronDashboard(10);

    expect(dashboard.history[0]?.id).toBe('tracker-cron:stale-run');
    expect(dashboard.history[0]?.status).toBe('error');
    expect(dashboard.history[0]?.error).toContain('timed out');
    expect(dashboard.history[0]?.finishedAt).not.toBeNull();
    expect(dashboard.history[0]?.durationMs).toBeGreaterThan(0);
  });
});
