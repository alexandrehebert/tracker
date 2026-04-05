import dns from 'node:dns';
import { promises as dnsPromises } from 'node:dns';
import { Agent } from 'undici';
import {
  getOpenSkyErrorDiagnostics,
  getOpenSkyTokenStatus,
  isOpenSkyConfigured,
} from './providers/opensky';

const OPENSKY_AUTH_METADATA_URL = 'https://auth.opensky-network.org/auth/realms/opensky-network/.well-known/openid-configuration';
const OPENSKY_TOKEN_URL = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';
const OPENSKY_API_STATES_URL = 'https://opensky-network.org/api/states/all?lamin=48.80&lomin=2.20&lamax=49.00&lomax=2.50';
const DEFAULT_OPENSKY_REQUEST_TIMEOUT_MS = process.env.VERCEL ? 25_000 : 15_000;
const DEFAULT_OPENSKY_CONNECT_TIMEOUT_MS = process.env.VERCEL ? 30_000 : 15_000;
const DEFAULT_OPENSKY_DEBUG_REQUEST_TIMEOUT_MS = 12_000;

const parsedOpenSkyRequestTimeoutMs = Number.parseInt(process.env.OPENSKY_REQUEST_TIMEOUT_MS?.trim() ?? '', 10);
const OPENSKY_REQUEST_TIMEOUT_MS = Number.isFinite(parsedOpenSkyRequestTimeoutMs) && parsedOpenSkyRequestTimeoutMs > 0
  ? parsedOpenSkyRequestTimeoutMs
  : DEFAULT_OPENSKY_REQUEST_TIMEOUT_MS;
const parsedOpenSkyConnectTimeoutMs = Number.parseInt(process.env.OPENSKY_CONNECT_TIMEOUT_MS?.trim() ?? '', 10);
const OPENSKY_CONNECT_TIMEOUT_MS = Number.isFinite(parsedOpenSkyConnectTimeoutMs) && parsedOpenSkyConnectTimeoutMs > 0
  ? parsedOpenSkyConnectTimeoutMs
  : DEFAULT_OPENSKY_CONNECT_TIMEOUT_MS;
const parsedOpenSkyDebugRequestTimeoutMs = Number.parseInt(process.env.OPENSKY_DEBUG_REQUEST_TIMEOUT_MS?.trim() ?? '', 10);
const OPENSKY_DEBUG_REQUEST_TIMEOUT_MS = Number.isFinite(parsedOpenSkyDebugRequestTimeoutMs) && parsedOpenSkyDebugRequestTimeoutMs > 0
  ? parsedOpenSkyDebugRequestTimeoutMs
  : Math.min(OPENSKY_REQUEST_TIMEOUT_MS, DEFAULT_OPENSKY_DEBUG_REQUEST_TIMEOUT_MS);
const OPENSKY_DEBUG_CONNECT_TIMEOUT_MS = Math.min(OPENSKY_CONNECT_TIMEOUT_MS, OPENSKY_DEBUG_REQUEST_TIMEOUT_MS);

const debugDispatcher = new Agent({
  connectTimeout: OPENSKY_DEBUG_CONNECT_TIMEOUT_MS,
});

type DebugHttpCheck = {
  name: string;
  description: string;
  ok: boolean;
  durationMs: number;
  request: {
    method: string;
    url: string;
    headers: Record<string, string>;
    bodyPreview: string | null;
  };
  response: {
    url: string | null;
    status: number | null;
    statusText: string | null;
    redirected: boolean;
    headers: Record<string, string>;
    bodyPreview: string | null;
    jsonSummary: Record<string, unknown> | null;
  } | null;
  error: string | null;
  diagnostics: Record<string, unknown> | null;
};

export type OpenSkyDebugDnsResult = {
  host: string;
  dnsServers: string[];
  lookup: {
    addresses: Array<{ address: string; family: number }>;
    error: string | null;
  };
  resolve4: {
    addresses: string[];
    error: string | null;
  };
  resolve6: {
    addresses: string[];
    error: string | null;
  };
  resolveCname: {
    records: string[];
    error: string | null;
  };
};

export type OpenSkyDebugReport = {
  reportVersion: 1;
  generatedAt: string;
  generatedAtMs: number;
  shareHint: string;
  runtime: {
    nodeVersion: string;
    platform: string;
    arch: string;
    timezone: string;
    cwd: string;
    vercel: boolean;
    vercelEnv: string | null;
    vercelRegion: string | null;
    vercelUrl: string | null;
    vercelProjectProductionUrl: string | null;
    awsRegion: string | null;
    functionRegion: string | null;
  };
  route: {
    runtime: 'nodejs';
    preferredRegion: 'fra1';
    maxDuration: 30;
  };
  request: {
    method: string;
    url: string;
    pathname: string;
    search: string;
    headers: Record<string, string>;
    routing: Record<string, string | null>;
  };
  configuration: {
    providerConfigured: boolean;
    clientIdPreview: string | null;
    clientSecretPresent: boolean;
    mongoConfigured: boolean;
    requestTimeoutMs: number;
    connectTimeoutMs: number;
    debugRequestTimeoutMs: number;
    cachedToken: Awaited<ReturnType<typeof getOpenSkyTokenStatus>>;
  };
  dns: {
    authHost: OpenSkyDebugDnsResult;
    apiHost: OpenSkyDebugDnsResult;
  };
  checks: DebugHttpCheck[];
  warnings: string[];
};

type DebugHttpCheckResult = {
  report: DebugHttpCheck;
  parsedBody: unknown;
};

type DebugHttpCheckOptions = {
  name: string;
  description: string;
  url: string;
  method?: string;
  headers?: HeadersInit;
  body?: BodyInit | null;
  bodyPreviewOverride?: string | null;
  acceptedStatuses?: number[];
};

function truncateText(value: string, maxLength = 600): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1)}…`;
}

function maskValue(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.length <= 10) {
    return `${trimmed.slice(0, 3)}…${trimmed.slice(-2)}`;
  }

  return `${trimmed.slice(0, 6)}…${trimmed.slice(-4)}`;
}

function maskIpAddress(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const first = value.split(',')[0]?.trim() ?? value.trim();
  if (!first) {
    return null;
  }

  if (first.includes('.')) {
    const parts = first.split('.');
    if (parts.length === 4) {
      return `${parts[0]}.${parts[1]}.${parts[2]}.x`;
    }
  }

  if (first.includes(':')) {
    const parts = first.split(':');
    return `${parts.slice(0, 2).join(':')}::x`;
  }

  return '[masked]';
}

function shouldRedactKey(key: string): boolean {
  return /authorization|cookie|secret|token|password|api[-_]?key|set-cookie|signature|sc-headers|jwt/i.test(key);
}

function sanitizeHeaderValue(name: string, value: string): string {
  if (/^authorization$/i.test(name)) {
    const bearerMatch = value.match(/^Bearer\s+(.+)$/i);
    return bearerMatch ? `Bearer ${maskValue(bearerMatch[1]) ?? '[redacted]'}` : '[redacted]';
  }

  if (/^(x-forwarded-for|x-real-ip|x-vercel-forwarded-for|x-vercel-proxied-for)$/i.test(name)) {
    return maskIpAddress(value) ?? '[masked]';
  }

  if (shouldRedactKey(name)) {
    return '[redacted]';
  }

  return truncateText(value, 240);
}

function sanitizeHeaders(headers: Headers | HeadersInit | Record<string, string | null | undefined>): Record<string, string> {
  const normalized = headers instanceof Headers
    ? Object.fromEntries(headers.entries())
    : Array.isArray(headers)
      ? Object.fromEntries(headers.map(([key, value]) => [key, String(value)]))
      : Object.fromEntries(
        Object.entries(headers)
          .filter(([, value]) => value != null)
          .map(([key, value]) => [key, String(value)]),
      );

  return Object.fromEntries(
    Object.entries(normalized)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [key, sanitizeHeaderValue(key, value)]),
  );
}

function sanitizeTextPayload(text: string): string {
  return truncateText(
    text
      .replace(/(client_secret=)[^&\s]+/gi, '$1[redacted]')
      .replace(/(access_token=)[^&\s]+/gi, '$1[redacted]')
      .replace(/("client_secret"\s*:\s*")[^"]+(")/gi, '$1[redacted]$2')
      .replace(/("access_token"\s*:\s*")[^"]+(")/gi, '$1[redacted]$2')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

function sanitizeJsonValue(value: unknown, key = ''): unknown {
  if (value == null) {
    return value;
  }

  if (typeof value === 'string') {
    return shouldRedactKey(key)
      ? (key.toLowerCase().includes('token') ? maskValue(value) ?? '[redacted]' : '[redacted]')
      : truncateText(value, 160);
  }

  if (typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    const previewItems = value.slice(0, 3).map((item) => sanitizeJsonValue(item, key));
    return value.length > 3
      ? [...previewItems, `… ${value.length - 3} more item(s)`]
      : previewItems;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .slice(0, 20)
      .map(([entryKey, entryValue]) => [entryKey, sanitizeJsonValue(entryValue, entryKey)]),
  );
}

function buildJsonSummary(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    return {
      type: 'array',
      length: value.length,
    };
  }

  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;

  if (Array.isArray(record.states)) {
    return {
      time: typeof record.time === 'number' ? record.time : null,
      statesCount: record.states.length,
    };
  }

  if (typeof record.access_token === 'string') {
    return {
      tokenPreview: maskValue(record.access_token),
      expiresIn: typeof record.expires_in === 'number' ? record.expires_in : null,
      tokenType: typeof record.token_type === 'string' ? record.token_type : null,
    };
  }

  return {
    keys: Object.keys(record).slice(0, 12),
  };
}

async function readResponseSummary(response: Response): Promise<{ bodyPreview: string | null; jsonSummary: Record<string, unknown> | null; parsedBody: unknown }> {
  try {
    const text = (await response.text()).trim();
    if (!text) {
      return { bodyPreview: null, jsonSummary: null, parsedBody: null };
    }

    try {
      const parsed = JSON.parse(text) as unknown;
      return {
        bodyPreview: truncateText(JSON.stringify(sanitizeJsonValue(parsed))),
        jsonSummary: buildJsonSummary(parsed),
        parsedBody: parsed,
      };
    } catch {
      return {
        bodyPreview: sanitizeTextPayload(text),
        jsonSummary: null,
        parsedBody: null,
      };
    }
  } catch (error) {
    return {
      bodyPreview: error instanceof Error ? `Unable to read response body: ${error.message}` : 'Unable to read response body.',
      jsonSummary: null,
      parsedBody: null,
    };
  }
}

function createTimeoutSignal(timeoutMs: number, baseSignal?: AbortSignal | null): AbortSignal | undefined {
  const timeoutSignal = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(timeoutMs)
    : undefined;

  if (baseSignal && timeoutSignal && typeof AbortSignal.any === 'function') {
    return AbortSignal.any([baseSignal, timeoutSignal]);
  }

  return baseSignal ?? timeoutSignal;
}

async function runHttpCheck(options: DebugHttpCheckOptions): Promise<DebugHttpCheckResult> {
  const startedAt = Date.now();
  const method = options.method ?? 'GET';
  const requestHeaders = new Headers(options.headers ?? {});

  try {
    const response = await fetch(options.url, {
      method,
      headers: requestHeaders,
      body: options.body,
      cache: 'no-store',
      dispatcher: debugDispatcher,
      signal: createTimeoutSignal(OPENSKY_DEBUG_REQUEST_TIMEOUT_MS),
    } as RequestInit & { dispatcher?: Agent });

    const responseSummary = await readResponseSummary(response);
    const ok = response.ok || Boolean(options.acceptedStatuses?.includes(response.status));

    return {
      parsedBody: responseSummary.parsedBody,
      report: {
        name: options.name,
        description: options.description,
        ok,
        durationMs: Date.now() - startedAt,
        request: {
          method,
          url: options.url,
          headers: sanitizeHeaders(requestHeaders),
          bodyPreview: options.bodyPreviewOverride
            ?? (options.body ? sanitizeTextPayload(String(options.body instanceof URLSearchParams ? options.body.toString() : options.body)) : null),
        },
        response: {
          url: response.url || null,
          status: response.status,
          statusText: response.statusText,
          redirected: response.redirected,
          headers: sanitizeHeaders(response.headers),
          bodyPreview: responseSummary.bodyPreview,
          jsonSummary: responseSummary.jsonSummary,
        },
        error: null,
        diagnostics: null,
      },
    };
  } catch (error) {
    return {
      parsedBody: null,
      report: {
        name: options.name,
        description: options.description,
        ok: false,
        durationMs: Date.now() - startedAt,
        request: {
          method,
          url: options.url,
          headers: sanitizeHeaders(requestHeaders),
          bodyPreview: options.bodyPreviewOverride
            ?? (options.body ? sanitizeTextPayload(String(options.body instanceof URLSearchParams ? options.body.toString() : options.body)) : null),
        },
        response: null,
        error: error instanceof Error ? error.message : String(error),
        diagnostics: getOpenSkyErrorDiagnostics(error),
      },
    };
  }
}

function createSkippedCheck(name: string, description: string, reason: string): DebugHttpCheck {
  return {
    name,
    description,
    ok: false,
    durationMs: 0,
    request: {
      method: 'GET',
      url: '',
      headers: {},
      bodyPreview: null,
    },
    response: null,
    error: reason,
    diagnostics: null,
  };
}

async function runDnsCheck(host: string): Promise<OpenSkyDebugDnsResult> {
  const [lookupResult, resolve4Result, resolve6Result, cnameResult] = await Promise.allSettled([
    dnsPromises.lookup(host, { all: true, verbatim: true }),
    dnsPromises.resolve4(host),
    dnsPromises.resolve6(host),
    dnsPromises.resolveCname(host),
  ]);

  return {
    host,
    dnsServers: dns.getServers(),
    lookup: lookupResult.status === 'fulfilled'
      ? {
        addresses: lookupResult.value.map((entry) => ({ address: entry.address, family: entry.family })),
        error: null,
      }
      : {
        addresses: [],
        error: lookupResult.reason instanceof Error ? lookupResult.reason.message : String(lookupResult.reason),
      },
    resolve4: resolve4Result.status === 'fulfilled'
      ? {
        addresses: resolve4Result.value,
        error: null,
      }
      : {
        addresses: [],
        error: resolve4Result.reason instanceof Error ? resolve4Result.reason.message : String(resolve4Result.reason),
      },
    resolve6: resolve6Result.status === 'fulfilled'
      ? {
        addresses: resolve6Result.value,
        error: null,
      }
      : {
        addresses: [],
        error: resolve6Result.reason instanceof Error ? resolve6Result.reason.message : String(resolve6Result.reason),
      },
    resolveCname: cnameResult.status === 'fulfilled'
      ? {
        records: cnameResult.value,
        error: null,
      }
      : {
        records: [],
        error: cnameResult.reason instanceof Error ? cnameResult.reason.message : String(cnameResult.reason),
      },
  };
}

function buildRoutingInfo(headers: Headers): Record<string, string | null> {
  return {
    host: headers.get('host'),
    forwardedHost: headers.get('x-forwarded-host'),
    forwardedProto: headers.get('x-forwarded-proto'),
    forwardedFor: maskIpAddress(headers.get('x-forwarded-for')),
    vercelId: headers.get('x-vercel-id'),
    vercelDeploymentUrl: headers.get('x-vercel-deployment-url'),
    vercelIpCountry: headers.get('x-vercel-ip-country'),
    vercelIpCountryRegion: headers.get('x-vercel-ip-country-region'),
    vercelIpCity: headers.get('x-vercel-ip-city'),
  };
}

export async function runOpenSkyDebugReport(request: Request): Promise<OpenSkyDebugReport> {
  const generatedAtMs = Date.now();
  const requestUrl = new URL(request.url);
  const cachedToken = await getOpenSkyTokenStatus();
  const providerConfigured = isOpenSkyConfigured();

  const [authDns, apiDns, authMetadataCheck, apiPreflightCheck] = await Promise.all([
    runDnsCheck('auth.opensky-network.org'),
    runDnsCheck('opensky-network.org'),
    runHttpCheck({
      name: 'auth-metadata',
      description: 'Fetch the OpenSky OIDC metadata endpoint to verify DNS/TLS/connectivity to the auth host.',
      url: OPENSKY_AUTH_METADATA_URL,
      acceptedStatuses: [200],
      headers: {
        Accept: 'application/json',
      },
    }),
    runHttpCheck({
      name: 'api-preflight',
      description: 'Call a small OpenSky API route without auth to verify the API host is reachable from this Vercel function.',
      url: OPENSKY_API_STATES_URL,
      acceptedStatuses: [200, 401, 403],
      headers: {
        Accept: 'application/json',
      },
    }),
  ]);

  let authTokenCheck: DebugHttpCheck;
  let accessToken: string | null = null;

  if (!providerConfigured) {
    authTokenCheck = createSkippedCheck(
      'auth-token',
      'Request a real OAuth token using the configured OpenSky client credentials.',
      'OpenSky credentials are missing or the provider is disabled in this environment.',
    );
  } else {
    const credentials = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.OPENSKY_CLIENT_ID?.trim() ?? '',
      client_secret: process.env.OPENSKY_CLIENT_SECRET?.trim() ?? '',
    });

    const authTokenResult = await runHttpCheck({
      name: 'auth-token',
      description: 'Request a real OAuth token using the configured OpenSky client credentials.',
      url: OPENSKY_TOKEN_URL,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: credentials,
      bodyPreviewOverride: `grant_type=client_credentials&client_id=${maskValue(process.env.OPENSKY_CLIENT_ID) ?? '[missing]'}&client_secret=[redacted]`,
      acceptedStatuses: [200],
    });

    authTokenCheck = authTokenResult.report;
    const parsed = authTokenResult.parsedBody;
    if (parsed && typeof parsed === 'object' && typeof (parsed as { access_token?: unknown }).access_token === 'string') {
      accessToken = (parsed as { access_token: string }).access_token;
    }
  }

  if (!accessToken) {
    const tokenWithAccess = await getOpenSkyTokenStatus(true);
    accessToken = tokenWithAccess.accessToken;
  }

  const authenticatedApiCheck = accessToken
    ? await runHttpCheck({
      name: 'api-authenticated',
      description: 'Call the OpenSky states endpoint with a Bearer token from the same runtime to verify authenticated API access.',
      url: OPENSKY_API_STATES_URL,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      acceptedStatuses: [200],
    }).then((result) => result.report)
    : createSkippedCheck(
      'api-authenticated',
      'Call the OpenSky states endpoint with a Bearer token from the same runtime to verify authenticated API access.',
      'No valid access token was available for the authenticated API check.',
    );

  const warnings = [
    !providerConfigured ? 'OpenSky credentials are missing or the provider is disabled in this environment.' : null,
    authMetadataCheck.report.ok ? null : 'The auth host metadata check failed before OAuth even started.',
    apiPreflightCheck.report.ok ? null : 'The OpenSky API host preflight check failed from this runtime.',
    authTokenCheck.ok ? null : 'The real OAuth token request failed or timed out from this runtime.',
    authenticatedApiCheck.ok ? null : 'The authenticated OpenSky API request failed or timed out from this runtime.',
    cachedToken.hasToken && cachedToken.isExpired ? 'A cached shared OpenSky token exists but is already expired.' : null,
  ].filter((warning): warning is string => Boolean(warning));

  return {
    reportVersion: 1,
    generatedAt: new Date(generatedAtMs).toISOString(),
    generatedAtMs,
    shareHint: 'Safe to share for debugging: secrets and full tokens are redacted in this report.',
    runtime: {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      cwd: process.cwd(),
      vercel: Boolean(process.env.VERCEL),
      vercelEnv: process.env.VERCEL_ENV ?? null,
      vercelRegion: process.env.VERCEL_REGION ?? null,
      vercelUrl: process.env.VERCEL_URL ?? null,
      vercelProjectProductionUrl: process.env.VERCEL_PROJECT_PRODUCTION_URL ?? null,
      awsRegion: process.env.AWS_REGION ?? null,
      functionRegion: process.env.AWS_LAMBDA_FUNCTION_REGION ?? null,
    },
    route: {
      runtime: 'nodejs',
      preferredRegion: 'fra1',
      maxDuration: 30,
    },
    request: {
      method: request.method,
      url: request.url,
      pathname: requestUrl.pathname,
      search: requestUrl.search,
      headers: sanitizeHeaders(request.headers),
      routing: buildRoutingInfo(request.headers),
    },
    configuration: {
      providerConfigured,
      clientIdPreview: maskValue(process.env.OPENSKY_CLIENT_ID),
      clientSecretPresent: Boolean(process.env.OPENSKY_CLIENT_SECRET?.trim()),
      mongoConfigured: Boolean(process.env.MONGODB_URI?.trim()),
      requestTimeoutMs: OPENSKY_REQUEST_TIMEOUT_MS,
      connectTimeoutMs: OPENSKY_CONNECT_TIMEOUT_MS,
      debugRequestTimeoutMs: OPENSKY_DEBUG_REQUEST_TIMEOUT_MS,
      cachedToken,
    },
    dns: {
      authHost: authDns,
      apiHost: apiDns,
    },
    checks: [authMetadataCheck.report, apiPreflightCheck.report, authTokenCheck, authenticatedApiCheck],
    warnings,
  };
}
