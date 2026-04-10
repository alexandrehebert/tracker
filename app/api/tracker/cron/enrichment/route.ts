import { NextRequest, NextResponse } from 'next/server';
import { runTrackerCronJob, type TrackerCronTrigger } from '~/lib/server/trackerCron';

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

function isAuthorizedCronRequest(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) {
    return true;
  }

  const bearerToken = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  return bearerToken === cronSecret;
}

function detectTrigger(request: NextRequest, fallback: TrackerCronTrigger): TrackerCronTrigger {
  const userAgent = request.headers.get('user-agent') ?? '';
  return request.headers.has('x-vercel-cron') || /vercel-cron/i.test(userAgent)
    ? 'vercel-cron'
    : fallback;
}

export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request)) {
    return buildJsonResponse({ error: 'Unauthorized cron request.' }, 401);
  }

  try {
    const payload = await runTrackerCronJob({
      trigger: detectTrigger(request, 'vercel-cron'),
      requestedBy: request.headers.get('user-agent') ?? 'vercel-cron-enrichment',
      refreshMode: 'full',
    });

    return buildJsonResponse(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to execute tracker enrichment cron.';
    return buildJsonResponse({ error: message }, 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as {
      trigger?: TrackerCronTrigger;
      identifiers?: string[];
      requestedBy?: string;
    };

    const payload = await runTrackerCronJob({
      trigger: body.trigger === 'manual-admin' ? 'manual-admin' : 'manual-api',
      overrideIdentifiers: Array.isArray(body.identifiers) ? body.identifiers : undefined,
      requestedBy: typeof body.requestedBy === 'string' ? body.requestedBy : 'tracker cron enrichment dashboard',
      refreshMode: 'full',
    });

    return buildJsonResponse(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to execute tracker enrichment cron.';
    return buildJsonResponse({ error: message }, 500);
  }
}
