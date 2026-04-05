import { createServer } from 'node:http';

const PORT = Number.parseInt(process.env.PORT ?? '8787', 10);
const OPENSKY_PROXY_SECRET = process.env.OPENSKY_PROXY_SECRET?.trim() ?? '';
const OPENSKY_CLIENT_ID = process.env.OPENSKY_CLIENT_ID?.trim() ?? '';
const OPENSKY_CLIENT_SECRET = process.env.OPENSKY_CLIENT_SECRET?.trim() ?? '';
const OPENSKY_TOKEN_URL = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';
const OPENSKY_API_BASE = 'https://opensky-network.org/api';
const TOKEN_REFRESH_MARGIN_MS = 30_000;

let tokenCache = null;
let tokenFetchPromise = null;

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store, max-age=0',
  });
  response.end(JSON.stringify(payload));
}

function isTokenValid(token) {
  return Boolean(token?.accessToken) && Date.now() < token.expiresAt - TOKEN_REFRESH_MARGIN_MS;
}

function isAuthorized(request) {
  if (!OPENSKY_PROXY_SECRET) {
    return true;
  }

  return request.headers['x-opensky-proxy-secret'] === OPENSKY_PROXY_SECRET;
}

function copyResponseHeaders(headers) {
  const next = {};

  for (const [key, value] of headers.entries()) {
    if (/^content-encoding$/i.test(key) || /^transfer-encoding$/i.test(key) || /^connection$/i.test(key)) {
      continue;
    }

    next[key] = value;
  }

  next['cache-control'] = 'no-store, max-age=0';
  return next;
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    request.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    request.on('end', () => {
      resolve(Buffer.concat(chunks));
    });

    request.on('error', reject);
  });
}

async function getAccessToken(forceRefresh = false) {
  if (!OPENSKY_CLIENT_ID || !OPENSKY_CLIENT_SECRET) {
    throw new Error('Set OPENSKY_CLIENT_ID and OPENSKY_CLIENT_SECRET on the proxy host.');
  }

  if (!forceRefresh && isTokenValid(tokenCache)) {
    return tokenCache.accessToken;
  }

  if (!tokenFetchPromise) {
    tokenFetchPromise = (async () => {
      const body = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: OPENSKY_CLIENT_ID,
        client_secret: OPENSKY_CLIENT_SECRET,
      });

      const response = await fetch(OPENSKY_TOKEN_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
        },
        body,
        cache: 'no-store',
      });

      const text = await response.text();
      if (!response.ok) {
        throw new Error(`OpenSky token request failed (${response.status} ${response.statusText}): ${text.slice(0, 300)}`);
      }

      const payload = JSON.parse(text);
      if (!payload?.access_token) {
        throw new Error('OpenSky token response did not include access_token.');
      }

      tokenCache = {
        accessToken: payload.access_token,
        expiresAt: Date.now() + ((payload.expires_in ?? 1800) * 1000),
      };

      return tokenCache.accessToken;
    })().finally(() => {
      tokenFetchPromise = null;
    });
  }

  return tokenFetchPromise;
}

async function proxyOpenSkyToken(request, response) {
  const rawBody = await readRequestBody(request);
  const params = new URLSearchParams(rawBody.toString('utf8'));

  if (!params.get('grant_type')) {
    params.set('grant_type', 'client_credentials');
  }

  if (!params.get('client_id') && OPENSKY_CLIENT_ID) {
    params.set('client_id', OPENSKY_CLIENT_ID);
  }

  if (!params.get('client_secret') && OPENSKY_CLIENT_SECRET) {
    params.set('client_secret', OPENSKY_CLIENT_SECRET);
  }

  const upstream = await fetch(OPENSKY_TOKEN_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: request.headers.accept ?? 'application/json',
    },
    body: params,
    cache: 'no-store',
  });

  const text = await upstream.text();
  if (upstream.ok) {
    try {
      const payload = JSON.parse(text);
      if (payload?.access_token) {
        tokenCache = {
          accessToken: payload.access_token,
          expiresAt: Date.now() + ((payload.expires_in ?? 1800) * 1000),
        };
      }
    } catch {
      // Ignore cache warm-up if the payload is not JSON.
    }
  }

  response.writeHead(upstream.status, copyResponseHeaders(upstream.headers));
  response.end(text);
}

async function proxyOpenSkyApi(request, response, requestUrl) {
  const upstreamUrl = `${OPENSKY_API_BASE}${requestUrl.pathname.slice('/api'.length)}${requestUrl.search}`;
  const headers = new Headers();

  if (request.headers.accept) {
    headers.set('accept', request.headers.accept);
  }

  if (request.headers['content-type']) {
    headers.set('content-type', request.headers['content-type']);
  }

  const incomingAuthorization = typeof request.headers.authorization === 'string'
    ? request.headers.authorization.trim()
    : '';

  if (incomingAuthorization) {
    headers.set('authorization', incomingAuthorization);
  } else if (OPENSKY_CLIENT_ID && OPENSKY_CLIENT_SECRET) {
    headers.set('authorization', `Bearer ${await getAccessToken()}`);
  }

  const method = request.method ?? 'GET';
  const body = method === 'GET' || method === 'HEAD'
    ? undefined
    : await readRequestBody(request);

  let upstream = await fetch(upstreamUrl, {
    method,
    headers,
    body,
    cache: 'no-store',
  });

  if (upstream.status === 401 && !incomingAuthorization && OPENSKY_CLIENT_ID && OPENSKY_CLIENT_SECRET) {
    headers.set('authorization', `Bearer ${await getAccessToken(true)}`);
    upstream = await fetch(upstreamUrl, {
      method,
      headers,
      body,
      cache: 'no-store',
    });
  }

  const payload = Buffer.from(await upstream.arrayBuffer());
  response.writeHead(upstream.status, copyResponseHeaders(upstream.headers));
  response.end(payload);
}

const server = createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

    if (!isAuthorized(request)) {
      sendJson(response, 401, { error: 'Unauthorized proxy request.' });
      return;
    }

    if (requestUrl.pathname === '/health') {
      sendJson(response, 200, {
        ok: true,
        service: 'opensky-external-proxy',
        hasCredentials: Boolean(OPENSKY_CLIENT_ID && OPENSKY_CLIENT_SECRET),
        protected: Boolean(OPENSKY_PROXY_SECRET),
        generatedAt: new Date().toISOString(),
      });
      return;
    }

    if (request.method === 'POST' && requestUrl.pathname === '/auth/realms/opensky-network/protocol/openid-connect/token') {
      await proxyOpenSkyToken(request, response);
      return;
    }

    if (requestUrl.pathname.startsWith('/api/')) {
      await proxyOpenSkyApi(request, response, requestUrl);
      return;
    }

    sendJson(response, 404, {
      error: 'Not found.',
      availableRoutes: ['/health', '/auth/realms/opensky-network/protocol/openid-connect/token', '/api/*'],
    });
  } catch (error) {
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : 'Unexpected proxy error.',
    });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`OpenSky proxy listening on http://0.0.0.0:${PORT}`);
});
