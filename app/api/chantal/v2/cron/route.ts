import { NextRequest, NextResponse } from 'next/server';
import { runChantalV2CronJob } from '~/lib/server/chantalV2Cron';

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

function isAuthorizedRequest(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) {
    return true;
  }

  const bearerToken = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  return bearerToken === cronSecret;
}

/** Vercel cron trigger (GET) – scheduled every 5 minutes. */
export async function GET(request: NextRequest) {
  if (!isAuthorizedRequest(request)) {
    return buildJsonResponse({ error: 'Unauthorized cron request.' }, 401);
  }

  try {
    const result = await runChantalV2CronJob();
    return buildJsonResponse(result, result.success ? 200 : 500);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to execute Chantal V2 cron.';
    return buildJsonResponse({ error: message }, 500);
  }
}

/** Manual trigger (POST) – can be called from admin UI or curl. */
export async function POST(request: NextRequest) {
  // Allow POST without cron secret for manual invocations from the UI.
  void request;

  try {
    const result = await runChantalV2CronJob();
    return buildJsonResponse(result, result.success ? 200 : 500);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to execute Chantal V2 cron.';
    return buildJsonResponse({ error: message }, 500);
  }
}
