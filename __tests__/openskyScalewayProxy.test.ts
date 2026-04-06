import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

async function loadHandler() {
  vi.resetModules();
  return (await import('../functions/opensky-proxy/handler.js')).handler as (event: Record<string, unknown>) => Promise<{
    statusCode: number;
    headers?: Record<string, string>;
    body: string;
  }>;
}

describe('Scaleway OpenSky proxy handler', () => {
  const originalProxySecret = process.env.OPENSKY_PROXY_SECRET;
  const originalClientId = process.env.OPENSKY_CLIENT_ID;
  const originalClientSecret = process.env.OPENSKY_CLIENT_SECRET;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.OPENSKY_PROXY_SECRET = 'test-shared-secret';
    process.env.OPENSKY_CLIENT_ID = 'client-id';
    process.env.OPENSKY_CLIENT_SECRET = 'client-secret';
  });

  afterEach(() => {
    if (originalProxySecret === undefined) {
      delete process.env.OPENSKY_PROXY_SECRET;
    } else {
      process.env.OPENSKY_PROXY_SECRET = originalProxySecret;
    }

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

    vi.unstubAllGlobals();
  });

  it('rejects requests without the shared secret', async () => {
    const handler = await loadHandler();
    const response = await handler({
      httpMethod: 'GET',
      path: '/health',
      headers: {},
    });

    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body)).toEqual({ error: 'Unauthorized proxy request.' });
  });

  it('returns health information for authorized requests', async () => {
    const handler = await loadHandler();
    const response = await handler({
      httpMethod: 'GET',
      path: '/opensky/health',
      headers: {
        'x-opensky-proxy-secret': 'test-shared-secret',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      ok: true,
      service: 'opensky-external-proxy',
      provider: 'scaleway-functions',
      protected: true,
    });
  });

  it('proxies the token request and injects the configured OpenSky credentials', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      access_token: 'token-123',
      expires_in: 1800,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    vi.stubGlobal('fetch', fetchMock);

    const handler = await loadHandler();
    const response = await handler({
      httpMethod: 'POST',
      path: '/auth/realms/opensky-network/protocol/openid-connect/token',
      headers: {
        'x-opensky-proxy-secret': 'test-shared-secret',
        accept: 'application/json',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({ access_token: 'token-123' });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token');

    const body = init.body as URLSearchParams;
    expect(body.get('grant_type')).toBe('client_credentials');
    expect(body.get('client_id')).toBe('client-id');
    expect(body.get('client_secret')).toBe('client-secret');
  });
});
