import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
            async findOne(query: { _id: string; expiresAt?: { $gt: Date } }) {
              const document = store.get(query._id);
              if (!document) {
                return null;
              }

              const expiryLimit = query.expiresAt?.$gt;
              const expiresAt = document.expiresAt;
              if (expiryLimit && expiresAt instanceof Date && expiresAt <= expiryLimit) {
                return null;
              }

              return structuredClone(document);
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
            find(_query: Record<string, unknown>) {
              return {
                async toArray() {
                  return [...store.values()].map((doc) => structuredClone(doc));
                },
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

async function loadSearchFlights() {
  vi.resetModules();
  return (await import('~/lib/server/opensky')).searchFlights;
}

async function loadFlightSelectionDetails() {
  vi.resetModules();
  return (await import('~/lib/server/flightSelectionDetails')).getFlightSelectionDetails;
}

async function loadFlightCache() {
  vi.resetModules();
  return await import('~/lib/server/flightCache');
}

describe('searchFlights', () => {
  const originalClientId = process.env.OPENSKY_CLIENT_ID;
  const originalClientSecret = process.env.OPENSKY_CLIENT_SECRET;
  const originalAviationStackApiKey = process.env.AVIATION_STACK_API_KEY;
  const originalFlightAwareApiKey = process.env.FLIGHTAWARE_API_KEY;
  const originalFlightAwareApiKeyAlt = process.env.FLIGHT_AWARE_API_KEY;
  const originalEnabledApiProviders = process.env.ENABLED_API_PROVIDERS;
  const originalDisabledApiProviders = process.env.DISABLED_API_PROVIDERS;
  const originalOpenSkyDisabled = process.env.OPENSKY_DISABLED;
  const originalFlightAwareDisabled = process.env.FLIGHTAWARE_DISABLED;
  const originalAviationstackDisabled = process.env.AVIATIONSTACK_DISABLED;
  const originalMongoDbUri = process.env.MONGODB_URI;
  const originalCacheTtl = process.env.OPENSKY_CACHE_TTL_SECONDS;
  const originalOpenSkyProxyUrl = process.env.OPENSKY_PROXY_URL;
  const originalOpenSkyProxySecret = process.env.OPENSKY_PROXY_SECRET;

  beforeEach(() => {
    vi.restoreAllMocks();
    mockMongoCollections.clear();
    delete process.env.OPENSKY_CLIENT_ID;
    delete process.env.OPENSKY_CLIENT_SECRET;
    delete process.env.OPENSKY_PROXY_URL;
    delete process.env.OPENSKY_PROXY_SECRET;
  });

  afterEach(() => {
    if (originalClientId === undefined) {
      delete process.env.OPENSKY_CLIENT_ID;
    } else {
      process.env.OPENSKY_CLIENT_ID = originalClientId;
    }

    if (originalClientSecret === undefined) {
      delete process.env.OPENSKY_CLIENT_SECRET;
    } else {
      process.env.OPENSKY_CLIENT_SECRET = originalClientSecret;
    }

    if (originalAviationStackApiKey === undefined) {
      delete process.env.AVIATION_STACK_API_KEY;
    } else {
      process.env.AVIATION_STACK_API_KEY = originalAviationStackApiKey;
    }

    if (originalFlightAwareApiKey === undefined) {
      delete process.env.FLIGHTAWARE_API_KEY;
    } else {
      process.env.FLIGHTAWARE_API_KEY = originalFlightAwareApiKey;
    }

    if (originalFlightAwareApiKeyAlt === undefined) {
      delete process.env.FLIGHT_AWARE_API_KEY;
    } else {
      process.env.FLIGHT_AWARE_API_KEY = originalFlightAwareApiKeyAlt;
    }

    if (originalMongoDbUri === undefined) {
      delete process.env.MONGODB_URI;
    } else {
      process.env.MONGODB_URI = originalMongoDbUri;
    }

    if (originalCacheTtl === undefined) {
      delete process.env.OPENSKY_CACHE_TTL_SECONDS;
    } else {
      process.env.OPENSKY_CACHE_TTL_SECONDS = originalCacheTtl;
    }

    if (originalOpenSkyProxyUrl === undefined) {
      delete process.env.OPENSKY_PROXY_URL;
    } else {
      process.env.OPENSKY_PROXY_URL = originalOpenSkyProxyUrl;
    }

    if (originalOpenSkyProxySecret === undefined) {
      delete process.env.OPENSKY_PROXY_SECRET;
    } else {
      process.env.OPENSKY_PROXY_SECRET = originalOpenSkyProxySecret;
    }

    if (originalEnabledApiProviders === undefined) {
      delete process.env.ENABLED_API_PROVIDERS;
    } else {
      process.env.ENABLED_API_PROVIDERS = originalEnabledApiProviders;
    }

    if (originalDisabledApiProviders === undefined) {
      delete process.env.DISABLED_API_PROVIDERS;
    } else {
      process.env.DISABLED_API_PROVIDERS = originalDisabledApiProviders;
    }

    if (originalOpenSkyDisabled === undefined) {
      delete process.env.OPENSKY_DISABLED;
    } else {
      process.env.OPENSKY_DISABLED = originalOpenSkyDisabled;
    }

    if (originalFlightAwareDisabled === undefined) {
      delete process.env.FLIGHTAWARE_DISABLED;
    } else {
      process.env.FLIGHTAWARE_DISABLED = originalFlightAwareDisabled;
    }

    if (originalAviationstackDisabled === undefined) {
      delete process.env.AVIATIONSTACK_DISABLED;
    } else {
      process.env.AVIATIONSTACK_DISABLED = originalAviationstackDisabled;
    }

    vi.unstubAllGlobals();
  });

  it('reads OpenSky credentials from environment variables', async () => {
    process.env.OPENSKY_CLIENT_ID = 'client-from-env';
    process.env.OPENSKY_CLIENT_SECRET = 'secret-from-env';

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'token-123', expires_in: 1800 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ time: 123, states: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));

    vi.stubGlobal('fetch', fetchMock);

    const searchFlights = await loadSearchFlights();
    const result = await searchFlights('AF123');

    expect(result.requestedIdentifiers).toEqual(['AF123']);
    expect(result.flights).toEqual([]);

    const [authUrl, authInit] = fetchMock.mock.calls[0] as [string, RequestInit & { dispatcher?: unknown }];
    expect(authUrl).toBe('https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token');
    expect(authInit.method).toBe('POST');
    expect(authInit.dispatcher).toBeDefined();

    const params = authInit.body as URLSearchParams;
    expect(params.get('client_id')).toBe('client-from-env');
    expect(params.get('client_secret')).toBe('secret-from-env');
  });

  it('supports routing OpenSky traffic through an external proxy without direct credentials on Vercel', async () => {
    process.env.OPENSKY_PROXY_URL = 'https://proxy.example.test';
    process.env.OPENSKY_PROXY_SECRET = 'proxy-shared-secret';

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'proxy-token', expires_in: 1800 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ time: 123, states: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));

    vi.stubGlobal('fetch', fetchMock);

    const searchFlights = await loadSearchFlights();
    const result = await searchFlights('AF123');

    expect(result.requestedIdentifiers).toEqual(['AF123']);
    expect(result.flights).toEqual([]);

    const [authUrl, authInit] = fetchMock.mock.calls[0] as [string, RequestInit & { headers?: HeadersInit }];
    const authHeaders = new Headers(authInit.headers);
    expect(authUrl).toBe('https://proxy.example.test/auth/realms/opensky-network/protocol/openid-connect/token');
    expect(authHeaders.get('x-opensky-proxy-secret')).toBe('proxy-shared-secret');

    const [apiUrl, apiInit] = fetchMock.mock.calls[1] as [string, RequestInit & { headers?: HeadersInit }];
    const apiHeaders = new Headers(apiInit.headers);
    expect(String(apiUrl)).toContain('https://proxy.example.test/api/states/all');
    expect(apiHeaders.get('x-opensky-proxy-secret')).toBe('proxy-shared-secret');
    expect(apiHeaders.get('authorization')).toBe('Bearer proxy-token');
  });

  it('reuses a Mongo-backed OpenSky access token across module reloads until expiry', async () => {
    process.env.OPENSKY_CLIENT_ID = 'client-from-env';
    process.env.OPENSKY_CLIENT_SECRET = 'secret-from-env';
    process.env.MONGODB_URI = 'mongodb://example.test:27017/tracker';
    process.env.MONGODB_DB_NAME = 'tracker-test';

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url.includes('/protocol/openid-connect/token')) {
        return new Response(JSON.stringify({ access_token: 'token-123', expires_in: 1800 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.includes('/states/all')) {
        return new Response(JSON.stringify({ time: 123, states: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.includes('/flights/all')) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      throw new Error(`Unexpected fetch URL in test: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    const firstSearchFlights = await loadSearchFlights();
    const firstResult = await firstSearchFlights('AF123');
    const secondSearchFlights = await loadSearchFlights();
    const secondResult = await secondSearchFlights('AF123', { forceRefresh: true });

    expect(firstResult.requestedIdentifiers).toEqual(['AF123']);
    expect(secondResult.requestedIdentifiers).toEqual(['AF123']);

    const authCalls = fetchMock.mock.calls.filter(([input]) => String(input).includes('/protocol/openid-connect/token'));
    const stateCalls = fetchMock.mock.calls.filter(([input]) => String(input).includes('/states/all'));

    expect(authCalls).toHaveLength(1);
    expect(stateCalls.length).toBeGreaterThanOrEqual(2);
  });

  it('retries OpenSky auth once after a transient connect timeout', async () => {
    process.env.OPENSKY_CLIENT_ID = 'client-from-env';
    process.env.OPENSKY_CLIENT_SECRET = 'secret-from-env';

    const networkCause = Object.assign(new Error('connect timeout reached'), {
      code: 'UND_ERR_CONNECT_TIMEOUT',
      errno: 'ETIMEDOUT',
      syscall: 'connect',
      host: 'auth.opensky-network.org',
    });
    const fetchError = Object.assign(new TypeError('fetch failed'), { cause: networkCause });

    const fetchMock = vi.fn()
      .mockRejectedValueOnce(fetchError)
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'token-123', expires_in: 1800 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ time: 123, states: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));

    vi.stubGlobal('fetch', fetchMock);

    const searchFlights = await loadSearchFlights();
    const result = await searchFlights('AF123');

    expect(result.requestedIdentifiers).toEqual(['AF123']);
    expect(result.flights).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token');
  });

  it('retries OpenSky auth once after an AbortSignal timeout', async () => {
    process.env.OPENSKY_CLIENT_ID = 'client-from-env';
    process.env.OPENSKY_CLIENT_SECRET = 'secret-from-env';

    const timeoutError = Object.assign(new Error('The operation was aborted due to timeout'), {
      name: 'TimeoutError',
      code: 23,
    });

    const fetchMock = vi.fn()
      .mockRejectedValueOnce(timeoutError)
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'token-123', expires_in: 1800 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ time: 123, states: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));

    vi.stubGlobal('fetch', fetchMock);

    const searchFlights = await loadSearchFlights();
    const result = await searchFlights('AF123');

    expect(result.requestedIdentifiers).toEqual(['AF123']);
    expect(result.flights).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token');
  });

  it('fails fast when the OpenSky env vars are missing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const searchFlights = await loadSearchFlights();

    await expect(searchFlights('AF123')).rejects.toThrow(
      'Missing OpenSky client credentials. Set OPENSKY_CLIENT_ID and OPENSKY_CLIENT_SECRET in your environment, or configure OPENSKY_PROXY_URL for an external proxy.',
    );

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
