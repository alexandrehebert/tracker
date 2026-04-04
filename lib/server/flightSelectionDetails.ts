import type {
  AirportDetails,
  FlightFetchTrigger,
  FlightMapPoint,
  FlightSourceDetail,
  SelectedFlightDetails,
  TrackedFlightRoute,
} from '~/components/tracker/flight/types';
import { lookupAirportDetails } from './airports';
import { readFlightDetailsCache, writeFlightDetailsCache } from './flightCache';
import { lookupAviationstackFlightWithReport } from './providers/aviationstack';
import { lookupFlightAwareFlightWithReport } from './providers/flightaware';
import { guessDepartureAirportFromOriginPoint, getRecentRoute, getTrackForAircraft } from './providers/opensky';

export type FlightSelectionDetailsParams = {
  icao24: string;
  callsign?: string | null;
  departureAirport?: string | null;
  arrivalAirport?: string | null;
  referenceTime?: number | null;
  lastSeen?: number | null;
};

export type FlightSelectionDetailsOptions = {
  forceRefresh?: boolean;
};

function normalizeIdentifier(value: string): string {
  return value.replace(/\s+/g, '').trim().toUpperCase();
}

function normalizeUnixSeconds(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : null;
}

function isSyntheticAircraftIdentifier(value: string): boolean {
  return value.startsWith('as-') || value.startsWith('fa-');
}

function createEmptyRoute(): TrackedFlightRoute {
  return {
    departureAirport: null,
    arrivalAirport: null,
    firstSeen: null,
    lastSeen: null,
  };
}

const ROUTE_TIME_RECONCILIATION_GRACE_SECONDS = 15 * 60;

function sanitizeRouteTimes(route: TrackedFlightRoute, referenceTime?: number | null): TrackedFlightRoute {
  const normalizedReferenceTime = normalizeUnixSeconds(referenceTime);
  const isTooFarInFuture = (timestamp: number | null) => normalizedReferenceTime != null
    && timestamp != null
    && timestamp > normalizedReferenceTime + ROUTE_TIME_RECONCILIATION_GRACE_SECONDS;

  let firstSeen = normalizeUnixSeconds(route.firstSeen);
  let lastSeen = normalizeUnixSeconds(route.lastSeen);

  if (isTooFarInFuture(firstSeen)) {
    firstSeen = null;
  }

  if (isTooFarInFuture(lastSeen)) {
    lastSeen = null;
  }

  if (firstSeen != null && lastSeen != null && firstSeen > lastSeen) {
    firstSeen = null;
  }

  return { ...route, firstSeen, lastSeen };
}

function getAirportLookupCode(airport: AirportDetails | null): string | null {
  return airport?.icao ?? airport?.code ?? null;
}

function mergeAirportDetails(
  airport: AirportDetails | null,
  fallbackCode: string | null,
  fallbackName: string | null,
): AirportDetails | null {
  if (airport) {
    return !airport.name && fallbackName ? { ...airport, name: fallbackName } : airport;
  }

  if (!fallbackCode && !fallbackName) {
    return null;
  }

  return {
    code: fallbackCode ?? fallbackName ?? 'UNKNOWN',
    iata: fallbackCode && fallbackCode.length === 3 ? fallbackCode : null,
    icao: fallbackCode && fallbackCode.length === 4 ? fallbackCode : null,
    name: fallbackName,
    city: null,
    country: null,
    latitude: null,
    longitude: null,
    timezone: null,
  };
}

function createSourceDetail(
  source: FlightSourceDetail['source'],
  status: FlightSourceDetail['status'],
  usedInResult: boolean,
  reason: string,
  raw: Record<string, unknown> | null = null,
): FlightSourceDetail {
  return { source, status, usedInResult, reason, raw };
}

function mergeSourceDetails(
  existing: FlightSourceDetail[] | undefined,
  incoming: FlightSourceDetail[] | undefined,
): FlightSourceDetail[] | undefined {
  const nextEntries = [...(existing ?? [])];

  for (const detail of incoming ?? []) {
    const index = nextEntries.findIndex((entry) => entry.source === detail.source);
    if (index < 0) {
      nextEntries.push(detail);
      continue;
    }

    const current = nextEntries[index]!;
    const priority = { used: 4, error: 3, 'no-data': 2, skipped: 1 } as const;
    const shouldUseIncomingStatus = priority[detail.status] >= priority[current.status];

    nextEntries[index] = {
      ...current,
      ...detail,
      status: shouldUseIncomingStatus ? detail.status : current.status,
      usedInResult: current.usedInResult || detail.usedInResult,
      reason: detail.reason || current.reason,
      raw: detail.raw ?? current.raw ?? null,
    };
  }

  return nextEntries.length > 0 ? nextEntries : undefined;
}

const inFlightSelectionDetails = new Map<string, Promise<SelectedFlightDetails>>();

export async function getFlightSelectionDetails(
  params: FlightSelectionDetailsParams,
  options: FlightSelectionDetailsOptions = {},
): Promise<SelectedFlightDetails> {
  const normalizedIcao24 = normalizeIdentifier(params.icao24).toLowerCase();
  if (!normalizedIcao24) {
    throw new Error('Missing aircraft identifier.');
  }

  const referenceTime = normalizeUnixSeconds(params.referenceTime)
    ?? normalizeUnixSeconds(params.lastSeen)
    ?? Math.floor(Date.now() / 1000);

  const cacheKey = [
    normalizeIdentifier(normalizedIcao24),
    normalizeIdentifier(params.departureAirport ?? ''),
    normalizeIdentifier(params.arrivalAirport ?? ''),
    String(referenceTime),
    String(normalizeUnixSeconds(params.lastSeen) ?? 0),
  ].join(':');

  const inFlightKey = options.forceRefresh ? `${cacheKey}:force` : cacheKey;
  const cachedResult = options.forceRefresh ? null : await readFlightDetailsCache(cacheKey);
  if (cachedResult) {
    return cachedResult;
  }

  const existingLookup = inFlightSelectionDetails.get(inFlightKey);
  if (existingLookup) {
    return existingLookup;
  }

  const pendingLookup = (async () => {
    const fallbackRoute = createEmptyRoute();
    fallbackRoute.departureAirport = params.departureAirport ?? null;
    fallbackRoute.arrivalAirport = params.arrivalAirport ?? null;

    const shouldUseOpenSky = !isSyntheticAircraftIdentifier(normalizedIcao24);
    let openSkyRouteError: string | null = null;
    let openSkyTrackError: string | null = null;

    const [latestRoute, flightAwareLookup, aviationstackLookup] = await Promise.all([
      shouldUseOpenSky
        ? getRecentRoute(normalizedIcao24, referenceTime).catch((error) => {
            openSkyRouteError = error instanceof Error ? error.message : 'OpenSky route lookup failed.';
            return fallbackRoute;
          })
        : Promise.resolve(fallbackRoute),
      params.callsign
        ? lookupFlightAwareFlightWithReport(params.callsign)
        : Promise.resolve({
            match: null,
            report: createSourceDetail(
              'flightaware',
              'skipped',
              false,
              'FlightAware lookup skipped because no callsign was available for this flight.',
            ),
          }),
      params.callsign
        ? lookupAviationstackFlightWithReport(params.callsign)
        : Promise.resolve({
            match: null,
            report: createSourceDetail(
              'aviationstack',
              'skipped',
              false,
              'Aviationstack lookup skipped because no callsign was available for this flight.',
            ),
          }),
    ]);

    const flightAwareMatch = flightAwareLookup.match;
    const aviationstackMatch = aviationstackLookup.match;

    const route = sanitizeRouteTimes({
      departureAirport: latestRoute.departureAirport
        ?? flightAwareMatch?.route.departureAirport
        ?? aviationstackMatch?.route.departureAirport
        ?? fallbackRoute.departureAirport,
      arrivalAirport: latestRoute.arrivalAirport
        ?? flightAwareMatch?.route.arrivalAirport
        ?? aviationstackMatch?.route.arrivalAirport
        ?? fallbackRoute.arrivalAirport,
      firstSeen: latestRoute.firstSeen
        ?? flightAwareMatch?.route.firstSeen
        ?? aviationstackMatch?.route.firstSeen
        ?? fallbackRoute.firstSeen,
      lastSeen: latestRoute.lastSeen
        ?? flightAwareMatch?.route.lastSeen
        ?? aviationstackMatch?.route.lastSeen
        ?? fallbackRoute.lastSeen,
    }, referenceTime);

    let guessedDepartureAirport: AirportDetails | null = null;
    if (!route.departureAirport && shouldUseOpenSky) {
      const originPoint = await getTrackForAircraft(normalizedIcao24, referenceTime)
        .then((history) => history.track[0] ?? null)
        .catch((error) => {
          openSkyTrackError = error instanceof Error ? error.message : 'OpenSky track lookup failed.';
          return null;
        });

      guessedDepartureAirport = await guessDepartureAirportFromOriginPoint(originPoint);
      route.departureAirport = getAirportLookupCode(guessedDepartureAirport);
    }

    const [resolvedDepartureAirport, resolvedArrivalAirport] = await Promise.all([
      guessedDepartureAirport ? Promise.resolve(guessedDepartureAirport) : lookupAirportDetails(route.departureAirport),
      lookupAirportDetails(route.arrivalAirport),
    ]);

    const departureAirport = mergeAirportDetails(
      resolvedDepartureAirport,
      route.departureAirport,
      flightAwareMatch?.route.departureAirportName ?? aviationstackMatch?.route.departureAirportName ?? null,
    );
    const arrivalAirport = mergeAirportDetails(
      resolvedArrivalAirport,
      route.arrivalAirport,
      flightAwareMatch?.route.arrivalAirportName ?? aviationstackMatch?.route.arrivalAirportName ?? null,
    );

    const openSkySourceDetail = (() => {
      if (!shouldUseOpenSky) {
        return createSourceDetail(
          'opensky',
          'skipped',
          false,
          'OpenSky lookup was skipped because this flight currently uses a synthetic fallback identifier from an enrichment provider.',
          { icao24: normalizedIcao24 },
        );
      }

      const hasOpenSkyRouteData = Boolean(latestRoute.departureAirport || latestRoute.arrivalAirport || latestRoute.firstSeen || latestRoute.lastSeen);
      const hasDerivedAirport = Boolean(guessedDepartureAirport);

      if ((openSkyRouteError || openSkyTrackError) && !hasOpenSkyRouteData && !hasDerivedAirport) {
        return createSourceDetail(
          'opensky',
          'error',
          false,
          openSkyRouteError ?? openSkyTrackError ?? 'OpenSky did not return route details for this aircraft.',
          {
            icao24: normalizedIcao24,
            routeLookupError: openSkyRouteError,
            trackLookupError: openSkyTrackError,
          },
        );
      }

      if (!hasOpenSkyRouteData && !hasDerivedAirport) {
        return createSourceDetail(
          'opensky',
          'no-data',
          false,
          'OpenSky was queried for route history, but it returned no airport details for this time window.',
          {
            icao24: normalizedIcao24,
            referenceTime,
            route: latestRoute,
          },
        );
      }

      return createSourceDetail(
        'opensky',
        'used',
        true,
        hasDerivedAirport && !latestRoute.departureAirport
          ? 'OpenSky track history was used and the departure airport was inferred from the origin point.'
          : 'OpenSky route history was used to populate the selected-flight details.',
        {
          icao24: normalizedIcao24,
          referenceTime,
          route: latestRoute,
          guessedDepartureAirport,
        },
      );
    })();

    const payload: SelectedFlightDetails = {
      icao24: normalizedIcao24,
      callsign: params.callsign?.trim() || flightAwareMatch?.callsign || aviationstackMatch?.callsign || normalizedIcao24.toUpperCase(),
      fetchedAt: Date.now(),
      route,
      departureAirport,
      arrivalAirport,
      flightNumber: flightAwareMatch?.flightNumber ?? aviationstackMatch?.flightNumber ?? null,
      airline: flightAwareMatch?.airline ?? aviationstackMatch?.airline ?? null,
      aircraft: flightAwareMatch?.aircraft ?? aviationstackMatch?.aircraft ?? null,
      dataSource: shouldUseOpenSky
        ? (flightAwareMatch || aviationstackMatch ? 'hybrid' : 'opensky')
        : (flightAwareMatch && aviationstackMatch
            ? 'hybrid'
            : flightAwareMatch
              ? 'flightaware'
              : aviationstackMatch
                ? 'aviationstack'
                : (normalizedIcao24.startsWith('fa-') ? 'flightaware' : 'aviationstack')),
      sourceDetails: mergeSourceDetails(undefined, [openSkySourceDetail, flightAwareLookup.report, aviationstackLookup.report]),
    };

    const trigger: FlightFetchTrigger = options.forceRefresh ? 'manual-refresh' : 'search';
    return writeFlightDetailsCache(cacheKey, payload, trigger);
  })().finally(() => {
    inFlightSelectionDetails.delete(inFlightKey);
  });

  inFlightSelectionDetails.set(inFlightKey, pendingLookup);
  return pendingLookup;
}
