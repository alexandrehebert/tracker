const OPENSKY_TOKEN_URL = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';
const OPENSKY_API_BASE = 'https://opensky-network.org/api';
const TOKEN_REFRESH_MARGIN_MS = 30_000;
const DEFAULT_UPSTREAM_TIMEOUT_MS = 12_000;

let tokenCache = null;
let tokenFetchPromise = null;

function getProxySecret() {
  return process.env.OPENSKY_PROXY_SECRET?.trim() ?? '';
}

function getClientId() {
  return process.env.OPENSKY_CLIENT_ID?.trim() ?? '';
}

function getClientSecret() {
  return process.env.OPENSKY_CLIENT_SECRET?.trim() ?? '';
}

function getUpstreamTimeoutMs() {
  const raw = Number.parseInt(process.env.OPENSKY_PROXY_UPSTREAM_TIMEOUT_MS ?? '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_UPSTREAM_TIMEOUT_MS;
}

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, max-age=0',
    },
    body: JSON.stringify(payload),
  };
}

function isTokenValid(token) {
  return Boolean(token?.accessToken) && Date.now() < token.expiresAt - TOKEN_REFRESH_MARGIN_MS;
}

function getHeader(headers, name) {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (key.toLowerCase() === target) {
      return Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '');
    }
  }

  return '';
}

function isAuthorized(headers) {
  const secret = getProxySecret();
  if (!secret) {
    return true;
  }

  return getHeader(headers, 'x-opensky-proxy-secret') === secret;
}

function normalizePath(event) {
  const rawPath = event?.path
    ?? event?.rawPath
    ?? event?.requestContext?.http?.path
    ?? '/';
  const normalized = String(rawPath || '/');
  const match = normalized.match(/(\/health|\/auth\/realms\/opensky-network\/protocol\/openid-connect\/token|\/api\/.*)$/);
  return match ? match[1] : normalized;
}

function buildSearchParams(event) {
  const urlParams = new URLSearchParams();
  const singleValues = event?.queryStringParameters ?? {};

  for (const [key, value] of Object.entries(singleValues)) {
    if (value == null) {
      continue;
    }

    urlParams.append(key, String(value));
  }

  return urlParams.toString();
}

function decodeEventBody(event) {
  if (event?.body == null || event.body === '') {
    return '';
  }

  if (event.isBase64Encoded) {
    return Buffer.from(String(event.body), 'base64').toString('utf8');
  }

  return String(event.body);
}

function createTimeoutSignal(timeoutMs) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(timeoutMs);
  }

  return undefined;
}

async function fetchWithTimeout(url, init = {}) {
  return fetch(url, {
    ...init,
    signal: createTimeoutSignal(getUpstreamTimeoutMs()),
    cache: 'no-store',
  });
}

async function getAccessToken(forceRefresh = false) {
  const clientId = getClientId();
  const clientSecret = getClientSecret();

  if (!clientId || !clientSecret) {
    throw new Error('Set OPENSKY_CLIENT_ID and OPENSKY_CLIENT_SECRET in the Scaleway function environment.');
  }

  if (!forceRefresh && isTokenValid(tokenCache)) {
    return tokenCache.accessToken;
  }

  if (!tokenFetchPromise) {
    tokenFetchPromise = (async () => {
      const body = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
      });

      const response = await fetchWithTimeout(OPENSKY_TOKEN_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
        },
        body,
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

async function handleHealth() {
  return jsonResponse(200, {
    ok: true,
    service: 'opensky-external-proxy',
    provider: 'scaleway-functions',
    hasCredentials: Boolean(getClientId() && getClientSecret()),
    protected: Boolean(getProxySecret()),
    generatedAt: new Date().toISOString(),
  });
}

async function handleTokenProxy(event, headers) {
  const rawBody = decodeEventBody(event);
  const params = new URLSearchParams(rawBody);

  if (!params.get('grant_type')) {
    params.set('grant_type', 'client_credentials');
  }

  if (!params.get('client_id') && getClientId()) {
    params.set('client_id', getClientId());
  }

  if (!params.get('client_secret') && getClientSecret()) {
    params.set('client_secret', getClientSecret());
  }

  const upstream = await fetchWithTimeout(OPENSKY_TOKEN_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: getHeader(headers, 'accept') || 'application/json',
    },
    body: params,
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
      // Ignore token cache warm-up errors for malformed upstream payloads.
    }
  }

  return {
    statusCode: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'application/json; charset=utf-8',
      'cache-control': 'no-store, max-age=0',
    },
    body: text,
  };
}

async function handleApiProxy(event, path, headers, method) {
  const search = buildSearchParams(event);
  const upstreamUrl = `${OPENSKY_API_BASE}${path.slice('/api'.length)}${search ? `?${search}` : ''}`;
  const upstreamHeaders = new Headers();
  const acceptHeader = getHeader(headers, 'accept');
  const contentType = getHeader(headers, 'content-type');
  const incomingAuthorization = getHeader(headers, 'authorization').trim();

  if (acceptHeader) {
    upstreamHeaders.set('accept', acceptHeader);
  }

  if (contentType) {
    upstreamHeaders.set('content-type', contentType);
  }

  if (incomingAuthorization) {
    upstreamHeaders.set('authorization', incomingAuthorization);
  } else if (getClientId() && getClientSecret()) {
    upstreamHeaders.set('authorization', `Bearer ${await getAccessToken()}`);
  }

  const body = method === 'GET' || method === 'HEAD' ? undefined : decodeEventBody(event);

  let upstream = await fetchWithTimeout(upstreamUrl, {
    method,
    headers: upstreamHeaders,
    body,
  });

  if (upstream.status === 401 && !incomingAuthorization && getClientId() && getClientSecret()) {
    upstreamHeaders.set('authorization', `Bearer ${await getAccessToken(true)}`);
    upstream = await fetchWithTimeout(upstreamUrl, {
      method,
      headers: upstreamHeaders,
      body,
    });
  }

  const text = await upstream.text();
  return {
    statusCode: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'application/json; charset=utf-8',
      'cache-control': 'no-store, max-age=0',
    },
    body: text,
  };
}

async function handleRequest(event = {}) {
  const headers = event.headers ?? {};
  const method = String(event.httpMethod ?? event.requestContext?.http?.method ?? event.method ?? 'GET').toUpperCase();
  const path = normalizePath(event);

  if (!isAuthorized(headers)) {
    return jsonResponse(401, { error: 'Unauthorized proxy request.' });
  }

  if (path === '/health') {
    return handleHealth();
  }

  if (method === 'POST' && path === '/auth/realms/opensky-network/protocol/openid-connect/token') {
    return handleTokenProxy(event, headers);
  }

  if (path.startsWith('/api/')) {
    return handleApiProxy(event, path, headers, method);
  }

  return jsonResponse(404, {
    error: 'Not found.',
    availableRoutes: ['/health', '/auth/realms/opensky-network/protocol/openid-connect/token', '/api/*'],
  });
}

export async function handler(event, context, callback) {
  try {
    const response = await handleRequest(event);

    if (typeof callback === 'function') {
      callback(null, response);
      return;
    }

    return response;
  } catch (error) {
    const response = jsonResponse(500, {
      error: error instanceof Error ? error.message : 'Unexpected proxy error.',
    });

    if (typeof callback === 'function') {
      callback(null, response);
      return;
    }

    return response;
  }
}

export { handleRequest };
