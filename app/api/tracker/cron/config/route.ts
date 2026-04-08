import { NextRequest, NextResponse } from 'next/server';
import { getCurrentTripConfig } from '~/lib/friendsTracker';
import { readFriendsTrackerConfig, writeFriendsTrackerConfig } from '~/lib/server/friendsTracker';
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

async function buildDashboardResponse() {
  const [dashboard, chantalConfig] = await Promise.all([
    getTrackerCronDashboard(100),
    readFriendsTrackerConfig(),
  ]);
  const currentTrip = getCurrentTripConfig(chantalConfig);

  return {
    ...dashboard,
    chantalCronEnabled: chantalConfig.cronEnabled !== false,
    chantalCurrentTripName: currentTrip?.name ?? null,
  };
}

export async function GET() {
  try {
    const payload = await buildDashboardResponse();
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
      chantalEnabled?: boolean;
    } | null;

    const hasIdentifiers = typeof body?.identifiers === 'string' || Array.isArray(body?.identifiers);
    const hasEnabled = typeof body?.enabled === 'boolean';
    const hasChantalEnabled = typeof body?.chantalEnabled === 'boolean';

    if (!body || (!hasIdentifiers && !hasEnabled && !hasChantalEnabled)) {
      return buildJsonResponse({ error: 'Provide cron identifiers, the manual cron state, or the Chantal cron state to save.' }, 400);
    }

    if (hasIdentifiers || hasEnabled) {
      await writeTrackerCronConfig({
        identifiers: hasIdentifiers ? body.identifiers : undefined,
        enabled: hasEnabled ? body.enabled : undefined,
        updatedBy: 'tracker/cron admin page',
      });
    }

    if (hasChantalEnabled) {
      await writeFriendsTrackerConfig({
        cronEnabled: body.chantalEnabled,
        updatedBy: 'tracker/cron admin page',
      });
    }

    const payload = await buildDashboardResponse();
    return buildJsonResponse(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to save tracker cron settings.';
    return buildJsonResponse({ error: message }, 500);
  }
}
