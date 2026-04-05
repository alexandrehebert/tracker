import { NextRequest, NextResponse } from 'next/server';
import { runOpenSkyDebugReport } from '~/lib/server/openskyDebug';

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

export async function GET(request: NextRequest) {
  try {
    const report = await runOpenSkyDebugReport(request);
    return buildJsonResponse(report);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to run the OpenSky debug diagnostics.';

    return buildJsonResponse({
      error: message,
      generatedAt: new Date().toISOString(),
    }, 500);
  }
}
