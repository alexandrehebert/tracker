import { NextRequest, NextResponse } from 'next/server';
import {
  getLatestPositionSnapshot,
  getPositionSnapshotAt,
  listPositionSnapshotTimestamps,
} from '~/lib/server/chantalV2Snapshots';
import {
  isChantalV2TestMode,
  getTestLatestSnapshot,
  getTestSnapshotAt,
  getTestSnapshotTimestamps,
} from '~/lib/server/chantalV2TestMode';
import type { ChantalV2SnapshotsResponse } from '~/lib/chantalV2';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const preferredRegion = 'fra1';

function buildJsonResponse(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}

/**
 * GET /api/chantal/v2/snapshots
 *   - Returns the latest snapshot + full list of snapshot timestamps.
 *
 * GET /api/chantal/v2/snapshots?at=<unix-ms>
 *   - Returns the snapshot closest to the given timestamp (for wayback).
 *
 * In test mode (`CHANTAL_V2_TEST_MODE=1`), returns deterministically-generated
 * demo snapshots instead of reading from MongoDB.
 */
export async function GET(request: NextRequest) {
  try {
    const now = Date.now();
    const testMode = isChantalV2TestMode();
    const demoMode = testMode || request.nextUrl.searchParams.get('demo') === '1';
    const tripId = request.nextUrl.searchParams.get('tripId')?.trim() || undefined;
    const atParam = request.nextUrl.searchParams.get('at');

    if (atParam != null) {
      const targetMs = Number.parseInt(atParam, 10);
      if (!Number.isFinite(targetMs)) {
        return buildJsonResponse({ error: 'Invalid ?at parameter; expected unix milliseconds.' }, 400);
      }

      const snapshot = demoMode
        ? getTestSnapshotAt(targetMs, now)
        : await getPositionSnapshotAt(targetMs, tripId);
      return buildJsonResponse({ snapshot });
    }

    if (demoMode) {
      const latest = getTestLatestSnapshot(now);
      const snapshotTimestamps = getTestSnapshotTimestamps(now);
      const body: ChantalV2SnapshotsResponse = { latest, snapshotTimestamps };
      return buildJsonResponse(body);
    }

    const [latest, snapshotTimestamps] = await Promise.all([
      getLatestPositionSnapshot(tripId),
      listPositionSnapshotTimestamps(undefined, tripId),
    ]);

    const body: ChantalV2SnapshotsResponse = {
      latest,
      snapshotTimestamps,
    };

    return buildJsonResponse(body);
  } catch (error) {
    return buildJsonResponse(
      { error: error instanceof Error ? error.message : 'Unable to retrieve snapshots.' },
      500,
    );
  }
}
