import { MongoClient, type Collection } from 'mongodb';
import type {
  AirportDetails,
  FlightDataSource,
  FlightFetchSnapshot,
  FlightFetchTrigger,
  FlightMapPoint,
  FlightSourceDetail,
  SelectedFlightDetails,
  TrackerApiResponse,
  TrackedFlight,
  TrackedFlightRoute,
} from '~/components/tracker/flight/types';

const DEFAULT_CACHE_TTL_SECONDS = 300;
const DEFAULT_DETAILS_CACHE_TTL_SECONDS = 1_800;
const DEFAULT_AIRPORT_DIRECTORY_CACHE_TTL_SECONDS = 24 * 60 * 60;
const DEFAULT_DB_NAME = 'tracker';
const CACHE_COLLECTION_NAME = 'flight_search_cache';
const DETAILS_CACHE_COLLECTION_NAME = 'flight_details_cache';
const AIRPORT_DIRECTORY_CACHE_COLLECTION_NAME = 'airport_directory_cache';
const SHARED_FLIGHT_COLLECTION_NAME = 'shared_flight_cache';

type FlightSearchCacheDocument = {
  _id: string;
  payload: TrackerApiResponse;
  expiresAt: Date;
  updatedAt: Date;
};

type AirportDirectoryCacheDocument = {
  _id: string;
  payload: AirportDetails[];
  expiresAt: Date;
  updatedAt: Date;
};

type FlightDetailsCacheDocument = {
  _id: string;
  payload: SelectedFlightDetails;
  expiresAt: Date;
  updatedAt: Date;
};

type SharedFlightCacheDocument = {
  _id: string;
  payload: TrackedFlight;
  updatedAt: Date;
};

let mongoClientPromise: Promise<MongoClient> | null = null;
let flightCacheIndexesReady: Promise<void> | null = null;
let flightDetailsCacheIndexesReady: Promise<void> | null = null;
let airportDirectoryCacheIndexesReady: Promise<void> | null = null;
let sharedFlightCacheIndexesReady: Promise<void> | null = null;
let mongoWarningLogged = false;

function getCacheTtlSeconds(): number {
  const configuredValue = process.env.OPENSKY_CACHE_TTL_SECONDS?.trim();
  const parsedValue = configuredValue ? Number.parseInt(configuredValue, 10) : DEFAULT_CACHE_TTL_SECONDS;

  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : DEFAULT_CACHE_TTL_SECONDS;
}

function getDetailsCacheTtlSeconds(): number {
  const configuredValue = process.env.OPENSKY_DETAILS_CACHE_TTL_SECONDS?.trim();
  const parsedValue = configuredValue ? Number.parseInt(configuredValue, 10) : DEFAULT_DETAILS_CACHE_TTL_SECONDS;

  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : DEFAULT_DETAILS_CACHE_TTL_SECONDS;
}

function getAirportDirectoryCacheTtlSeconds(): number {
  const configuredValue = process.env.AIRPORT_DIRECTORY_CACHE_TTL_SECONDS?.trim();
  const parsedValue = configuredValue
    ? Number.parseInt(configuredValue, 10)
    : DEFAULT_AIRPORT_DIRECTORY_CACHE_TTL_SECONDS;

  return Number.isFinite(parsedValue) && parsedValue > 0
    ? parsedValue
    : DEFAULT_AIRPORT_DIRECTORY_CACHE_TTL_SECONDS;
}

function isMongoConfigured(): boolean {
  return Boolean(process.env.MONGODB_URI?.trim());
}

function getMongoDbName(): string {
  const configuredName = process.env.MONGODB_DB_NAME?.trim();
  return configuredName || DEFAULT_DB_NAME;
}

export function isMongoFlightCacheConfigured(): boolean {
  return isMongoConfigured();
}

function logMongoWarning(error: unknown) {
  if (mongoWarningLogged) {
    return;
  }

  mongoWarningLogged = true;
  console.warn('MongoDB flight cache is unavailable.', error);
}

function normalizeHistoryIdentifier(value: string | null | undefined): string {
  return typeof value === 'string' ? value.replace(/\s+/g, '').trim().toUpperCase() : '';
}

async function mergeTrackerPayloadWithHistoricalFlights(payload: TrackerApiResponse): Promise<TrackerApiResponse> {
  const unresolvedIdentifiers = Array.from(
    new Set(payload.notFoundIdentifiers.map((identifier) => normalizeHistoryIdentifier(identifier)).filter(Boolean)),
  );

  if (unresolvedIdentifiers.length === 0) {
    return payload;
  }

  const historicalMatches = await Promise.all(
    unresolvedIdentifiers.map(async (identifier) => [identifier, await readSharedFlightCache(identifier)] as const),
  );
  const matchedPairs = historicalMatches.filter((entry): entry is readonly [string, TrackedFlight] => Boolean(entry[1]));

  if (matchedPairs.length === 0) {
    return payload;
  }

  const flightsByIcao24 = new Map(
    payload.flights.map((flight) => [normalizeHistoryIdentifier(flight.icao24).toLowerCase(), flight] as const),
  );

  for (const [, historicalFlight] of matchedPairs) {
    const key = normalizeHistoryIdentifier(historicalFlight.icao24).toLowerCase();
    const currentFlight = flightsByIcao24.get(key);
    flightsByIcao24.set(
      key,
      currentFlight ? reconcileTrackedFlightForCache(historicalFlight, currentFlight) : historicalFlight,
    );
  }

  const matchedLookup = new Set([
    ...payload.matchedIdentifiers.map((identifier) => normalizeHistoryIdentifier(identifier)),
    ...matchedPairs.map(([identifier]) => identifier),
  ]);

  return {
    ...payload,
    matchedIdentifiers: payload.requestedIdentifiers.filter((identifier) => matchedLookup.has(normalizeHistoryIdentifier(identifier))),
    notFoundIdentifiers: payload.requestedIdentifiers.filter((identifier) => !matchedLookup.has(normalizeHistoryIdentifier(identifier))),
    flights: Array.from(flightsByIcao24.values()).sort((first, second) => first.callsign.localeCompare(second.callsign)),
  };
}

function mergeUniqueStrings(...lists: Array<string[] | undefined>): string[] {
  return Array.from(
    new Set(
      lists.flatMap((list) => (list ?? []).map((value) => value.trim()).filter(Boolean)),
    ),
  );
}

const MAX_RECONCILED_TRACK_POINTS = 120;

function chooseMostRecentPoint(next: FlightMapPoint | null, previous: FlightMapPoint | null): FlightMapPoint | null {
  if (!next) {
    return previous;
  }

  if (!previous) {
    return next;
  }

  if (next.time != null && previous.time != null) {
    return next.time >= previous.time ? next : previous;
  }

  if (next.time != null) {
    return next;
  }

  return previous.time != null ? previous : next;
}

function chooseEarliestPoint(next: FlightMapPoint | null, previous: FlightMapPoint | null): FlightMapPoint | null {
  if (!next) {
    return previous;
  }

  if (!previous) {
    return next;
  }

  if (next.time != null && previous.time != null) {
    return next.time <= previous.time ? next : previous;
  }

  if (next.time != null) {
    return next;
  }

  return previous.time != null ? previous : next;
}

function limitTrackPoints(points: FlightMapPoint[]): FlightMapPoint[] {
  if (points.length <= MAX_RECONCILED_TRACK_POINTS) {
    return points;
  }

  const lastIndex = points.length - 1;

  return Array.from({ length: MAX_RECONCILED_TRACK_POINTS }, (_, sampleIndex) => {
    const pointIndex = Math.floor((sampleIndex * lastIndex) / (MAX_RECONCILED_TRACK_POINTS - 1));
    return points[pointIndex] ?? null;
  }).filter((point): point is FlightMapPoint => Boolean(point));
}

function mergeTrackPoints(previous: FlightMapPoint[] = [], next: FlightMapPoint[] = []): FlightMapPoint[] {
  const merged = new Map<string, FlightMapPoint>();

  for (const point of [...previous, ...next]) {
    const key = point.time != null
      ? `t:${point.time}`
      : `c:${point.latitude.toFixed(4)}:${point.longitude.toFixed(4)}:${point.altitude ?? 'na'}`;

    merged.set(key, point);
  }

  const sortedPoints = Array.from(merged.values())
    .sort((first, second) => {
      if (first.time == null && second.time == null) {
        return 0;
      }

      if (first.time == null) {
        return 1;
      }

      if (second.time == null) {
        return -1;
      }

      return first.time - second.time;
    });

  return limitTrackPoints(sortedPoints);
}

function mergeRouteValues(
  previous: TrackedFlightRoute | null | undefined,
  next: TrackedFlightRoute | null | undefined,
): TrackedFlightRoute {
  return {
    departureAirport: next?.departureAirport ?? previous?.departureAirport ?? null,
    arrivalAirport: next?.arrivalAirport ?? previous?.arrivalAirport ?? null,
    firstSeen: next?.firstSeen ?? previous?.firstSeen ?? null,
    lastSeen: next?.lastSeen ?? previous?.lastSeen ?? null,
  };
}

function mergeDataSource(
  previous: FlightDataSource | undefined,
  next: FlightDataSource | undefined,
): FlightDataSource | undefined {
  if (previous && next && previous !== next) {
    return 'hybrid';
  }

  return next ?? previous;
}

function mergeSourceDetails(
  previous: FlightSourceDetail[] | undefined,
  next: FlightSourceDetail[] | undefined,
): FlightSourceDetail[] | undefined {
  const merged = new Map<FlightSourceDetail['source'], FlightSourceDetail>();

  for (const detail of [...(previous ?? []), ...(next ?? [])]) {
    const existing = merged.get(detail.source);
    if (!existing) {
      merged.set(detail.source, detail);
      continue;
    }

    const priority = { used: 4, error: 3, 'no-data': 2, skipped: 1 } as const;
    const shouldUseIncomingStatus = priority[detail.status] >= priority[existing.status];

    merged.set(detail.source, {
      ...existing,
      ...detail,
      status: shouldUseIncomingStatus ? detail.status : existing.status,
      usedInResult: existing.usedInResult || detail.usedInResult,
      reason: detail.reason || existing.reason,
      raw: detail.raw ?? existing.raw ?? null,
    });
  }

  return merged.size > 0 ? Array.from(merged.values()) : undefined;
}

function reconcileTrackedFlightForCache(previous: TrackedFlight | undefined, next: TrackedFlight): TrackedFlight {
  if (!previous) {
    return next;
  }

  const mergedCurrent = chooseMostRecentPoint(next.current, previous.current);
  const mergedTrack = mergeTrackPoints(previous.track, next.track);
  const mergedRawTrack = mergeTrackPoints(previous.rawTrack ?? previous.track, next.rawTrack ?? next.track);
  const mergedOriginPoint = chooseEarliestPoint(
    chooseEarliestPoint(mergedTrack[0] ?? null, next.originPoint),
    previous.originPoint,
  ) ?? mergedCurrent;
  const previousLastContact = previous.lastContact ?? Number.NEGATIVE_INFINITY;
  const nextLastContact = next.lastContact ?? Number.NEGATIVE_INFINITY;
  const mergedLastContact = Number.isFinite(Math.max(previousLastContact, nextLastContact))
    ? Math.max(previousLastContact, nextLastContact)
    : (next.lastContact ?? previous.lastContact ?? null);

  return {
    ...previous,
    ...next,
    callsign: next.callsign || previous.callsign,
    originCountry: next.originCountry !== 'Unknown' ? next.originCountry : previous.originCountry,
    matchedBy: mergeUniqueStrings(previous.matchedBy, next.matchedBy),
    lastContact: mergedLastContact,
    current: mergedCurrent,
    originPoint: mergedOriginPoint,
    track: mergedTrack.length ? mergedTrack : (next.track.length ? next.track : previous.track),
    rawTrack: mergedRawTrack.length ? mergedRawTrack : (next.rawTrack ?? previous.rawTrack ?? []),
    onGround: nextLastContact >= previousLastContact ? next.onGround : previous.onGround,
    velocity: next.velocity ?? previous.velocity,
    heading: next.heading ?? previous.heading ?? mergedCurrent?.heading ?? null,
    verticalRate: next.verticalRate ?? previous.verticalRate,
    geoAltitude: next.geoAltitude ?? next.current?.altitude ?? previous.geoAltitude ?? previous.current?.altitude ?? null,
    baroAltitude: next.baroAltitude ?? previous.baroAltitude,
    squawk: next.squawk ?? previous.squawk,
    category: next.category ?? previous.category,
    route: mergeRouteValues(previous.route, next.route),
    flightNumber: next.flightNumber ?? previous.flightNumber,
    airline: next.airline ?? previous.airline,
    aircraft: next.aircraft ?? previous.aircraft,
    dataSource: mergeDataSource(previous.dataSource, next.dataSource),
    sourceDetails: mergeSourceDetails(previous.sourceDetails, next.sourceDetails),
    fetchHistory: mergeFetchHistoryLists(previous.fetchHistory, next.fetchHistory),
  };
}

type SnapshotFlightBase = Pick<TrackedFlight, 'icao24'>
  & Partial<Pick<TrackedFlight,
    | 'matchedBy'
    | 'route'
    | 'current'
    | 'onGround'
    | 'lastContact'
    | 'velocity'
    | 'heading'
    | 'geoAltitude'
    | 'baroAltitude'
    | 'flightNumber'
    | 'airline'
    | 'aircraft'
    | 'dataSource'
    | 'sourceDetails'
  >>;

function buildFlightFetchSnapshot(
  flight: SnapshotFlightBase,
  capturedAt: number,
  trigger: FlightFetchTrigger,
  details?: Partial<SelectedFlightDetails> | null,
): FlightFetchSnapshot {
  return {
    id: `${flight.icao24}:${trigger}:${capturedAt}`,
    capturedAt,
    trigger,
    dataSource: details?.dataSource ?? flight.dataSource ?? 'opensky',
    matchedBy: mergeUniqueStrings(flight.matchedBy),
    route: details?.route ?? flight.route ?? {
      departureAirport: null,
      arrivalAirport: null,
      firstSeen: null,
      lastSeen: null,
    },
    current: flight.current ?? null,
    onGround: flight.onGround ?? false,
    lastContact: flight.lastContact ?? null,
    velocity: flight.velocity ?? null,
    heading: flight.heading ?? null,
    geoAltitude: details ? (flight.geoAltitude ?? null) : (flight.geoAltitude ?? flight.current?.altitude ?? null),
    baroAltitude: flight.baroAltitude ?? null,
    flightNumber: details?.flightNumber ?? flight.flightNumber ?? null,
    airline: details?.airline ?? flight.airline ?? null,
    aircraft: details?.aircraft ?? flight.aircraft ?? null,
    departureAirport: details?.departureAirport ?? null,
    arrivalAirport: details?.arrivalAirport ?? null,
    sourceDetails: mergeSourceDetails(flight.sourceDetails, details?.sourceDetails) ?? [],
  };
}

function buildSnapshotMaterialKey(snapshot: FlightFetchSnapshot): string {
  const sourceStates = (snapshot.sourceDetails ?? [])
    .map((detail) => `${detail.source}:${detail.status}:${detail.usedInResult ? 'used' : 'unused'}`)
    .sort();

  return JSON.stringify({
    dataSource: snapshot.dataSource,
    route: {
      departureAirport: snapshot.route.departureAirport ?? null,
      arrivalAirport: snapshot.route.arrivalAirport ?? null,
    },
    onGround: snapshot.onGround,
    velocity: snapshot.velocity ?? null,
    geoAltitude: snapshot.geoAltitude ?? null,
    flightNumber: snapshot.flightNumber ?? null,
    airline: snapshot.airline?.name ?? null,
    aircraft: snapshot.aircraft
      ? {
          registration: snapshot.aircraft.registration ?? null,
          icao: snapshot.aircraft.icao ?? null,
          iata: snapshot.aircraft.iata ?? null,
          model: snapshot.aircraft.model ?? null,
        }
      : null,
    sourceStates,
  });
}

function mergeFlightFetchHistory(
  history: FlightFetchSnapshot[] | undefined,
  snapshot: FlightFetchSnapshot,
): FlightFetchSnapshot[] {
  const nextHistory = [...(history ?? [])];
  const existingIndex = nextHistory.findIndex((entry) => entry.id === snapshot.id);

  if (existingIndex >= 0) {
    const current = nextHistory[existingIndex]!;
    const currentLastContact = current.lastContact ?? Number.NEGATIVE_INFINITY;
    const snapshotLastContact = snapshot.lastContact ?? Number.NEGATIVE_INFINITY;
    const preferIncomingTelemetry = snapshotLastContact >= currentLastContact;

    nextHistory[existingIndex] = {
      ...current,
      ...snapshot,
      matchedBy: mergeUniqueStrings(current.matchedBy, snapshot.matchedBy),
      route: mergeRouteValues(current.route, snapshot.route),
      current: preferIncomingTelemetry
        ? chooseMostRecentPoint(snapshot.current, current.current)
        : chooseMostRecentPoint(current.current, snapshot.current),
      onGround: preferIncomingTelemetry ? snapshot.onGround : current.onGround,
      lastContact: Number.isFinite(Math.max(currentLastContact, snapshotLastContact))
        ? Math.max(currentLastContact, snapshotLastContact)
        : (snapshot.lastContact ?? current.lastContact),
      velocity: preferIncomingTelemetry ? (snapshot.velocity ?? current.velocity) : (current.velocity ?? snapshot.velocity),
      heading: preferIncomingTelemetry ? (snapshot.heading ?? current.heading) : (current.heading ?? snapshot.heading),
      geoAltitude: preferIncomingTelemetry ? (snapshot.geoAltitude ?? current.geoAltitude) : (current.geoAltitude ?? snapshot.geoAltitude),
      baroAltitude: preferIncomingTelemetry ? (snapshot.baroAltitude ?? current.baroAltitude) : (current.baroAltitude ?? snapshot.baroAltitude),
      flightNumber: snapshot.flightNumber ?? current.flightNumber,
      airline: snapshot.airline ?? current.airline,
      aircraft: snapshot.aircraft ?? current.aircraft,
      departureAirport: snapshot.departureAirport ?? current.departureAirport,
      arrivalAirport: snapshot.arrivalAirport ?? current.arrivalAirport,
      sourceDetails: mergeSourceDetails(current.sourceDetails, snapshot.sourceDetails),
      dataSource: mergeDataSource(current.dataSource, snapshot.dataSource) ?? 'opensky',
    };

    return nextHistory;
  }

  const lastEntry = nextHistory.at(-1);
  const previousComparable = lastEntry ? buildSnapshotMaterialKey(lastEntry) : null;
  const snapshotComparable = buildSnapshotMaterialKey(snapshot);

  if (lastEntry?.trigger === snapshot.trigger && previousComparable === snapshotComparable) {
    return nextHistory;
  }

  nextHistory.push(snapshot);
  return nextHistory.slice(-8);
}

function mergeFetchHistoryLists(...lists: Array<FlightFetchSnapshot[] | undefined>): FlightFetchSnapshot[] {
  return lists.reduce<FlightFetchSnapshot[]>((merged, history) => {
    let nextMerged = merged;
    for (const snapshot of history ?? []) {
      nextMerged = mergeFlightFetchHistory(nextMerged, snapshot);
    }
    return nextMerged;
  }, []);
}

function mergeTrackerPayloadForSharedCache(
  previous: TrackerApiResponse | null,
  incoming: TrackerApiResponse,
  trigger: FlightFetchTrigger,
): TrackerApiResponse {
  const previousByIcao24 = new Map((previous?.flights ?? []).map((flight) => [flight.icao24, flight]));
  const mergedFlights = incoming.flights.map((flight) => reconcileTrackedFlightForCache(previousByIcao24.get(flight.icao24), flight));

  if (previous && normalizeHistoryIdentifier(previous.query) === normalizeHistoryIdentifier(incoming.query)) {
    const unresolvedIdentifiers = new Set(incoming.notFoundIdentifiers.map((identifier) => normalizeHistoryIdentifier(identifier)));

    for (const previousFlight of previous.flights) {
      if (mergedFlights.some((flight) => flight.icao24 === previousFlight.icao24)) {
        continue;
      }

      const shouldPreserve = previousFlight.matchedBy.some((value) => unresolvedIdentifiers.has(normalizeHistoryIdentifier(value)))
        || unresolvedIdentifiers.has(normalizeHistoryIdentifier(previousFlight.callsign))
        || unresolvedIdentifiers.has(normalizeHistoryIdentifier(previousFlight.icao24));

      if (shouldPreserve) {
        mergedFlights.push(previousFlight);
      }
    }
  }

  mergedFlights.sort((first, second) => first.callsign.localeCompare(second.callsign));

  return {
    ...incoming,
    flights: mergedFlights.map((flight) => ({
      ...flight,
      fetchHistory: mergeFlightFetchHistory(
        mergeFetchHistoryLists(previousByIcao24.get(flight.icao24)?.fetchHistory, flight.fetchHistory),
        buildFlightFetchSnapshot(flight, incoming.fetchedAt, trigger),
      ),
    })),
  };
}

function mergeSelectedFlightDetailsForSharedCache(
  previous: SelectedFlightDetails | null,
  incoming: SelectedFlightDetails,
  trigger: FlightFetchTrigger,
): SelectedFlightDetails {
  const historySeed = mergeFetchHistoryLists(previous?.fetchHistory, incoming.fetchHistory);
  const nextFetchHistory = mergeFlightFetchHistory(
    historySeed,
    buildFlightFetchSnapshot({
      icao24: incoming.icao24,
      matchedBy: mergeUniqueStrings([incoming.callsign, incoming.icao24]),
      route: incoming.route,
      current: null,
      onGround: false,
      lastContact: null,
      velocity: null,
      heading: null,
      geoAltitude: null,
      baroAltitude: null,
      flightNumber: incoming.flightNumber ?? null,
      airline: incoming.airline ?? null,
      aircraft: incoming.aircraft ?? null,
      dataSource: incoming.dataSource,
      sourceDetails: incoming.sourceDetails,
    }, incoming.fetchedAt, trigger, incoming),
  );

  return {
    ...previous,
    ...incoming,
    fetchedAt: Math.max(previous?.fetchedAt ?? 0, incoming.fetchedAt),
    route: mergeRouteValues(previous?.route, incoming.route),
    departureAirport: incoming.departureAirport ?? previous?.departureAirport ?? null,
    arrivalAirport: incoming.arrivalAirport ?? previous?.arrivalAirport ?? null,
    flightNumber: incoming.flightNumber ?? previous?.flightNumber ?? null,
    airline: incoming.airline ?? previous?.airline ?? null,
    aircraft: incoming.aircraft ?? previous?.aircraft ?? null,
    dataSource: mergeDataSource(previous?.dataSource, incoming.dataSource),
    sourceDetails: mergeSourceDetails(previous?.sourceDetails, incoming.sourceDetails),
    fetchHistory: nextFetchHistory,
  };
}

function buildTrackedFlightFromDetails(details: SelectedFlightDetails): TrackedFlight {
  return {
    icao24: details.icao24,
    callsign: details.callsign,
    originCountry: 'Unknown',
    matchedBy: mergeUniqueStrings([details.callsign, details.icao24]),
    lastContact: details.route.lastSeen ?? details.route.firstSeen ?? null,
    current: null,
    originPoint: null,
    track: [],
    rawTrack: [],
    onGround: false,
    velocity: null,
    heading: null,
    verticalRate: null,
    geoAltitude: null,
    baroAltitude: null,
    squawk: null,
    category: null,
    route: details.route,
    flightNumber: details.flightNumber ?? null,
    airline: details.airline ?? null,
    aircraft: details.aircraft ?? null,
    dataSource: details.dataSource,
    sourceDetails: details.sourceDetails,
    fetchHistory: details.fetchHistory,
  };
}

function mergeSelectedFlightDetailsWithSharedFlight(
  details: SelectedFlightDetails,
  sharedFlight: TrackedFlight | null,
): SelectedFlightDetails {
  if (!sharedFlight) {
    return details;
  }

  return {
    ...details,
    route: mergeRouteValues(sharedFlight.route, details.route),
    flightNumber: details.flightNumber ?? sharedFlight.flightNumber ?? null,
    airline: details.airline ?? sharedFlight.airline ?? null,
    aircraft: details.aircraft ?? sharedFlight.aircraft ?? null,
    dataSource: mergeDataSource(sharedFlight.dataSource, details.dataSource),
    sourceDetails: mergeSourceDetails(sharedFlight.sourceDetails, details.sourceDetails),
    fetchHistory: mergeFetchHistoryLists(sharedFlight.fetchHistory, details.fetchHistory),
  };
}

async function getSharedFlightCollection(): Promise<Collection<SharedFlightCacheDocument> | null> {
  const mongoUri = process.env.MONGODB_URI?.trim();
  if (!mongoUri) {
    return null;
  }

  try {
    if (!mongoClientPromise) {
      const client = new MongoClient(mongoUri);
      mongoClientPromise = client.connect();
    }

    let client: MongoClient;
    try {
      client = await mongoClientPromise;
    } catch (error) {
      mongoClientPromise = null;
      throw error;
    }

    const collection = client.db(getMongoDbName()).collection<SharedFlightCacheDocument>(SHARED_FLIGHT_COLLECTION_NAME);

    if (!sharedFlightCacheIndexesReady) {
      sharedFlightCacheIndexesReady = Promise.all([
        collection.createIndex({ updatedAt: -1 }),
      ]).then(() => undefined);
    }

    try {
      await sharedFlightCacheIndexesReady;
    } catch (error) {
      sharedFlightCacheIndexesReady = null;
      throw error;
    }

    return collection;
  } catch (error) {
    logMongoWarning(error);
    return null;
  }
}

async function readSharedFlightCache(icao24: string): Promise<TrackedFlight | null> {
  const cacheKey = normalizeHistoryIdentifier(icao24).toLowerCase();
  if (!cacheKey) {
    return null;
  }

  const collection = await getSharedFlightCollection();
  if (!collection) {
    return null;
  }

  try {
    const cachedDocument = await collection.findOne({ _id: cacheKey });
    return cachedDocument?.payload ?? null;
  } catch (error) {
    logMongoWarning(error);
    return null;
  }
}

async function writeSharedFlightCache(flight: TrackedFlight): Promise<TrackedFlight> {
  const cacheKey = normalizeHistoryIdentifier(flight.icao24).toLowerCase();
  if (!cacheKey) {
    return flight;
  }

  const previousFlight = await readSharedFlightCache(cacheKey);
  const mergedFlight = reconcileTrackedFlightForCache(previousFlight ?? undefined, flight);

  const collection = await getSharedFlightCollection();
  if (!collection) {
    return mergedFlight;
  }

  try {
    await collection.updateOne(
      { _id: cacheKey },
      {
        $set: {
          payload: mergedFlight,
          updatedAt: new Date(),
        },
      },
      { upsert: true },
    );
  } catch (error) {
    logMongoWarning(error);
  }

  return mergedFlight;
}

async function hydrateTrackerPayloadFromSharedFlights(payload: TrackerApiResponse): Promise<TrackerApiResponse> {
  const hydratedFlights = await Promise.all(payload.flights.map(async (flight) => {
    const sharedFlight = await readSharedFlightCache(flight.icao24);
    return sharedFlight ? reconcileTrackedFlightForCache(sharedFlight, flight) : flight;
  }));

  return {
    ...payload,
    flights: hydratedFlights,
  };
}

async function persistTrackerPayloadToSharedFlights(payload: TrackerApiResponse): Promise<TrackerApiResponse> {
  const persistedFlights = await Promise.all(payload.flights.map((flight) => writeSharedFlightCache(flight)));

  return {
    ...payload,
    flights: persistedFlights,
  };
}

async function hydrateSelectedFlightDetailsFromSharedFlight(details: SelectedFlightDetails): Promise<SelectedFlightDetails> {
  const sharedFlight = await readSharedFlightCache(details.icao24);
  return mergeSelectedFlightDetailsWithSharedFlight(details, sharedFlight);
}

async function persistSelectedFlightDetailsToSharedFlight(details: SelectedFlightDetails): Promise<SelectedFlightDetails> {
  const sharedFlight = await writeSharedFlightCache(buildTrackedFlightFromDetails(details));
  return mergeSelectedFlightDetailsWithSharedFlight(details, sharedFlight);
}

async function getCacheCollection(): Promise<Collection<FlightSearchCacheDocument> | null> {
  const mongoUri = process.env.MONGODB_URI?.trim();
  if (!mongoUri) {
    return null;
  }

  try {
    if (!mongoClientPromise) {
      const client = new MongoClient(mongoUri);
      mongoClientPromise = client.connect();
    }

    let client: MongoClient;
    try {
      client = await mongoClientPromise;
    } catch (error) {
      mongoClientPromise = null;
      throw error;
    }

    const collection = client.db(getMongoDbName()).collection<FlightSearchCacheDocument>(CACHE_COLLECTION_NAME);

    if (!flightCacheIndexesReady) {
      flightCacheIndexesReady = Promise.all([
        collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
        collection.createIndex({ updatedAt: -1 }),
      ]).then(() => undefined);
    }

    try {
      await flightCacheIndexesReady;
    } catch (error) {
      flightCacheIndexesReady = null;
      throw error;
    }

    return collection;
  } catch (error) {
    logMongoWarning(error);
    return null;
  }
}

async function getDetailsCacheCollection(): Promise<Collection<FlightDetailsCacheDocument> | null> {
  const mongoUri = process.env.MONGODB_URI?.trim();
  if (!mongoUri) {
    return null;
  }

  try {
    if (!mongoClientPromise) {
      const client = new MongoClient(mongoUri);
      mongoClientPromise = client.connect();
    }

    let client: MongoClient;
    try {
      client = await mongoClientPromise;
    } catch (error) {
      mongoClientPromise = null;
      throw error;
    }

    const collection = client.db(getMongoDbName()).collection<FlightDetailsCacheDocument>(DETAILS_CACHE_COLLECTION_NAME);

    if (!flightDetailsCacheIndexesReady) {
      flightDetailsCacheIndexesReady = Promise.all([
        collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
        collection.createIndex({ updatedAt: -1 }),
      ]).then(() => undefined);
    }

    try {
      await flightDetailsCacheIndexesReady;
    } catch (error) {
      flightDetailsCacheIndexesReady = null;
      throw error;
    }

    return collection;
  } catch (error) {
    logMongoWarning(error);
    return null;
  }
}

async function getAirportDirectoryCacheCollection(): Promise<Collection<AirportDirectoryCacheDocument> | null> {
  const mongoUri = process.env.MONGODB_URI?.trim();
  if (!mongoUri) {
    return null;
  }

  try {
    if (!mongoClientPromise) {
      const client = new MongoClient(mongoUri);
      mongoClientPromise = client.connect();
    }

    let client: MongoClient;
    try {
      client = await mongoClientPromise;
    } catch (error) {
      mongoClientPromise = null;
      throw error;
    }

    const collection = client
      .db(getMongoDbName())
      .collection<AirportDirectoryCacheDocument>(AIRPORT_DIRECTORY_CACHE_COLLECTION_NAME);

    if (!airportDirectoryCacheIndexesReady) {
      airportDirectoryCacheIndexesReady = Promise.all([
        collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
        collection.createIndex({ updatedAt: -1 }),
      ]).then(() => undefined);
    }

    try {
      await airportDirectoryCacheIndexesReady;
    } catch (error) {
      airportDirectoryCacheIndexesReady = null;
      throw error;
    }

    return collection;
  } catch (error) {
    logMongoWarning(error);
    return null;
  }
}

export function getFlightSearchCacheTtlSeconds(): number {
  return getCacheTtlSeconds();
}

export async function readFlightSearchCache(cacheKey: string): Promise<TrackerApiResponse | null> {
  const collection = await getCacheCollection();
  if (!collection) {
    return null;
  }

  try {
    const cachedDocument = await collection.findOne({
      _id: cacheKey,
      expiresAt: { $gt: new Date() },
    });

    if (!cachedDocument) {
      return null;
    }

    const hydratedPayload = await hydrateTrackerPayloadFromSharedFlights(cachedDocument.payload);
    return hydratedPayload;
  } catch (error) {
    logMongoWarning(error);
    return null;
  }
}

export async function writeFlightSearchCache(
  cacheKey: string,
  payload: TrackerApiResponse,
  trigger: FlightFetchTrigger = 'search',
): Promise<TrackerApiResponse> {
  const ttlMs = getCacheTtlSeconds() * 1000;
  const expiresAt = new Date(Date.now() + ttlMs);
  const previousPayload = await readFlightSearchCache(cacheKey);
  const mergedPayload = mergeTrackerPayloadForSharedCache(previousPayload, payload, trigger);
  const mergedHistoricalPayload = await mergeTrackerPayloadWithHistoricalFlights(mergedPayload);
  const persistedPayload = await persistTrackerPayloadToSharedFlights(mergedHistoricalPayload);

  const collection = await getCacheCollection();
  if (!collection) {
    return persistedPayload;
  }

  try {
    await collection.updateOne(
      { _id: cacheKey },
      {
        $set: {
          payload: persistedPayload,
          expiresAt,
          updatedAt: new Date(persistedPayload.fetchedAt),
        },
      },
      { upsert: true },
    );
  } catch (error) {
    logMongoWarning(error);
  }

  return persistedPayload;
}

export async function readAirportDirectoryCache(cacheKey: string): Promise<AirportDetails[] | null> {
  const collection = await getAirportDirectoryCacheCollection();
  if (!collection) {
    return null;
  }

  try {
    const cachedDocument = await collection.findOne({
      _id: cacheKey,
      expiresAt: { $gt: new Date() },
    });

    if (!cachedDocument) {
      return null;
    }

    return cachedDocument.payload;
  } catch (error) {
    logMongoWarning(error);
    return null;
  }
}

export async function writeAirportDirectoryCache(cacheKey: string, payload: AirportDetails[]): Promise<void> {
  const ttlMs = getAirportDirectoryCacheTtlSeconds() * 1000;
  const expiresAt = new Date(Date.now() + ttlMs);

  const collection = await getAirportDirectoryCacheCollection();
  if (!collection) {
    return;
  }

  try {
    await collection.updateOne(
      { _id: cacheKey },
      {
        $set: {
          payload,
          expiresAt,
          updatedAt: new Date(),
        },
      },
      { upsert: true },
    );
  } catch (error) {
    logMongoWarning(error);
  }
}

export async function readFlightDetailsCache(cacheKey: string): Promise<SelectedFlightDetails | null> {
  const collection = await getDetailsCacheCollection();
  if (!collection) {
    return null;
  }

  try {
    const cachedDocument = await collection.findOne({
      _id: cacheKey,
      expiresAt: { $gt: new Date() },
    });

    if (!cachedDocument) {
      return null;
    }

    const hydratedPayload = await hydrateSelectedFlightDetailsFromSharedFlight(cachedDocument.payload);
    return hydratedPayload;
  } catch (error) {
    logMongoWarning(error);
    return null;
  }
}

export async function writeFlightDetailsCache(
  cacheKey: string,
  payload: SelectedFlightDetails,
  trigger: FlightFetchTrigger = 'search',
): Promise<SelectedFlightDetails> {
  const ttlMs = getDetailsCacheTtlSeconds() * 1000;
  const expiresAt = new Date(Date.now() + ttlMs);
  const previousPayload = await readFlightDetailsCache(cacheKey);
  const mergedPayload = mergeSelectedFlightDetailsForSharedCache(previousPayload, payload, trigger);
  const persistedPayload = await persistSelectedFlightDetailsToSharedFlight(mergedPayload);

  const collection = await getDetailsCacheCollection();
  if (!collection) {
    return persistedPayload;
  }

  try {
    await collection.updateOne(
      { _id: cacheKey },
      {
        $set: {
          payload: persistedPayload,
          expiresAt,
          updatedAt: new Date(persistedPayload.fetchedAt),
        },
      },
      { upsert: true },
    );
  } catch (error) {
    logMongoWarning(error);
  }

  return persistedPayload;
}
