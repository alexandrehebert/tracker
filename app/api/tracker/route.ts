import { NextRequest, NextResponse } from 'next/server';
import { searchFlights } from '~/lib/server/opensky';
import { withProviderRequestContext } from '~/lib/server/providers/observability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const preferredRegion = 'fra1';
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get('q')?.trim() ?? '';
  const forceRefresh = ['1', 'true', 'yes'].includes(request.nextUrl.searchParams.get('refresh')?.trim().toLowerCase() ?? '');

  try {
    const payload = await withProviderRequestContext(
      {
        caller: 'on-demand',
        source: 'tracker-search',
        metadata: { query, forceRefresh },
      },
      () => searchFlights(query, { forceRefresh }),
    );
    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to fetch live flight data right now.';

    return NextResponse.json(
      {
        error: message,
      },
      {
        status: 500,
        headers: {
          'Cache-Control': 'no-store, max-age=0',
        },
      },
    );
  }
}
