import { NextResponse } from 'next/server';
import type { AirportMapEntry } from '~/components/tracker/flight/types';
import { listAirportDetails } from '~/lib/server/airports';
import { projectCoordinatesToMap } from '~/lib/server/worldMap';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const airports = await listAirportDetails();

    const projectedAirports = await Promise.all(
      airports.map(async (airport): Promise<AirportMapEntry> => {
        if (airport.latitude == null || airport.longitude == null) {
          return { ...airport, x: null, y: null };
        }

        const point = await projectCoordinatesToMap({
          latitude: airport.latitude,
          longitude: airport.longitude,
        });

        return {
          ...airport,
          x: point?.x ?? null,
          y: point?.y ?? null,
        };
      }),
    );

    return NextResponse.json(
      {
        fetchedAt: Date.now(),
        total: projectedAirports.length,
        mapped: projectedAirports.filter((airport) => airport.x != null && airport.y != null).length,
        airports: projectedAirports,
      },
      {
        headers: {
          'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
        },
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load the airport directory right now.';

    return NextResponse.json(
      { error: message },
      {
        status: 500,
        headers: {
          'Cache-Control': 'no-store, max-age=0',
        },
      },
    );
  }
}
