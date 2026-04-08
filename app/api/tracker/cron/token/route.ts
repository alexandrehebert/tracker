import { NextRequest, NextResponse } from 'next/server';
import {
  clearStoredOpenSkyAccessToken,
  getOpenSkyTokenStatus,
  refreshOpenSkyAccessToken,
  setStoredOpenSkyAccessToken,
} from '~/lib/server/providers/opensky';
import { withProviderRequestContext } from '~/lib/server/providers/observability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const preferredRegion = 'fra1';
export const maxDuration = 30;

function buildJsonResponse(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}

function shouldIncludeAccessToken(request: NextRequest, includeAccessTokenFromBody?: boolean): boolean {
  return includeAccessTokenFromBody === true
    || ['1', 'true', 'yes'].includes(request.nextUrl.searchParams.get('includeToken')?.trim().toLowerCase() ?? '');
}

export async function GET(request: NextRequest) {
  try {
    const payload = await getOpenSkyTokenStatus(shouldIncludeAccessToken(request));
    return buildJsonResponse(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to read the OpenSky token cache.';
    return buildJsonResponse({ error: message }, 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as {
      action?: 'refresh' | 'set' | 'clear';
      accessToken?: string;
      expiresInSeconds?: number;
      includeToken?: boolean;
    };
    const includeAccessToken = shouldIncludeAccessToken(request, body.includeToken);
    const withConfigContext = <T,>(callback: () => Promise<T>) => withProviderRequestContext(
      {
        caller: 'config',
        source: 'tracker-cron-token',
        metadata: { action: body.action ?? null },
      },
      callback,
    );

    switch (body.action) {
      case 'refresh': {
        await withConfigContext(() => refreshOpenSkyAccessToken());
        return buildJsonResponse(await getOpenSkyTokenStatus(includeAccessToken));
      }
      case 'set': {
        if (typeof body.accessToken !== 'string' || !body.accessToken.trim()) {
          return buildJsonResponse({ error: 'Provide a non-empty OpenSky access token.' }, 400);
        }

        const accessToken = body.accessToken.trim();
        await withConfigContext(() => setStoredOpenSkyAccessToken(
          accessToken,
          typeof body.expiresInSeconds === 'number' ? body.expiresInSeconds : 1800,
        ));
        return buildJsonResponse(await getOpenSkyTokenStatus(includeAccessToken));
      }
      case 'clear': {
        await withConfigContext(() => clearStoredOpenSkyAccessToken());
        return buildJsonResponse(await getOpenSkyTokenStatus(includeAccessToken));
      }
      default:
        return buildJsonResponse({ error: 'Unsupported token action.' }, 400);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to update the OpenSky token cache.';
    return buildJsonResponse({ error: message }, 500);
  }
}
