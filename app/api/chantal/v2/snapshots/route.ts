import { NextRequest, NextResponse } from 'next/server';
import {
  getLatestPositionSnapshot,
  getPositionSnapshotAt,
  listPositionSnapshotTimestamps,
} from '~/lib/server/chantalV2Snapshots';
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
 */
export async function GET(request: NextRequest) {
  try {
    const atParam = request.nextUrl.searchParams.get('at');

    if (atParam != null) {
      const targetMs = Number.parseInt(atParam, 10);
      if (!Number.isFinite(targetMs)) {
        return buildJsonResponse({ error: 'Invalid ?at parameter; expected unix milliseconds.' }, 400);
      }

      const snapshot = await getPositionSnapshotAt(targetMs);
      return buildJsonResponse({ snapshot });
    }

    const [latest, snapshotTimestamps] = await Promise.all([
      getLatestPositionSnapshot(),
      listPositionSnapshotTimestamps(),
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
