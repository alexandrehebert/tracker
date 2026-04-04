import { NextRequest, NextResponse } from 'next/server';
import { searchFlights } from '~/lib/server/opensky';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get('q')?.trim() ?? '';

  try {
    const payload = await searchFlights(query);
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
