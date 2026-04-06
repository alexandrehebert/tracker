import { NextResponse } from 'next/server';
import {
  readFriendsTrackerConfigWithAirportTimezones,
  withFriendsTrackerAirportTimezones,
  writeFriendsTrackerConfig,
} from '~/lib/server/friendsTracker';

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

export async function GET() {
  try {
    return buildJsonResponse(await readFriendsTrackerConfigWithAirportTimezones());
  } catch (error) {
    return buildJsonResponse({
      error: error instanceof Error ? error.message : 'Unable to load the Chantal tracker config.',
    }, 500);
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as {
      updatedBy?: string | null;
      cronEnabled?: boolean;
      currentTripId?: string | null;
      destinationAirport?: string | null;
      trips?: unknown;
      friends?: unknown;
    };

    const payload = await writeFriendsTrackerConfig({
      updatedBy: typeof body.updatedBy === 'string' ? body.updatedBy : null,
      cronEnabled: typeof body.cronEnabled === 'boolean' ? body.cronEnabled : undefined,
      currentTripId: typeof body.currentTripId === 'string'
        ? body.currentTripId
        : body.currentTripId === null
        ? null
        : undefined,
      destinationAirport: typeof body.destinationAirport === 'string'
        ? body.destinationAirport
        : body.destinationAirport === null
        ? null
        : undefined,
      trips: Array.isArray(body.trips) ? body.trips : undefined,
      friends: Array.isArray(body.friends) ? body.friends : undefined,
    });

    return buildJsonResponse(await withFriendsTrackerAirportTimezones(payload));
  } catch (error) {
    return buildJsonResponse({
      error: error instanceof Error ? error.message : 'Unable to save the Chantal tracker config.',
    }, 500);
  }
}
