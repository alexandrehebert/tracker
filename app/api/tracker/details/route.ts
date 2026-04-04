import { NextRequest, NextResponse } from 'next/server'
import { getFlightSelectionDetails } from '~/lib/server/flightSelectionDetails'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const icao24 = request.nextUrl.searchParams.get('icao24')?.trim() ?? ''

  if (!icao24) {
    return NextResponse.json(
      { error: 'Missing required icao24 query parameter.' },
      {
        status: 400,
        headers: {
          'Cache-Control': 'no-store, max-age=0',
        },
      },
    )
  }

  try {
    const parseOptionalTimestamp = (key: string) => {
      const value = request.nextUrl.searchParams.get(key)?.trim()
      if (!value) {
        return null
      }

      const parsed = Number.parseInt(value, 10)
      return Number.isFinite(parsed) ? parsed : null
    }

    const forceRefresh = ['1', 'true', 'yes'].includes(request.nextUrl.searchParams.get('refresh')?.trim().toLowerCase() ?? '')

    const payload = await getFlightSelectionDetails({
      icao24,
      callsign: request.nextUrl.searchParams.get('callsign')?.trim() ?? null,
      departureAirport: request.nextUrl.searchParams.get('departureAirport')?.trim() ?? null,
      arrivalAirport: request.nextUrl.searchParams.get('arrivalAirport')?.trim() ?? null,
      referenceTime: parseOptionalTimestamp('referenceTime'),
      lastSeen: parseOptionalTimestamp('lastSeen'),
    }, { forceRefresh })

    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to fetch selected flight details right now.'

    return NextResponse.json(
      { error: message },
      {
        status: 500,
        headers: {
          'Cache-Control': 'no-store, max-age=0',
        },
      },
    )
  }
}
