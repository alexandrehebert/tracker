import { NextRequest, NextResponse } from 'next/server';
import { findMatchingTrackedFlightForLeg, normalizeFriendFlightIdentifier, type FriendFlightLeg } from '~/lib/friendsTracker';
import { searchFlights } from '~/lib/server/opensky';
import { lookupAirlabsFlightWithReport } from '~/lib/server/providers/airlabs';
import { lookupAviationstackFlightWithReport } from '~/lib/server/providers/aviationstack';
import { lookupAeroDataBoxFlightWithReport } from '~/lib/server/providers/aerodatabox';
import { lookupFlightAwareFlightWithReport } from '~/lib/server/providers/flightaware';
import { getProviderLabel } from '~/lib/server/providers';
import { withProviderRequestContext } from '~/lib/server/providers/observability';
import type { FlightSourceDetail, TrackedFlight } from '~/components/tracker/flight/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const preferredRegion = 'fra1';
export const maxDuration = 30;

function normalizeAirportCode(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim().toUpperCase() : null;
}

function toTimestampMs(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value * 1000 : null;
}

function sanitizeIcao24(value: string | null | undefined): string | null {
  const normalized = normalizeFriendFlightIdentifier(value ?? null);
  return /^[0-9A-F]{6}$/.test(normalized) ? normalized : null;
}

function buildProviderLabel(sourceDetails: FlightSourceDetail[]): string {
  const usedSources = Array.from(new Set(sourceDetails.filter((detail) => detail.usedInResult).map((detail) => detail.source)));
  if (usedSources.length === 0) {
    return 'Tracker search';
  }

  return usedSources.map((source) => getProviderLabel(source)).join(' + ');
}

function createSkippedReport(source: FlightSourceDetail['source'], reason: string): FlightSourceDetail {
  return {
    source,
    status: 'skipped',
    usedInResult: false,
    reason,
  };
}

type ValidationCandidate = {
  providerLabel: string;
  matchedIcao24: string | null;
  matchedFlightNumber: string | null;
  matchedDepartureTime: number | null;
  matchedArrivalTime: number | null;
  matchedDepartureAirport: string | null;
  matchedArrivalAirport: string | null;
  message: string;
  sourceDetails: FlightSourceDetail[];
};

type ValidationProviderSelection = {
  tracker: boolean;
  flightaware: boolean;
  aviationstack: boolean;
  airlabs: boolean;
  aerodatabox: boolean;
};

function buildSelectedProviders(
  input: Partial<ValidationProviderSelection> | null | undefined,
  includeOnDemandProviders: boolean,
): ValidationProviderSelection {
  const hasExplicitSelection = Boolean(input && typeof input === 'object');

  return {
    tracker: hasExplicitSelection ? input?.tracker === true : true,
    flightaware: hasExplicitSelection ? input?.flightaware === true : true,
    aviationstack: hasExplicitSelection ? input?.aviationstack === true : true,
    airlabs: hasExplicitSelection ? input?.airlabs === true : true,
    aerodatabox: hasExplicitSelection ? input?.aerodatabox === true : includeOnDemandProviders,
  };
}

function scoreCandidate(
  candidate: ValidationCandidate,
  request: { departureTimeMs: number | null; from: string | null; to: string | null },
): number {
  let score = 100;

  if (request.from && candidate.matchedDepartureAirport) {
    score += request.from === candidate.matchedDepartureAirport ? 35 : -20;
  }

  if (request.to && candidate.matchedArrivalAirport) {
    score += request.to === candidate.matchedArrivalAirport ? 35 : -20;
  }

  if (request.departureTimeMs != null && candidate.matchedDepartureTime != null) {
    const deltaMinutes = Math.abs(candidate.matchedDepartureTime - request.departureTimeMs) / (1000 * 60);

    if (deltaMinutes <= 60) score += 45;
    else if (deltaMinutes <= 6 * 60) score += 30;
    else if (deltaMinutes <= 24 * 60) score += 15;
    else if (deltaMinutes <= 7 * 24 * 60) score += 5;
    else score -= 15;
  }

  if (candidate.matchedIcao24) {
    score += 8;
  }

  return score;
}

function buildCandidateFromLiveMatch(flight: TrackedFlight): ValidationCandidate {
  const sourceDetails = Array.isArray(flight.sourceDetails) ? flight.sourceDetails : [];

  return {
    providerLabel: buildProviderLabel(sourceDetails),
    matchedIcao24: sanitizeIcao24(flight.aircraft?.icao24 ?? flight.icao24),
    matchedFlightNumber: flight.flightNumber ?? flight.callsign ?? null,
    matchedDepartureTime: toTimestampMs(flight.route.firstSeen),
    matchedArrivalTime: toTimestampMs(flight.route.lastSeen),
    matchedDepartureAirport: normalizeAirportCode(flight.route.departureAirport),
    matchedArrivalAirport: normalizeAirportCode(flight.route.arrivalAirport),
    message: 'The tracker search found a matching live or recent flight for this identifier.',
    sourceDetails,
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as {
      identifier?: string | null;
      flightNumber?: string | null;
      departureTime?: string | null;
      from?: string | null;
      to?: string | null;
      legId?: string | null;
      includeOnDemandProviders?: boolean | null;
      providers?: Partial<ValidationProviderSelection> | null;
    };

    const identifier = normalizeFriendFlightIdentifier(body.identifier ?? body.flightNumber ?? null);
    if (!identifier) {
      return NextResponse.json({ error: 'Missing required flight identifier.' }, { status: 400 });
    }

    const departureTime = typeof body.departureTime === 'string' ? body.departureTime : '';
    const departureTimeMs = departureTime ? Date.parse(departureTime) : Number.NaN;
    const from = normalizeAirportCode(body.from);
    const to = normalizeAirportCode(body.to);
    const includeOnDemandProviders = body.includeOnDemandProviders === true;
    const selectedProviders = buildSelectedProviders(body.providers, includeOnDemandProviders);

    if (!Object.values(selectedProviders).some(Boolean)) {
      return NextResponse.json({ error: 'Select at least one provider before running validation.' }, { status: 400 });
    }

    const withConfigContext = <T,>(callback: () => Promise<T>) => withProviderRequestContext(
      {
        caller: 'config',
        source: 'chantal-validate-flight',
        metadata: {
          identifier,
          legId: typeof body.legId === 'string' ? body.legId : null,
          includeOnDemandProviders,
          providers: Object.entries(selectedProviders)
            .filter(([, enabled]) => enabled)
            .map(([provider]) => provider),
        },
      },
      callback,
    );

    const [flightAwareLookup, aviationstackLookup, airlabsLookup, aeroDataBoxLookup] = await withConfigContext(() => Promise.all([
      selectedProviders.flightaware
        ? lookupFlightAwareFlightWithReport(identifier, {
            referenceTimeMs: Number.isFinite(departureTimeMs) ? departureTimeMs : undefined,
          })
        : Promise.resolve({
            match: null,
            report: createSkippedReport('flightaware', 'FlightAware was not selected for this validation run.'),
          }),
      selectedProviders.aviationstack
        ? lookupAviationstackFlightWithReport(identifier, {
            referenceTimeMs: Number.isFinite(departureTimeMs) ? departureTimeMs : undefined,
          })
        : Promise.resolve({
            match: null,
            report: createSkippedReport('aviationstack', 'Aviationstack was not selected for this validation run.'),
          }),
      selectedProviders.airlabs
        ? lookupAirlabsFlightWithReport(identifier, {
            referenceTimeMs: Number.isFinite(departureTimeMs) ? departureTimeMs : undefined,
          })
        : Promise.resolve({
            match: null,
            report: createSkippedReport('airlabs', 'AirLabs was not selected for this validation run.'),
          }),
      selectedProviders.aerodatabox
        ? lookupAeroDataBoxFlightWithReport(identifier, {
            referenceTimeMs: Number.isFinite(departureTimeMs) ? departureTimeMs : undefined,
          })
        : Promise.resolve({
            match: null,
            report: createSkippedReport(
              'aerodatabox',
              'AeroDataBox was not selected for this validation run.',
            ),
          }),
    ]));

    const candidates: ValidationCandidate[] = [];

    if (flightAwareLookup.match) {
      candidates.push({
        providerLabel: 'FlightAware',
        matchedIcao24: sanitizeIcao24(flightAwareLookup.match.aircraft?.icao24),
        matchedFlightNumber: flightAwareLookup.match.flightNumber ?? flightAwareLookup.match.callsign ?? null,
        matchedDepartureTime: toTimestampMs(flightAwareLookup.match.route.firstSeen),
        matchedArrivalTime: toTimestampMs(flightAwareLookup.match.route.lastSeen),
        matchedDepartureAirport: normalizeAirportCode(flightAwareLookup.match.route.departureAirport),
        matchedArrivalAirport: normalizeAirportCode(flightAwareLookup.match.route.arrivalAirport),
        message: flightAwareLookup.report.reason,
        sourceDetails: [flightAwareLookup.report],
      });
    }

    if (aviationstackLookup.match) {
      candidates.push({
        providerLabel: 'Aviationstack',
        matchedIcao24: sanitizeIcao24(aviationstackLookup.match.aircraft?.icao24),
        matchedFlightNumber: aviationstackLookup.match.flightNumber ?? aviationstackLookup.match.callsign ?? null,
        matchedDepartureTime: toTimestampMs(aviationstackLookup.match.route.firstSeen),
        matchedArrivalTime: toTimestampMs(aviationstackLookup.match.route.lastSeen),
        matchedDepartureAirport: normalizeAirportCode(aviationstackLookup.match.route.departureAirport),
        matchedArrivalAirport: normalizeAirportCode(aviationstackLookup.match.route.arrivalAirport),
        message: aviationstackLookup.report.reason,
        sourceDetails: [aviationstackLookup.report],
      });
    }

    if (airlabsLookup.match) {
      candidates.push({
        providerLabel: 'AirLabs',
        matchedIcao24: sanitizeIcao24(airlabsLookup.match.aircraft?.icao24),
        matchedFlightNumber: airlabsLookup.match.flightNumber ?? airlabsLookup.match.callsign ?? null,
        matchedDepartureTime: toTimestampMs(airlabsLookup.match.route.firstSeen),
        matchedArrivalTime: toTimestampMs(airlabsLookup.match.route.lastSeen),
        matchedDepartureAirport: normalizeAirportCode(airlabsLookup.match.route.departureAirport),
        matchedArrivalAirport: normalizeAirportCode(airlabsLookup.match.route.arrivalAirport),
        message: airlabsLookup.report.reason,
        sourceDetails: [airlabsLookup.report],
      });
    }

    if (aeroDataBoxLookup.match) {
      candidates.push({
        providerLabel: 'AeroDataBox',
        matchedIcao24: sanitizeIcao24(aeroDataBoxLookup.match.aircraft?.icao24),
        matchedFlightNumber: aeroDataBoxLookup.match.flightNumber ?? aeroDataBoxLookup.match.callsign ?? null,
        matchedDepartureTime: toTimestampMs(aeroDataBoxLookup.match.route.firstSeen),
        matchedArrivalTime: toTimestampMs(aeroDataBoxLookup.match.route.lastSeen),
        matchedDepartureAirport: normalizeAirportCode(aeroDataBoxLookup.match.route.departureAirport),
        matchedArrivalAirport: normalizeAirportCode(aeroDataBoxLookup.match.route.arrivalAirport),
        message: aeroDataBoxLookup.report.reason,
        sourceDetails: [aeroDataBoxLookup.report],
      });
    }

    const requestedLeg: FriendFlightLeg = {
      id: typeof body.legId === 'string' ? body.legId : 'validation-leg',
      flightNumber: identifier,
      departureTime,
      departureTimezone: null,
      from,
      to,
      note: null,
      resolvedIcao24: null,
      lastResolvedAt: null,
    };

    if (selectedProviders.tracker) {
      try {
        const trackerPayload = await withConfigContext(() => searchFlights(identifier, { forceRefresh: true }));
        const liveMatch = findMatchingTrackedFlightForLeg(trackerPayload.flights ?? [], requestedLeg);
        if (liveMatch) {
          candidates.push(buildCandidateFromLiveMatch(liveMatch));
        }
      } catch {
        // Keep provider-only results when the tracker search is unavailable.
      }
    }

    const scoringContext = {
      departureTimeMs: Number.isFinite(departureTimeMs) ? departureTimeMs : null,
      from,
      to,
    };

    const rankedCandidates = [...candidates].sort((left, right) =>
      scoreCandidate(right, scoringContext) - scoreCandidate(left, scoringContext),
    );

    const candidatesPayload = rankedCandidates.map((candidate) => {
      const delta = candidate.matchedDepartureTime != null && Number.isFinite(departureTimeMs)
        ? Math.round((candidate.matchedDepartureTime - departureTimeMs) / (1000 * 60))
        : null;
      const route = candidate.matchedDepartureAirport || candidate.matchedArrivalAirport
        ? `${candidate.matchedDepartureAirport ?? '???'} → ${candidate.matchedArrivalAirport ?? '???'}`
        : null;
      const routeMismatch = (from && candidate.matchedDepartureAirport && from !== candidate.matchedDepartureAirport)
        || (to && candidate.matchedArrivalAirport && to !== candidate.matchedArrivalAirport);
      const timingWarning = delta != null && Math.abs(delta) > 180;

      return {
        status: routeMismatch || timingWarning ? 'warning' : 'matched',
        providerLabel: candidate.providerLabel,
        matchedIcao24: candidate.matchedIcao24,
        matchedFlightNumber: candidate.matchedFlightNumber,
        matchedDepartureTime: candidate.matchedDepartureTime,
        matchedArrivalTime: candidate.matchedArrivalTime,
        matchedDepartureAirport: candidate.matchedDepartureAirport,
        matchedArrivalAirport: candidate.matchedArrivalAirport,
        departureDeltaMinutes: delta,
        matchedRoute: route,
        message: candidate.message,
      };
    });

    if (rankedCandidates.length === 0) {
      const reports = [
        flightAwareLookup.report,
        aviationstackLookup.report,
        airlabsLookup.report,
        ...(includeOnDemandProviders ? [aeroDataBoxLookup.report] : []),
      ];
      const hasError = reports.some((report) => report.status === 'error');
      const hasSkipped = reports.every((report) => report.status === 'skipped');
      const message = reports
        .map((report) => `${getProviderLabel(report.source)}: ${report.reason}`)
        .join(' ');

      return NextResponse.json({
        status: hasError ? 'error' : hasSkipped ? 'skipped' : 'not-found',
        message: message || `No scheduled or live provider match was found for ${identifier}.`,
        providerLabel: null,
        matchedIcao24: null,
        matchedFlightNumber: null,
        matchedDepartureTime: null,
        matchedArrivalTime: null,
        matchedDepartureAirport: null,
        matchedArrivalAirport: null,
        departureDeltaMinutes: null,
        matchedRoute: null,
        lastCheckedAt: Date.now(),
        candidates: [],
      });
    }

    const bestCandidate = rankedCandidates[0]!;

    const departureDeltaMinutes = bestCandidate.matchedDepartureTime != null && Number.isFinite(departureTimeMs)
      ? Math.round((bestCandidate.matchedDepartureTime - departureTimeMs) / (1000 * 60))
      : null;

    const routeMismatch = (from && bestCandidate.matchedDepartureAirport && from !== bestCandidate.matchedDepartureAirport)
      || (to && bestCandidate.matchedArrivalAirport && to !== bestCandidate.matchedArrivalAirport);
    const timingWarning = departureDeltaMinutes != null && Math.abs(departureDeltaMinutes) > 180;
    const status = routeMismatch || timingWarning ? 'warning' : 'matched';
    const matchedRoute = bestCandidate.matchedDepartureAirport || bestCandidate.matchedArrivalAirport
      ? `${bestCandidate.matchedDepartureAirport ?? '???'} → ${bestCandidate.matchedArrivalAirport ?? '???'}`
      : null;

    const comparisonText = departureDeltaMinutes == null
      ? 'Provider schedule data was found for this flight.'
      : departureDeltaMinutes === 0
        ? 'Departure time matches the configured schedule.'
        : `Departure is ${departureDeltaMinutes > 0 ? '+' : ''}${departureDeltaMinutes} min vs the configured schedule.`;

    const icaoText = bestCandidate.matchedIcao24
      ? ` ICAO24 ${bestCandidate.matchedIcao24} is available.`
      : ' ICAO24 is not published yet for this scheduled leg.';

    return NextResponse.json({
      status,
      message: `${bestCandidate.providerLabel} matched ${bestCandidate.matchedFlightNumber ?? identifier}. ${comparisonText}${icaoText}`,
      providerLabel: bestCandidate.providerLabel,
      matchedIcao24: bestCandidate.matchedIcao24,
      matchedFlightNumber: bestCandidate.matchedFlightNumber,
      matchedDepartureTime: bestCandidate.matchedDepartureTime,
      matchedArrivalTime: bestCandidate.matchedArrivalTime,
      matchedDepartureAirport: bestCandidate.matchedDepartureAirport,
      matchedArrivalAirport: bestCandidate.matchedArrivalAirport,
      departureDeltaMinutes,
      matchedRoute,
      lastCheckedAt: Date.now(),
      candidates: candidatesPayload,
    });
  } catch (error) {
    return NextResponse.json({
      status: 'error',
      message: error instanceof Error ? error.message : 'Unable to validate this flight right now.',
      providerLabel: null,
      matchedIcao24: null,
      matchedFlightNumber: null,
      matchedDepartureTime: null,
      matchedArrivalTime: null,
      matchedDepartureAirport: null,
      matchedArrivalAirport: null,
      departureDeltaMinutes: null,
      matchedRoute: null,
      lastCheckedAt: Date.now(),
    }, { status: 500 });
  }
}
