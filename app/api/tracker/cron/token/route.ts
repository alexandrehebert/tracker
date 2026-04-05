import { NextRequest, NextResponse } from 'next/server';
import {
  clearStoredOpenSkyAccessToken,
  getOpenSkyTokenStatus,
  refreshOpenSkyAccessToken,
  setStoredOpenSkyAccessToken,
} from '~/lib/server/providers/opensky';

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

export async function GET() {
  try {
    const payload = await getOpenSkyTokenStatus();
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
    };

    switch (body.action) {
      case 'refresh': {
        const payload = await refreshOpenSkyAccessToken();
        return buildJsonResponse(payload);
      }
      case 'set': {
        if (typeof body.accessToken !== 'string' || !body.accessToken.trim()) {
          return buildJsonResponse({ error: 'Provide a non-empty OpenSky access token.' }, 400);
        }

        const payload = await setStoredOpenSkyAccessToken(
          body.accessToken,
          typeof body.expiresInSeconds === 'number' ? body.expiresInSeconds : 1800,
        );
        return buildJsonResponse(payload);
      }
      case 'clear': {
        const payload = await clearStoredOpenSkyAccessToken();
        return buildJsonResponse(payload);
      }
      default:
        return buildJsonResponse({ error: 'Unsupported token action.' }, 400);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to update the OpenSky token cache.';
    return buildJsonResponse({ error: message }, 500);
  }
}
