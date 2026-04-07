import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { FlightMapAirportMarker } from '~/components/tracker/flight/types';
import ChantalV2Client from '~/components/tracker/friends/ChantalV2Client';
import { ensureDemoV2Trip, getDemoV2TripId } from '~/lib/chantalV2';
import type { FriendsTrackerConfig } from '~/lib/friendsTracker';
import { getCurrentTripConfig, normalizeFriendsTrackerConfig } from '~/lib/friendsTracker';
import { isValidLocale } from '~/i18n/routing';
import { lookupAirportDetails } from '~/lib/server/airports';
import { readFriendsTrackerConfig } from '~/lib/server/friendsTracker';
import {
  getLatestPositionSnapshot,
  listPositionSnapshotTimestamps,
} from '~/lib/server/chantalV2Snapshots';
import {
  isChantalV2TestMode,
  getTestLatestSnapshot,
  getTestSnapshotTimestamps,
} from '~/lib/server/chantalV2TestMode';
import { getWorldMapPayload } from '~/lib/server/worldMap';

export const dynamic = 'force-dynamic';

interface ChantalV2PageProps {
  params: Promise<{ locale: string }>;
}

function normalizeAirportCode(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

async function resolveV2AirportMarkers(config: FriendsTrackerConfig): Promise<FlightMapAirportMarker[]> {
  const requestedAirports = new Map<string, { departure: boolean; arrival: boolean }>();

  const currentTrip = getCurrentTripConfig(config);
  const friends = currentTrip?.friends ?? config.friends;

  for (const friend of friends) {
    for (const leg of friend.flights) {
      const departureCode = normalizeAirportCode(leg.from);
      if (departureCode) {
        const usage = requestedAirports.get(departureCode) ?? { departure: false, arrival: false };
        usage.departure = true;
        requestedAirports.set(departureCode, usage);
      }

      const arrivalCode = normalizeAirportCode(leg.to);
      if (arrivalCode) {
        const usage = requestedAirports.get(arrivalCode) ?? { departure: false, arrival: false };
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

      return {
        id: `chantal-v2-airport-${code.toLowerCase()}`,
        code: airport.iata ?? airport.icao ?? airport.code,
        label,
        latitude: airport.latitude,
        longitude: airport.longitude,
        usage: usage.departure && usage.arrival ? 'both' : usage.departure ? 'departure' : 'arrival',
      } satisfies FlightMapAirportMarker;
    }),
  );

  return markers
    .filter((marker): marker is FlightMapAirportMarker => Boolean(marker))
    .sort((left, right) => left.code.localeCompare(right.code, 'en', { sensitivity: 'base' }));
}

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: 'Chantal Friends Tracker V2',
    description: 'Track each friend\'s real-time position on one shared map, with a full replayable history.',
  };
}

export default async function ChantalV2Page({ params }: ChantalV2PageProps) {
  const { locale } = await params;

  if (!isValidLocale(locale)) {
    notFound();
  }

  const testMode = isChantalV2TestMode();
  const now = Date.now();
  const v2DemoTripId = getDemoV2TripId();

  const rawConfig = await readFriendsTrackerConfig();
  const normalizedConfig = normalizeFriendsTrackerConfig(rawConfig);

  let pageConfig: FriendsTrackerConfig = normalizedConfig;
  let activeTrip = getCurrentTripConfig(pageConfig);

  // Real test mode: only switch to the V2 demo dataset when the selected trip
  // is explicitly the demo/test trip (or the env forces test mode).
  if (testMode || activeTrip?.isDemo) {
    const tripsWithV2Demo = ensureDemoV2Trip(normalizedConfig.trips);
    pageConfig = {
      ...normalizedConfig,
      trips: tripsWithV2Demo,
      currentTripId: v2DemoTripId,
    };
    activeTrip = getCurrentTripConfig(pageConfig);
  } else if (!activeTrip) {
    const tripsWithV2Demo = ensureDemoV2Trip(normalizedConfig.trips);
    pageConfig = {
      ...normalizedConfig,
      trips: tripsWithV2Demo,
      currentTripId: v2DemoTripId,
    };
    activeTrip = getCurrentTripConfig(pageConfig);
  }

  const useDemoSnapshots = testMode || activeTrip?.id === v2DemoTripId || activeTrip?.isDemo === true;
  let latestSnapshot;
  let snapshotTimestamps: number[];

  if (useDemoSnapshots) {
    latestSnapshot = getTestLatestSnapshot(now);
    snapshotTimestamps = getTestSnapshotTimestamps(now);
  } else {
    [latestSnapshot, snapshotTimestamps] = await Promise.all([
      getLatestPositionSnapshot(activeTrip?.id),
      listPositionSnapshotTimestamps(undefined, activeTrip?.id),
    ]);
  }

  const [map, airportMarkers] = await Promise.all([
    getWorldMapPayload(locale),
    resolveV2AirportMarkers(pageConfig),
  ]);

  return (
    <div className="h-[100dvh] w-full overflow-hidden bg-slate-950 text-slate-100">
      <ChantalV2Client
        map={map}
        initialConfig={pageConfig}
        airportMarkers={airportMarkers}
        initialSnapshot={latestSnapshot}
        initialSnapshotTimestamps={snapshotTimestamps}
        useDemoSnapshots={useDemoSnapshots}
      />
    </div>
  );
}
