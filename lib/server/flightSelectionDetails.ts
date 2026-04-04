import type {
  AirportDetails,
  FlightFetchTrigger,
  FlightMapPoint,
  FlightSourceDetail,
  SelectedFlightDetails,
  TrackedFlightRoute,
} from '~/components/tracker/flight/types';
import type { AviationstackFlightEnrichment } from './aviationstack';
import type { FlightAwareFlightEnrichment } from './flightaware';

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

type LookupResult<TMatch> = Promise<{
  match: TMatch | null;
  report: FlightSourceDetail;
}>;

type FlightSelectionDetailsDependencies = {
  normalizeIdentifier: (value: string) => string;
  normalizeUnixSeconds: (value: number | null | undefined) => number | null;
  createEmptyRoute: () => TrackedFlightRoute;
  sanitizeRouteTimes: (route: TrackedFlightRoute, referenceTime?: number | null) => TrackedFlightRoute;
  isSyntheticAircraftIdentifier: (value: string) => boolean;
  getRecentRoute: (icao24: string, referenceTime: number) => Promise<TrackedFlightRoute>;
  getTrackForAircraft: (icao24: string, referenceTime: number) => Promise<{
    track: FlightMapPoint[];
    rawTrack: FlightMapPoint[];
  }>;
  guessDepartureAirportFromOriginPoint: (originPoint: FlightMapPoint | null) => Promise<AirportDetails | null>;
  getAirportLookupCode: (airport: AirportDetails | null) => string | null;
  lookupAirportDetails: (code: string | null | undefined) => Promise<AirportDetails | null>;
  mergeAirportDetails: (
    airport: AirportDetails | null,
    fallbackCode: string | null,
    fallbackName: string | null,
  ) => AirportDetails | null;
  createSourceDetail: (
    source: FlightSourceDetail['source'],
    status: FlightSourceDetail['status'],
    usedInResult: boolean,
    reason: string,
    raw?: Record<string, unknown> | null,
  ) => FlightSourceDetail;
  mergeSourceDetails: (
    existing: FlightSourceDetail[] | undefined,
    incoming: FlightSourceDetail[] | undefined,
  ) => FlightSourceDetail[] | undefined;
  lookupFlightAwareFlightWithReport: (identifier: string) => LookupResult<FlightAwareFlightEnrichment>;
  lookupAviationstackFlightWithReport: (identifier: string) => LookupResult<AviationstackFlightEnrichment>;
  readFlightDetailsCache: (cacheKey: string) => Promise<SelectedFlightDetails | null>;
  writeFlightDetailsCache: (
    cacheKey: string,
    payload: SelectedFlightDetails,
    trigger?: FlightFetchTrigger,
  ) => Promise<SelectedFlightDetails>;
};

const inFlightSelectionDetails = new Map<string, Promise<SelectedFlightDetails>>();

export async function getFlightSelectionDetails(
  params: FlightSelectionDetailsParams,
  options: FlightSelectionDetailsOptions = {},
  deps: FlightSelectionDetailsDependencies,
): Promise<SelectedFlightDetails> {
  const normalizedIcao24 = deps.normalizeIdentifier(params.icao24).toLowerCase();
  if (!normalizedIcao24) {
    throw new Error('Missing aircraft identifier.');
  }

  const referenceTime = deps.normalizeUnixSeconds(params.referenceTime)
    ?? deps.normalizeUnixSeconds(params.lastSeen)
    ?? Math.floor(Date.now() / 1000);

  const cacheKey = [
    deps.normalizeIdentifier(normalizedIcao24),
    deps.normalizeIdentifier(params.departureAirport ?? ''),
    deps.normalizeIdentifier(params.arrivalAirport ?? ''),
    String(referenceTime),
    String(deps.normalizeUnixSeconds(params.lastSeen) ?? 0),
  ].join(':');

  const inFlightKey = options.forceRefresh ? `${cacheKey}:force` : cacheKey;
  const cachedResult = options.forceRefresh ? null : await deps.readFlightDetailsCache(cacheKey);
  if (cachedResult) {
    return cachedResult;
  }

  const existingLookup = inFlightSelectionDetails.get(inFlightKey);
  if (existingLookup) {
    return existingLookup;
  }

  const pendingLookup = (async () => {
    const fallbackRoute = deps.createEmptyRoute();
    fallbackRoute.departureAirport = params.departureAirport ?? null;
    fallbackRoute.arrivalAirport = params.arrivalAirport ?? null;

    const shouldUseOpenSky = !deps.isSyntheticAircraftIdentifier(normalizedIcao24);
    let openSkyRouteError: string | null = null;
    let openSkyTrackError: string | null = null;

    const [latestRoute, flightAwareLookup, aviationstackLookup] = await Promise.all([
      shouldUseOpenSky
        ? deps.getRecentRoute(normalizedIcao24, referenceTime).catch((error) => {
            openSkyRouteError = error instanceof Error ? error.message : 'OpenSky route lookup failed.';
            return fallbackRoute;
          })
        : Promise.resolve(fallbackRoute),
      params.callsign
        ? deps.lookupFlightAwareFlightWithReport(params.callsign)
        : Promise.resolve({
            match: null,
            report: deps.createSourceDetail(
              'flightaware',
              'skipped',
              false,
              'FlightAware lookup skipped because no callsign was available for this flight.',
            ),
          }),
      params.callsign
        ? deps.lookupAviationstackFlightWithReport(params.callsign)
        : Promise.resolve({
            match: null,
            report: deps.createSourceDetail(
              'aviationstack',
              'skipped',
              false,
              'Aviationstack lookup skipped because no callsign was available for this flight.',
            ),
          }),
    ]);

    const flightAwareMatch = flightAwareLookup.match;
    const aviationstackMatch = aviationstackLookup.match;

    const route = deps.sanitizeRouteTimes({
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
      const originPoint = await deps.getTrackForAircraft(normalizedIcao24, referenceTime)
        .then((history) => history.track[0] ?? null)
        .catch((error) => {
          openSkyTrackError = error instanceof Error ? error.message : 'OpenSky track lookup failed.';
          return null;
        });

      guessedDepartureAirport = await deps.guessDepartureAirportFromOriginPoint(originPoint);
      route.departureAirport = deps.getAirportLookupCode(guessedDepartureAirport);
    }

    const [resolvedDepartureAirport, resolvedArrivalAirport] = await Promise.all([
      guessedDepartureAirport ? Promise.resolve(guessedDepartureAirport) : deps.lookupAirportDetails(route.departureAirport),
      deps.lookupAirportDetails(route.arrivalAirport),
    ]);

    const departureAirport = deps.mergeAirportDetails(
      resolvedDepartureAirport,
      route.departureAirport,
      flightAwareMatch?.route.departureAirportName ?? aviationstackMatch?.route.departureAirportName ?? null,
    );
    const arrivalAirport = deps.mergeAirportDetails(
      resolvedArrivalAirport,
      route.arrivalAirport,
      flightAwareMatch?.route.arrivalAirportName ?? aviationstackMatch?.route.arrivalAirportName ?? null,
    );

    const openSkySourceDetail = (() => {
      if (!shouldUseOpenSky) {
        return deps.createSourceDetail(
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
        return deps.createSourceDetail(
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
        return deps.createSourceDetail(
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

      return deps.createSourceDetail(
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
      sourceDetails: deps.mergeSourceDetails(undefined, [openSkySourceDetail, flightAwareLookup.report, aviationstackLookup.report]),
    };

    return deps.writeFlightDetailsCache(
      cacheKey,
      payload,
      options.forceRefresh ? 'manual-refresh' : 'search',
    );
  })().finally(() => {
    inFlightSelectionDetails.delete(inFlightKey);
  });

  inFlightSelectionDetails.set(inFlightKey, pendingLookup);
  return pendingLookup;
}
