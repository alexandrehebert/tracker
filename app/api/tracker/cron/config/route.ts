import { NextRequest, NextResponse } from 'next/server';
import { getTrackerCronDashboard, writeTrackerCronConfig } from '~/lib/server/trackerCron';

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
    const payload = await getTrackerCronDashboard(100);
    return buildJsonResponse(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load tracker cron settings.';
    return buildJsonResponse({ error: message }, 500);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null) as {
      identifiers?: string[] | string;
      enabled?: boolean;
    } | null;

    const hasIdentifiers = typeof body?.identifiers === 'string' || Array.isArray(body?.identifiers);
    const hasEnabled = typeof body?.enabled === 'boolean';

    if (!body || (!hasIdentifiers && !hasEnabled)) {
      return buildJsonResponse({ error: 'Provide cron identifiers or an enabled flag to save.' }, 400);
    }

    await writeTrackerCronConfig({
      identifiers: hasIdentifiers ? body.identifiers : undefined,
      enabled: hasEnabled ? body.enabled : undefined,
      updatedBy: 'tracker/cron admin page',
    });

    const payload = await getTrackerCronDashboard(100);
    return buildJsonResponse(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to save tracker cron settings.';
    return buildJsonResponse({ error: message }, 500);
  }
}
