import { NextRequest, NextResponse } from 'next/server';
import type { AirportMapEntry } from '~/components/tracker/flight/types';
import { buildAirportTimezoneLookup, listAirportDetails, lookupAirportDetails } from '~/lib/server/airports';
import { projectCoordinatesToMap } from '~/lib/server/worldMap';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const query = request.nextUrl.searchParams.get('query')?.trim() ?? '';
    const codesParam = request.nextUrl.searchParams.get('codes')?.trim() ?? '';
    const parsedLimit = Number.parseInt(request.nextUrl.searchParams.get('limit') ?? '', 10);
    const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 20) : 6;

    if (codesParam) {
      const codes = Array.from(new Set(codesParam.split(',').map((code) => code.trim()).filter(Boolean)));
      const airports = (await Promise.all(codes.map((code) => lookupAirportDetails(code))))
        .filter((airport): airport is NonNullable<typeof airport> => Boolean(airport))
        .map((airport): AirportMapEntry => ({ ...airport, x: null, y: null }));

      return NextResponse.json(
        {
          fetchedAt: Date.now(),
          total: airports.length,
          mapped: 0,
          airports,
          timezones: buildAirportTimezoneLookup(airports),
        },
        {
          headers: {
            'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
          },
        },
      );
    }

    if (query) {
      const airports = (await listAirportDetails({ search: query, limit }))
        .map((airport): AirportMapEntry => ({ ...airport, x: null, y: null }));

      return NextResponse.json(
        {
          fetchedAt: Date.now(),
          total: airports.length,
          mapped: 0,
          airports,
          timezones: buildAirportTimezoneLookup(airports),
        },
        {
          headers: {
            'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600',
          },
        },
      );
    }

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
