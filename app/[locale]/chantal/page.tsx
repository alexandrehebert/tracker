import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { FlightMapAirportMarker } from '~/components/tracker/flight/types';
import FriendsTrackerClient from '~/components/tracker/friends/FriendsTrackerClient';
import { parseDestinationAirportCodes, type FriendsTrackerConfig } from '~/lib/friendsTracker';
import { isValidLocale } from '~/i18n/routing';
import { lookupAirportDetails } from '~/lib/server/airports';
import { readFriendsTrackerConfig } from '~/lib/server/friendsTracker';
import { getWorldMapPayload } from '~/lib/server/worldMap';

export const dynamic = 'force-dynamic';

interface ChantalPageProps {
  params: Promise<{ locale: string }>;
}

function normalizeAirportCode(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

async function resolveChantalAirportMarkers(config: FriendsTrackerConfig): Promise<FlightMapAirportMarker[]> {
  const requestedAirports = new Map<string, { departure: boolean; arrival: boolean; pinned: boolean }>();
  const destinationAirports = new Set(parseDestinationAirportCodes(config.destinationAirport));

  for (const friend of config.friends) {
    const currentAirportCode = normalizeAirportCode(friend.currentAirport);
    if (currentAirportCode) {
      const usage = requestedAirports.get(currentAirportCode) ?? { departure: false, arrival: false, pinned: false };
      usage.pinned = true;
      requestedAirports.set(currentAirportCode, usage);
    }

    for (const leg of friend.flights) {
      const departureCode = normalizeAirportCode(leg.from);
      if (departureCode) {
        const usage = requestedAirports.get(departureCode) ?? { departure: false, arrival: false, pinned: false };
        usage.departure = true;
        requestedAirports.set(departureCode, usage);
      }

      const arrivalCode = normalizeAirportCode(leg.to);
      if (arrivalCode) {
        const usage = requestedAirports.get(arrivalCode) ?? { departure: false, arrival: false, pinned: false };
        usage.arrival = true;
        requestedAirports.set(arrivalCode, usage);
      }
    }
  }

  const markers = await Promise.all(
    Array.from(requestedAirports.entries()).map(async ([code, usage]) => {
      const airport = await lookupAirportDetails(code);
      if (!airport || airport.latitude == null || airport.longitude == null) {
        return null;
      }

      const label = [airport.city, airport.name]
        .filter((value): value is string => Boolean(value))
        .join(' — ') || airport.name || airport.code;
      const isDestination = [code, airport.iata, airport.icao, airport.code]
        .some((candidate) => Boolean(candidate && destinationAirports.has(normalizeAirportCode(candidate))));

      return {
        id: `chantal-airport-${code.toLowerCase()}`,
        code: airport.iata ?? airport.icao ?? airport.code,
        label,
        latitude: airport.latitude,
        longitude: airport.longitude,
        usage: usage.departure && usage.arrival
          ? 'both'
          : usage.departure
            ? 'departure'
            : usage.arrival
              ? 'arrival'
              : 'both',
        isDestination,
      } satisfies FlightMapAirportMarker;
    }),
  );

  const resolvedMarkers: FlightMapAirportMarker[] = [];
  for (const marker of markers) {
    if (marker) {
      resolvedMarkers.push(marker);
    }
  }

  return resolvedMarkers
    .sort((left, right) => left.code.localeCompare(right.code, 'en', { sensitivity: 'base' }));
}

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: 'Chantal Friends Tracker',
    description: 'Track the whole crew on one shared map, including connections and completed flight legs.',
  };
}

export default async function ChantalPage({ params }: ChantalPageProps) {
  const { locale } = await params;

  if (!isValidLocale(locale)) {
    notFound();
  }

  const [map, initialConfig] = await Promise.all([
    getWorldMapPayload(locale),
    readFriendsTrackerConfig(),
  ]);
  const airportMarkers = await resolveChantalAirportMarkers(initialConfig);

  return (
    <div className="h-[100dvh] w-full overflow-hidden bg-slate-950 text-slate-100">
      <FriendsTrackerClient map={map} initialConfig={initialConfig} airportMarkers={airportMarkers} />
    </div>
  );
}
