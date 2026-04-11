'use client';

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode, type RefObject } from 'react';
import { useLocale } from 'next-intl';
import type { AirportDirectoryResponse } from '~/components/tracker/flight/types';
import {
  extractFriendTrackerIdentifiers,
  getCurrentTripConfig,
  normalizeConfiguredFlightNumber,
  normalizeFriendFlightIdentifier,
  normalizeFriendsTrackerConfig,
  resolveSuggestedFlightNumber,
  normalizeFriendsTrackerTripConfig,
  type FriendFlightLeg,
  type FriendFlightValidationProviderSnapshot,
  type FriendTravelConfig,
  type FriendsTrackerConfig,
  type FriendsTrackerTripConfig,
} from '~/lib/friendsTracker';
import { getAirportSuggestionCode, normalizeAirportCode } from '~/lib/utils/airportUtils';
import { buildSaveableConfigSnapshot, createClientId, createDraftTrip, moveArrayItem } from '~/lib/utils/friendsConfigUtils';
import type { TrackerCronDashboard } from '~/lib/server/trackerCron';
import type { ProviderName } from '~/lib/server/providers';

export interface FriendsConfigValidationIssue {
  id: string;
  friendId: string;
  friendName: string;
  legId: string;
  legIndex: number;
  code: 'invalid-date' | 'flight-order';
  message: string;
}

export interface FlightProviderValidationResult {
  legId: string;
  friendId: string;
  status: 'idle' | 'loading' | 'matched' | 'warning' | 'not-found' | 'error' | 'skipped';
  message: string;
  providerLabel: string | null;
  matchedIcao24: string | null;
  matchedFlightNumber: string | null;
  matchedDepartureTime: number | null;
  matchedArrivalTime: number | null;
  matchedDepartureAirport: string | null;
  matchedArrivalAirport: string | null;
  departureDeltaMinutes: number | null;
  matchedRoute: string | null;
  lastCheckedAt: number | null;
}

export interface FlightValidationModalCandidate {
  status: 'matched' | 'warning';
  providerLabel: string;
  matchedIcao24: string | null;
  matchedFlightNumber: string | null;
  matchedDepartureTime: number | null;
  matchedArrivalTime: number | null;
  matchedDepartureAirport: string | null;
  matchedArrivalAirport: string | null;
  departureDeltaMinutes: number | null;
  matchedRoute: string | null;
  message: string;
}

export type FlightValidationProviderId = 'tracker' | 'flightaware' | 'aviationstack' | 'airlabs' | 'aerodatabox';

export type FlightValidationProviderSelection = Record<FlightValidationProviderId, boolean>;

export interface FlightValidationModalState {
  friendId: string;
  legId: string;
  identifier: string;
  status: 'setup' | 'loading' | 'loaded' | 'error';
  selectedProviders: FlightValidationProviderSelection;
  candidates: FlightValidationModalCandidate[];
  message: string;
}

type AppliedValidationMatch = {
  status: 'matched' | 'warning';
  message: string;
  providerLabel: string | null;
  matchedIcao24: string | null;
  matchedFlightNumber: string | null;
  matchedDepartureTime: number | null;
  matchedArrivalTime: number | null;
  matchedDepartureAirport: string | null;
  matchedArrivalAirport: string | null;
  departureDeltaMinutes: number | null;
  matchedRoute: string | null;
  lastCheckedAt: number | null;
};

function getCronDashboardChantalIdentifiers(dashboard: TrackerCronDashboard): string[] {
  return Array.isArray(dashboard.config.chantalIdentifiers) ? dashboard.config.chantalIdentifiers : [];
}

function getCronDashboardManualIdentifiers(dashboard: TrackerCronDashboard): string[] {
  const chantalIdentifiers = new Set(getCronDashboardChantalIdentifiers(dashboard));
  const sourceIdentifiers = Array.isArray(dashboard.config.manualIdentifiers)
    ? dashboard.config.manualIdentifiers
    : dashboard.config.identifiers;

  return sourceIdentifiers.filter((identifier) => !chantalIdentifiers.has(identifier));
}

function normalizeFriendMergeKey(friend: FriendTravelConfig): string {
  return friend.name.trim().toLowerCase();
}

function buildFlightLegMergeKey(leg: FriendTravelConfig['flights'][number]): string {
  const flightNumber = normalizeFriendFlightIdentifier(leg.flightNumber);
  const departureTime = typeof leg.departureTime === 'string' ? leg.departureTime.trim() : '';
  const from = normalizeAirportCode(leg.from);
  const to = normalizeAirportCode(leg.to);

  return [flightNumber, departureTime, from, to].join('|');
}

function reconcileImportedTripWithCurrentTrip(
  currentTrip: FriendsTrackerTripConfig,
  importedTrip: FriendsTrackerTripConfig,
): FriendsTrackerTripConfig {
  const usedFriendIds = new Set<string>();

  const nextFriends = importedTrip.friends.map((importedFriend) => {
    const friendMatchedById = currentTrip.friends.find((friend) => friend.id === importedFriend.id);
    const importedFriendKey = normalizeFriendMergeKey(importedFriend);
    const friendMatchedByName = importedFriendKey
      ? currentTrip.friends.find((friend) => !usedFriendIds.has(friend.id) && normalizeFriendMergeKey(friend) === importedFriendKey)
      : undefined;
    const matchingFriend = friendMatchedById ?? friendMatchedByName;

    if (matchingFriend) {
      usedFriendIds.add(matchingFriend.id);
    }

    const usedFlightIds = new Set<string>();
    const matchingFlights = matchingFriend?.flights ?? [];
    const nextFlights = importedFriend.flights.map((importedLeg) => {
      const legMatchedById = matchingFlights.find((leg) => leg.id === importedLeg.id);
      const importedLegKey = buildFlightLegMergeKey(importedLeg);
      const legMatchedByFlightData = importedLegKey
        ? matchingFlights.find((leg) => !usedFlightIds.has(leg.id) && buildFlightLegMergeKey(leg) === importedLegKey)
        : undefined;
      const matchingLeg = legMatchedById ?? legMatchedByFlightData;

      if (matchingLeg) {
        usedFlightIds.add(matchingLeg.id);
        return {
          ...importedLeg,
          id: matchingLeg.id,
        };
      }

      return importedLeg;
    });

    return {
      ...importedFriend,
      id: matchingFriend?.id ?? importedFriend.id,
      flights: nextFlights,
    };
  });

  return {
    ...currentTrip,
    ...importedTrip,
    id: currentTrip.id,
    friends: nextFriends,
  };
}

function resolveImportedTripForMerge(
  parsedValue: Partial<FriendsTrackerConfig> | FriendTravelConfig[],
  importedConfig: FriendsTrackerConfig,
): FriendsTrackerTripConfig | null {
  if (!Array.isArray(parsedValue) && Array.isArray(parsedValue.friends)) {
    const importedTrip = normalizeFriendsTrackerTripConfig({
      id: createClientId('trip'),
      name: 'Imported trip',
      destinationAirport: parsedValue.destinationAirport ?? null,
      friends: parsedValue.friends,
      isDemo: false,
    });

    return {
      ...importedTrip,
      id: importedTrip.id || createClientId('trip'),
    };
  }

  const importedTrips = (importedConfig.trips ?? []).filter((trip) => !trip.isDemo);
  if (importedTrips.length === 0) {
    return null;
  }

  const requestedImportedTripId = !Array.isArray(parsedValue) && typeof parsedValue.currentTripId === 'string' && parsedValue.currentTripId.trim()
    ? parsedValue.currentTripId.trim()
    : null;

  return importedTrips.find((trip) => trip.id === requestedImportedTripId)
    ?? importedTrips[0]
    ?? null;
}

function removeDemoTrips(trips: FriendsTrackerTripConfig[]): FriendsTrackerTripConfig[] {
  return trips.filter((trip) => !trip.isDemo);
}

const LIVE_VALIDATION_WARNING_MINUTES = 180;
const DEFAULT_ENABLED_VALIDATION_PROVIDERS: ProviderName[] = ['opensky', 'flightaware', 'aviationstack', 'airlabs', 'aerodatabox'];

function buildAvailableValidationProviderSelection(
  enabledProviders: readonly ProviderName[] | null | undefined,
): FlightValidationProviderSelection {
  const enabledSet = new Set((enabledProviders?.length ? enabledProviders : DEFAULT_ENABLED_VALIDATION_PROVIDERS));

  return {
    tracker: enabledSet.has('opensky'),
    flightaware: enabledSet.has('flightaware'),
    aviationstack: enabledSet.has('aviationstack'),
    airlabs: enabledSet.has('airlabs'),
    aerodatabox: enabledSet.has('aerodatabox'),
  };
}

function createDefaultValidationProviderSelection(
  availableProviders: FlightValidationProviderSelection,
): FlightValidationProviderSelection {
  return {
    tracker: availableProviders.tracker,
    flightaware: availableProviders.flightaware,
    aviationstack: availableProviders.aviationstack,
    airlabs: availableProviders.airlabs,
    aerodatabox: availableProviders.aerodatabox,
  };
}

function countSelectedValidationProviders(selection: FlightValidationProviderSelection): number {
  return Object.values(selection).filter(Boolean).length;
}

function getFlightLegRefreshIdentifiers(leg: Pick<FriendFlightLeg, 'flightNumber' | 'resolvedIcao24'>): string[] {
  const normalizedFlightNumber = normalizeConfiguredFlightNumber(leg.flightNumber);
  const normalizedIcao24 = normalizeFriendFlightIdentifier(leg.resolvedIcao24);

  return Array.from(new Set([
    normalizedFlightNumber,
    /^[0-9A-F]{6}$/.test(normalizedIcao24) ? normalizedIcao24 : '',
  ].filter(Boolean)));
}

function toValidationTimestamp(value: string | null | undefined): number | null {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildPersistedFlightValidationResults(
  trips: FriendsTrackerTripConfig[],
): Record<string, FlightProviderValidationResult> {
  const persistedResults: Record<string, FlightProviderValidationResult> = {};

  for (const trip of trips) {
    for (const friend of trip.friends) {
      for (const leg of friend.flights) {
        const snapshot = leg.validatedFlight;
        if (!snapshot?.status) {
          continue;
        }

        const matchedDepartureAirport = snapshot.matchedDepartureAirport ?? normalizeAirportCode(leg.from);
        const matchedArrivalAirport = snapshot.matchedArrivalAirport ?? normalizeAirportCode(leg.to);

        persistedResults[leg.id] = {
          legId: leg.id,
          friendId: friend.id,
          status: snapshot.status,
          message: snapshot.message ?? `${snapshot.providerLabel ?? 'Saved validation'} was previously applied to this leg.`,
          providerLabel: snapshot.providerLabel ?? null,
          matchedIcao24: snapshot.matchedIcao24 ?? leg.resolvedIcao24 ?? null,
          matchedFlightNumber: snapshot.matchedFlightNumber ?? leg.flightNumber ?? null,
          matchedDepartureTime: toValidationTimestamp(snapshot.matchedDepartureTime ?? leg.departureTime),
          matchedArrivalTime: toValidationTimestamp(snapshot.matchedArrivalTime ?? leg.arrivalTime ?? null),
          matchedDepartureAirport,
          matchedArrivalAirport,
          departureDeltaMinutes: snapshot.departureDeltaMinutes ?? null,
          matchedRoute: snapshot.matchedRoute
            ?? (matchedDepartureAirport || matchedArrivalAirport
              ? `${matchedDepartureAirport ?? '???'} → ${matchedArrivalAirport ?? '???'}`
              : null),
          lastCheckedAt: snapshot.lastCheckedAt ?? leg.lastResolvedAt ?? null,
        };
      }
    }
  }

  return persistedResults;
}

function hasLegContent(leg: FriendTravelConfig['flights'][number]): boolean {
  const values = [leg.flightNumber, leg.departureTime, leg.arrivalTime, leg.from, leg.to, leg.note, leg.resolvedIcao24];
  return values.some((value) => typeof value === 'string' && value.trim().length > 0);
}

function getFriendDisplayName(friend: FriendTravelConfig, index: number): string {
  const trimmedName = friend.name.trim();
  return trimmedName || `Friend ${index + 1}`;
}

function buildValidationIssuesForTrip(trip: FriendsTrackerTripConfig | null): FriendsConfigValidationIssue[] {
  if (!trip) {
    return [];
  }

  const issues: FriendsConfigValidationIssue[] = [];

  trip.friends.forEach((friend, friendIndex) => {
    const friendName = getFriendDisplayName(friend, friendIndex);
    let previousValidDeparture: { timestamp: number; legIndex: number } | null = null;

    friend.flights.forEach((leg, legIndex) => {
      if (!hasLegContent(leg)) {
        return;
      }

      const departureText = typeof leg.departureTime === 'string' ? leg.departureTime.trim() : '';
      const parsedDeparture = departureText ? Date.parse(departureText) : Number.NaN;

      if (!departureText || Number.isNaN(parsedDeparture)) {
        issues.push({
          id: `${friend.id}:${leg.id}:invalid-date`,
          friendId: friend.id,
          friendName,
          legId: leg.id,
          legIndex,
          code: 'invalid-date',
          message: `${friendName} leg ${legIndex + 1}: enter a valid departure date/time.`,
        });
        return;
      }

      if (previousValidDeparture && parsedDeparture < previousValidDeparture.timestamp) {
        issues.push({
          id: `${friend.id}:${leg.id}:flight-order`,
          friendId: friend.id,
          friendName,
          legId: leg.id,
          legIndex,
          code: 'flight-order',
          message: `${friendName} leg ${legIndex + 1} departs before leg ${previousValidDeparture.legIndex + 1}.`,
        });
      }

      previousValidDeparture = { timestamp: parsedDeparture, legIndex };
    });
  });

  return issues;
}

export interface FriendsConfigContextValue {
  locale: string;
  demoReferenceTime: number;
  isFlightAwareValidationEnabled: boolean;
  flightAwareValidationNotice: string | null;
  trips: FriendsTrackerTripConfig[];
  setTrips: (updater: FriendsTrackerTripConfig[] | ((prev: FriendsTrackerTripConfig[]) => FriendsTrackerTripConfig[])) => void;
  currentTripId: string | null;
  setCurrentTripId: (id: string | null) => void;
  selectedTripId: string | null;
  setSelectedTripId: (id: string | null) => void;
  cronEnabled: boolean;
  setCronEnabled: (value: boolean) => void;
  cronDashboard: TrackerCronDashboard;
  isSaving: boolean;
  isSavingCronToggle: boolean;
  isRunningCron: boolean;
  notice: { type: 'success' | 'error'; text: string } | null;
  setNotice: (notice: { type: 'success' | 'error'; text: string } | null) => void;
  jsonNotice: { type: 'success' | 'error'; text: string } | null;
  hasHydrated: boolean;
  airportSuggestions: AirportDirectoryResponse['airports'];
  setAirportSuggestions: (updater: AirportDirectoryResponse['airports'] | ((prev: AirportDirectoryResponse['airports']) => AirportDirectoryResponse['airports'])) => void;
  airportTimezones: Record<string, string>;
  activeAirportField: string | null;
  setActiveAirportField: (fieldKey: string | null | ((prev: string | null) => string | null)) => void;
  lastSavedAt: number | null;
  tripPendingRemovalId: string | null;
  setTripPendingRemovalId: (id: string | null) => void;
  fileInputRef: RefObject<HTMLInputElement | null>;
  // Computed
  selectedTrip: FriendsTrackerTripConfig | null;
  currentTrip: FriendsTrackerTripConfig | null;
  tripPendingRemoval: FriendsTrackerTripConfig | null;
  friends: FriendTravelConfig[];
  hasPendingChanges: boolean;
  trackedIdentifiers: string[];
  latestCronRun: TrackerCronDashboard['history'][number] | null;
  validationIssues: FriendsConfigValidationIssue[];
  hasValidationErrors: boolean;
  availableValidationProviders: FlightValidationProviderSelection;
  flightValidationResults: Record<string, FlightProviderValidationResult>;
  refreshingLegIds: Record<string, boolean>;
  validationModal: FlightValidationModalState | null;
  // Actions
  updateTrip: (tripId: string, updater: (trip: FriendsTrackerTripConfig) => FriendsTrackerTripConfig) => void;
  updateSelectedTrip: (updater: (trip: FriendsTrackerTripConfig) => FriendsTrackerTripConfig) => void;
  updateSelectedTripFriends: (updater: (friends: FriendTravelConfig[]) => FriendTravelConfig[]) => void;
  updateFriend: (friendId: string, updater: (friend: FriendTravelConfig) => FriendTravelConfig) => void;
  moveFriendFlight: (friendId: string, legIndex: number, direction: -1 | 1) => void;
  removeTrip: (tripId: string) => void;
  addTrip: () => void;
  handleCronToggle: (nextValue: boolean) => Promise<void>;
  handleRunCronNow: () => Promise<void>;
  forceRefreshFlightLeg: (friendId: string, legId: string) => Promise<void>;
  validateFlightLeg: (friendId: string, legId: string) => Promise<void>;
  runValidationModal: () => Promise<void>;
  toggleValidationProvider: (providerId: FlightValidationProviderId) => void;
  closeValidationModal: () => void;
  applyValidationCandidate: (candidate: FlightValidationModalCandidate) => void;
  handleExport: () => void;
  handleImport: (event: ChangeEvent<HTMLInputElement>) => Promise<void>;
  handlePublishCurrentTrip: (nextTripId: string) => Promise<void>;
  handleCancelPendingChanges: () => void;
  handleSave: () => Promise<void>;
}

const FriendsConfigContext = createContext<FriendsConfigContextValue | null>(null);

export function useFriendsConfig(): FriendsConfigContextValue {
  const context = useContext(FriendsConfigContext);
  if (!context) {
    throw new Error('useFriendsConfig must be used within a FriendsConfigProvider');
  }
  return context;
}

interface FriendsConfigProviderProps {
  initialConfig: FriendsTrackerConfig;
  initialCronDashboard: TrackerCronDashboard;
  initialDemoReferenceTime?: number;
  initialAirportTimezones?: Record<string, string>;
  initialFlightAwareValidationEnabled?: boolean;
  initialFlightAwareValidationNotice?: string | null;
  initialEnabledValidationProviders?: ProviderName[];
  children: ReactNode;
}

export function FriendsConfigProvider({
  initialConfig,
  initialCronDashboard,
  initialDemoReferenceTime,
  initialAirportTimezones = initialConfig.airportTimezones ?? {},
  initialFlightAwareValidationEnabled = true,
  initialFlightAwareValidationNotice = null,
  initialEnabledValidationProviders = DEFAULT_ENABLED_VALIDATION_PROVIDERS,
  children,
}: FriendsConfigProviderProps) {
  const locale = useLocale();
  const [demoReferenceTime] = useState(() => initialDemoReferenceTime ?? Date.now());
  const normalizedConfig = normalizeFriendsTrackerConfig(initialConfig, { demoReferenceTime });
  const initialCurrentTrip = getCurrentTripConfig(normalizedConfig);
  const [trips, setTrips] = useState(normalizedConfig.trips ?? []);
  const [currentTripId, setCurrentTripId] = useState<string | null>(normalizedConfig.currentTripId ?? initialCurrentTrip?.id ?? null);
  const [selectedTripId, setSelectedTripId] = useState<string | null>(normalizedConfig.currentTripId ?? initialCurrentTrip?.id ?? normalizedConfig.trips?.[0]?.id ?? null);
  const [cronEnabled, setCronEnabled] = useState(normalizedConfig.cronEnabled ?? true);
  const [cronDashboard, setCronDashboard] = useState(initialCronDashboard);
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingCronToggle, setIsSavingCronToggle] = useState(false);
  const [isRunningCron, setIsRunningCron] = useState(false);
  const [refreshingLegIds, setRefreshingLegIds] = useState<Record<string, boolean>>({});
  const [flightValidationResults, setFlightValidationResults] = useState<Record<string, FlightProviderValidationResult>>({});
  const [validationModal, setValidationModal] = useState<FlightValidationModalState | null>(null);
  const persistedFlightValidationResults = useMemo(
    () => buildPersistedFlightValidationResults(trips),
    [trips],
  );
  const combinedFlightValidationResults = useMemo(
    () => ({
      ...persistedFlightValidationResults,
      ...flightValidationResults,
    }),
    [persistedFlightValidationResults, flightValidationResults],
  );
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [jsonNotice, setJsonNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const availableValidationProviders = useMemo(
    () => buildAvailableValidationProviderSelection(initialEnabledValidationProviders),
    [initialEnabledValidationProviders],
  );
  const [hasHydrated, setHasHydrated] = useState(false);
  const [airportSuggestions, setAirportSuggestions] = useState<AirportDirectoryResponse['airports']>([]);
  const [airportTimezones, setAirportTimezones] = useState<Record<string, string>>(() => ({ ...initialAirportTimezones }));
  const [activeAirportField, setActiveAirportField] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(normalizedConfig.updatedAt);
  const [lastSavedConfig, setLastSavedConfig] = useState<FriendsTrackerConfig>({
    ...normalizedConfig,
    currentTripId: normalizedConfig.currentTripId ?? initialCurrentTrip?.id ?? normalizedConfig.trips?.[0]?.id ?? null,
    cronEnabled: normalizedConfig.cronEnabled ?? true,
    trips: normalizedConfig.trips ?? [],
    airportTimezones: normalizedConfig.airportTimezones ?? initialAirportTimezones,
  });
  const [savedSnapshot, setSavedSnapshot] = useState(() => buildSaveableConfigSnapshot({
    ...normalizedConfig,
    currentTripId: normalizedConfig.currentTripId ?? initialCurrentTrip?.id ?? normalizedConfig.trips?.[0]?.id ?? null,
    cronEnabled: normalizedConfig.cronEnabled ?? true,
    trips: normalizedConfig.trips ?? [],
  }, demoReferenceTime));
  const [tripPendingRemovalId, setTripPendingRemovalId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const selectedTrip = trips.find((trip) => trip.id === selectedTripId) ?? trips[0] ?? null;
  const currentTrip = trips.find((trip) => trip.id === currentTripId) ?? selectedTrip;
  const tripPendingRemoval = trips.find((trip) => trip.id === tripPendingRemovalId) ?? null;
  const friends = selectedTrip?.friends ?? [];

  function buildExportPayload(nextState?: {
    trips?: FriendsTrackerTripConfig[];
    currentTripId?: string | null;
  }): FriendsTrackerConfig {
    return normalizeFriendsTrackerConfig({
      updatedAt: lastSavedAt,
      updatedBy: normalizedConfig.updatedBy ?? 'chantal config page',
      cronEnabled,
      currentTripId: nextState?.currentTripId ?? currentTripId ?? selectedTrip?.id ?? null,
      trips: nextState?.trips ?? trips,
    }, { demoReferenceTime });
  }

  const currentSnapshot = buildSaveableConfigSnapshot(buildExportPayload(), demoReferenceTime);
  const hasPendingChanges = currentSnapshot !== savedSnapshot;
  const trackedIdentifiers = extractFriendTrackerIdentifiers(buildExportPayload());
  const latestCronRun = Array.isArray(cronDashboard.history) ? cronDashboard.history[0] ?? null : null;
  const validationIssues = buildValidationIssuesForTrip(selectedTrip);
  const hasValidationErrors = validationIssues.length > 0;

  useEffect(() => {
    setHasHydrated(true);
  }, []);

  useEffect(() => {
    let isCancelled = false;

    const codesToFetch = Array.from(new Set(
      trips.flatMap((trip) => trip.friends.flatMap((friend) => friend.flights.flatMap((leg) => [
        normalizeAirportCode(leg.from),
        normalizeAirportCode(leg.to),
      ]))),
    )).filter((code) => code.length > 0 && !airportTimezones[code]);

    if (codesToFetch.length === 0) {
      return;
    }

    void (async () => {
      try {
        const searchParams = new URLSearchParams({ codes: codesToFetch.join(',') });
        const response = await fetch(`/api/airports?${searchParams.toString()}`, { cache: 'force-cache' });
        const payload = await response.json() as Partial<AirportDirectoryResponse> & { error?: string };

        if (!response.ok || isCancelled) {
          return;
        }

        const nextLookup = payload.timezones ?? {};

        if (Object.keys(nextLookup).length === 0) {
          return;
        }

        setAirportTimezones((currentLookup) => ({
          ...currentLookup,
          ...nextLookup,
        }));
      } catch {
        // Ignore airport directory issues here and keep the local-time fallback.
      }
    })();

    return () => {
      isCancelled = true;
    };
  }, [airportTimezones, trips]);

  useEffect(() => {
    if (!activeAirportField || !selectedTrip) {
      setAirportSuggestions([]);
      return;
    }

    const [friendId, legId, field] = activeAirportField.split(':') as [string, string, 'from' | 'to' | 'current'];
    const activeFriend = selectedTrip.friends.find((friend) => friend.id === friendId);
    const activeLeg = activeFriend?.flights.find((leg) => leg.id === legId);
    const query = field === 'from'
      ? activeLeg?.from ?? ''
      : field === 'to'
        ? activeLeg?.to ?? ''
        : activeFriend?.currentAirport ?? '';

    if (query.trim().length < 2) {
      setAirportSuggestions([]);
      return;
    }

    const normalizedQueryCode = normalizeAirportCode(query);
    const existingSuggestion = airportSuggestions.find((airport) => getAirportSuggestionCode(airport) === normalizedQueryCode);
    if (existingSuggestion) {
      setAirportSuggestions([existingSuggestion]);
    }

    let isCancelled = false;
    const timeoutId = window.setTimeout(() => {
      void (async () => {
        try {
          const searchParams = new URLSearchParams({ query, limit: '6' });
          const response = await fetch(`/api/airports?${searchParams.toString()}`, { cache: 'force-cache' });
          const payload = await response.json() as Partial<AirportDirectoryResponse> & { error?: string };

          if (!response.ok || isCancelled) {
            return;
          }

          const airports = Array.isArray(payload.airports) ? payload.airports : [];
          const nextLookup = payload.timezones ?? {};

          setAirportSuggestions(airports);

          if (Object.keys(nextLookup).length === 0) {
            return;
          }

          setAirportTimezones((currentLookup) => ({
            ...currentLookup,
            ...nextLookup,
          }));
        } catch {
          if (!isCancelled) {
            setAirportSuggestions([]);
          }
        }
      })();
    }, 120);

    return () => {
      isCancelled = true;
      window.clearTimeout(timeoutId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAirportField, selectedTrip]);

  useEffect(() => {
    if (!tripPendingRemoval) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setTripPendingRemovalId(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [tripPendingRemoval]);

  async function refreshCronDashboard() {
    const response = await fetch('/api/tracker/cron/config', { cache: 'no-store' });
    const payload = await response.json() as TrackerCronDashboard & { error?: string };

    if (!response.ok) {
      throw new Error(payload.error || 'Unable to refresh the background cron status.');
    }

    setCronDashboard(payload);
    return payload;
  }

  function updateTrip(tripId: string, updater: (trip: FriendsTrackerTripConfig) => FriendsTrackerTripConfig) {
    setTrips((currentTrips) => currentTrips.map((trip) => trip.id === tripId ? updater(trip) : trip));
  }

  function updateSelectedTrip(updater: (trip: FriendsTrackerTripConfig) => FriendsTrackerTripConfig) {
    if (!selectedTrip) {
      return;
    }

    updateTrip(selectedTrip.id, updater);
  }

  function updateSelectedTripFriends(updater: (friends: FriendTravelConfig[]) => FriendTravelConfig[]) {
    updateSelectedTrip((trip) => ({
      ...trip,
      friends: updater(trip.friends),
    }));
  }

  function updateFriend(friendId: string, updater: (friend: FriendTravelConfig) => FriendTravelConfig) {
    updateSelectedTripFriends((currentFriends) => currentFriends.map((friend) => friend.id === friendId ? updater(friend) : friend));
  }

  function moveFriendFlight(friendId: string, legIndex: number, direction: -1 | 1) {
    updateFriend(friendId, (currentFriend) => {
      const nextIndex = legIndex + direction;
      const nextFlights = moveArrayItem(currentFriend.flights, legIndex, nextIndex);

      if (nextFlights === currentFriend.flights) {
        return currentFriend;
      }

      return {
        ...currentFriend,
        flights: nextFlights,
      };
    });
  }

  function removeTrip(tripId: string) {
    const remainingTrips = trips.filter((trip) => trip.id !== tripId);
    const fallbackTrip = remainingTrips.find((trip) => !trip.isDemo) ?? remainingTrips[0] ?? null;

    setTrips(remainingTrips);
    setSelectedTripId(fallbackTrip?.id ?? null);

    if (currentTripId === tripId) {
      setCurrentTripId(fallbackTrip?.id ?? null);
    }
  }

  function addTrip() {
    const newTrip = createDraftTrip();
    setTrips((currentTrips) => [...currentTrips, newTrip]);
    setSelectedTripId(newTrip.id);
  }

  function applySavedConfig(nextConfig: FriendsTrackerConfig) {
    const normalizedNextConfig = normalizeFriendsTrackerConfig(nextConfig, { demoReferenceTime });
    const nextTrips = normalizedNextConfig.trips ?? [];
    const nextSelectedTripId = nextTrips.some((trip) => trip.id === selectedTripId)
      ? selectedTripId
      : (normalizedNextConfig.currentTripId ?? nextTrips[0]?.id ?? null);

    setTrips(nextTrips);
    setCurrentTripId(normalizedNextConfig.currentTripId ?? nextTrips[0]?.id ?? null);
    setSelectedTripId(nextSelectedTripId);
    setCronEnabled(normalizedNextConfig.cronEnabled ?? true);
    setLastSavedAt(normalizedNextConfig.updatedAt);

    if (nextConfig.airportTimezones) {
      setAirportTimezones((currentLookup) => ({
        ...currentLookup,
        ...nextConfig.airportTimezones,
      }));
    }

    const canonicalSavedConfig = {
      ...normalizedNextConfig,
      currentTripId: normalizedNextConfig.currentTripId ?? nextTrips[0]?.id ?? null,
      cronEnabled: normalizedNextConfig.cronEnabled ?? true,
      trips: nextTrips,
      airportTimezones: nextConfig.airportTimezones ?? normalizedNextConfig.airportTimezones ?? {},
    } satisfies FriendsTrackerConfig;

    setLastSavedConfig(canonicalSavedConfig);
    setSavedSnapshot(buildSaveableConfigSnapshot(canonicalSavedConfig, demoReferenceTime));

    const nextChantalIdentifiers = normalizedNextConfig.cronEnabled === false
      ? []
      : extractFriendTrackerIdentifiers(normalizedNextConfig);

    setCronDashboard((currentDashboard) => {
      const manualIdentifiers = getCronDashboardManualIdentifiers(currentDashboard);

      return {
        ...currentDashboard,
        config: {
          ...currentDashboard.config,
          identifiers: Array.from(new Set([...manualIdentifiers, ...nextChantalIdentifiers])),
          manualIdentifiers,
          chantalIdentifiers: nextChantalIdentifiers,
          updatedAt: normalizedNextConfig.updatedAt,
          updatedBy: normalizedNextConfig.updatedBy,
        },
      };
    });

    return normalizedNextConfig;
  }

  function applyMatchedFlightToLeg(friendId: string, legId: string, match: AppliedValidationMatch) {
    const matchedIcao24 = typeof match.matchedIcao24 === 'string' && /^[0-9A-F]{6}$/.test(match.matchedIcao24)
      ? match.matchedIcao24
      : null;
    const matchedDepartureTime = typeof match.matchedDepartureTime === 'number' && Number.isFinite(match.matchedDepartureTime)
      ? new Date(match.matchedDepartureTime).toISOString()
      : null;
    const matchedArrivalTime = typeof match.matchedArrivalTime === 'number' && Number.isFinite(match.matchedArrivalTime)
      ? new Date(match.matchedArrivalTime).toISOString()
      : null;
    const matchedDepartureAirport = normalizeAirportCode(match.matchedDepartureAirport);
    const matchedArrivalAirport = normalizeAirportCode(match.matchedArrivalAirport);
    const lastCheckedAt = typeof match.lastCheckedAt === 'number' && Number.isFinite(match.lastCheckedAt)
      ? match.lastCheckedAt
      : Date.now();

    updateFriend(friendId, (currentFriend) => ({
      ...currentFriend,
      flights: currentFriend.flights.map((currentLeg) => {
        if (currentLeg.id !== legId) {
          return currentLeg;
        }

        const matchedFlightNumber = resolveSuggestedFlightNumber(currentLeg.flightNumber, match.matchedFlightNumber);
        const existingProviderMatches = Array.isArray(currentLeg.validatedFlight?.providerMatches)
          ? currentLeg.validatedFlight.providerMatches
          : currentLeg.validatedFlight?.providerLabel
            ? [{
                status: currentLeg.validatedFlight.status ?? 'matched',
                providerLabel: currentLeg.validatedFlight.providerLabel,
                message: currentLeg.validatedFlight.message ?? null,
                matchedIcao24: currentLeg.validatedFlight.matchedIcao24 ?? currentLeg.resolvedIcao24 ?? null,
                matchedFlightNumber: currentLeg.validatedFlight.matchedFlightNumber ?? currentLeg.flightNumber ?? null,
                matchedDepartureTime: currentLeg.validatedFlight.matchedDepartureTime ?? currentLeg.departureTime,
                matchedArrivalTime: currentLeg.validatedFlight.matchedArrivalTime ?? currentLeg.arrivalTime ?? null,
                matchedDepartureAirport: currentLeg.validatedFlight.matchedDepartureAirport ?? normalizeAirportCode(currentLeg.from),
                matchedArrivalAirport: currentLeg.validatedFlight.matchedArrivalAirport ?? normalizeAirportCode(currentLeg.to),
                matchedRoute: currentLeg.validatedFlight.matchedRoute ?? null,
                departureDeltaMinutes: currentLeg.validatedFlight.departureDeltaMinutes ?? null,
                lastCheckedAt: currentLeg.validatedFlight.lastCheckedAt ?? currentLeg.lastResolvedAt ?? null,
              } satisfies FriendFlightValidationProviderSnapshot]
            : [];
        const nextProviderMatches = match.providerLabel
          ? [{
              status: match.status,
              providerLabel: match.providerLabel,
              message: match.message,
              matchedIcao24,
              matchedFlightNumber: matchedFlightNumber || null,
              matchedDepartureTime,
              matchedArrivalTime,
              matchedDepartureAirport,
              matchedArrivalAirport,
              matchedRoute: match.matchedRoute,
              departureDeltaMinutes: match.departureDeltaMinutes,
              lastCheckedAt,
            } satisfies FriendFlightValidationProviderSnapshot]
          : [];
        const mergedProviderMatches = Array.from(new Map(
          [...existingProviderMatches, ...nextProviderMatches].map((entry) => [
            [
              entry.providerLabel ?? '',
              entry.matchedIcao24 ?? '',
              entry.matchedFlightNumber ?? '',
              entry.matchedDepartureTime ?? '',
              entry.matchedArrivalTime ?? '',
            ].join('|'),
            entry,
          ]),
        ).values());
        const mergedProviderLabel = Array.from(new Set(
          mergedProviderMatches
            .map((entry) => entry.providerLabel)
            .filter((value): value is string => typeof value === 'string' && Boolean(value.trim())),
        )).join(' + ') || match.providerLabel;
        const mergedMessage = mergedProviderMatches.length > 1
          ? `${mergedProviderLabel ?? 'Validation'} matched ${matchedFlightNumber || currentLeg.flightNumber}. ${mergedProviderMatches.length} providers confirmed this leg.`
          : match.message;

        return {
          ...currentLeg,
          flightNumber: matchedFlightNumber || currentLeg.flightNumber,
          departureTime: matchedDepartureTime || currentLeg.departureTime,
          arrivalTime: matchedArrivalTime ?? currentLeg.arrivalTime ?? null,
          departureTimezone: matchedDepartureAirport
            ? airportTimezones[matchedDepartureAirport] ?? currentLeg.departureTimezone ?? null
            : currentLeg.departureTimezone ?? null,
          from: matchedDepartureAirport ?? currentLeg.from ?? null,
          to: matchedArrivalAirport ?? currentLeg.to ?? null,
          resolvedIcao24: matchedIcao24 ?? currentLeg.resolvedIcao24 ?? null,
          lastResolvedAt: matchedIcao24 ? lastCheckedAt : currentLeg.lastResolvedAt ?? null,
          validatedFlight: {
            status: match.status,
            providerLabel: mergedProviderLabel,
            message: mergedMessage,
            matchedIcao24,
            matchedFlightNumber: matchedFlightNumber || null,
            matchedDepartureTime,
            matchedArrivalTime,
            matchedDepartureAirport,
            matchedArrivalAirport,
            matchedRoute: match.matchedRoute,
            departureDeltaMinutes: match.departureDeltaMinutes,
            lastCheckedAt,
            providerMatches: mergedProviderMatches,
          },
        };
      }),
    }));
  }

  function setFlightValidationResult(legId: string, result: FlightProviderValidationResult) {
    setFlightValidationResults((currentResults) => ({
      ...currentResults,
      [legId]: result,
    }));
  }

  function toggleValidationProvider(providerId: FlightValidationProviderId) {
    if (!availableValidationProviders[providerId]) {
      return;
    }

    setValidationModal((current) => current
      ? {
          ...current,
          selectedProviders: {
            ...current.selectedProviders,
            [providerId]: !current.selectedProviders[providerId],
          },
        }
      : null);
  }

  function closeValidationModal() {
    setValidationModal(null);
  }

  function applyValidationCandidate(candidate: FlightValidationModalCandidate) {
    const modal = validationModal;
    if (!modal) {
      return;
    }

    const { friendId, legId, identifier } = modal;
    const now = Date.now();
    const status = candidate.status === 'warning' ? 'warning' : 'matched';
    const resolvedFlightNumber = resolveSuggestedFlightNumber(identifier, candidate.matchedFlightNumber) || null;
    const message = `${candidate.providerLabel} matched ${resolvedFlightNumber ?? identifier}. ${candidate.message}`;

    applyMatchedFlightToLeg(friendId, legId, {
      status,
      message,
      providerLabel: candidate.providerLabel,
      matchedIcao24: candidate.matchedIcao24,
      matchedFlightNumber: resolvedFlightNumber,
      matchedDepartureTime: candidate.matchedDepartureTime,
      matchedArrivalTime: candidate.matchedArrivalTime,
      matchedDepartureAirport: candidate.matchedDepartureAirport,
      matchedArrivalAirport: candidate.matchedArrivalAirport,
      departureDeltaMinutes: candidate.departureDeltaMinutes,
      matchedRoute: candidate.matchedRoute,
      lastCheckedAt: now,
    });

    setFlightValidationResult(legId, {
      legId,
      friendId,
      status,
      message,
      providerLabel: candidate.providerLabel,
      matchedIcao24: candidate.matchedIcao24,
      matchedFlightNumber: resolvedFlightNumber,
      matchedDepartureTime: candidate.matchedDepartureTime,
      matchedArrivalTime: candidate.matchedArrivalTime,
      matchedDepartureAirport: candidate.matchedDepartureAirport,
      matchedArrivalAirport: candidate.matchedArrivalAirport,
      departureDeltaMinutes: candidate.departureDeltaMinutes,
      matchedRoute: candidate.matchedRoute,
      lastCheckedAt: now,
    });

    setNotice({
      type: 'success',
      text: 'Validation applied to this leg. Click "Save config" to persist it.',
    });
    setValidationModal(null);
  }

  async function validateFlightLeg(friendId: string, legId: string) {
    const activeTrip = selectedTrip;
    const friend = activeTrip?.friends.find((entry) => entry.id === friendId);
    const leg = friend?.flights.find((entry) => entry.id === legId);

    if (!friend || !leg) {
      return;
    }

    const identifier = normalizeFriendFlightIdentifier(leg.resolvedIcao24 || leg.flightNumber);

    if (!identifier) {
      setFlightValidationResult(legId, {
        legId,
        friendId,
        status: 'skipped',
        message: 'Enter a flight number or ICAO24 lock before running live validation.',
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
      });
      return;
    }

    setValidationModal({
      friendId,
      legId,
      identifier,
      status: 'setup',
      selectedProviders: createDefaultValidationProviderSelection(availableValidationProviders),
      candidates: [],
      message: 'Choose one or more providers, then run validation.',
    });
  }

  async function runValidationModal() {
    const modal = validationModal;
    const activeTrip = selectedTrip;

    if (!modal) {
      return;
    }

    const { friendId, legId, identifier, selectedProviders } = modal;
    const friend = activeTrip?.friends.find((entry) => entry.id === friendId);
    const leg = friend?.flights.find((entry) => entry.id === legId);

    if (!friend || !leg) {
      return;
    }

    if (countSelectedValidationProviders(selectedProviders) === 0) {
      setValidationModal((current) => current
        ? { ...current, status: 'error', message: 'Select at least one enabled provider before running validation.' }
        : null);
      return;
    }

    setFlightValidationResult(legId, {
      legId,
      friendId,
      status: 'loading',
      message: `Checking ${identifier} against the selected providers…`,
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
    });

    setValidationModal((current) => current
      ? {
          ...current,
          status: 'loading',
          candidates: [],
          message: `Checking ${identifier} against the selected providers…`,
        }
      : null);

    try {
      const currentDepartureTime = typeof leg.departureTime === 'string' ? leg.departureTime : '';
      const currentFrom = leg.from ?? null;
      const currentTo = leg.to ?? null;

      const response = await fetch('/api/chantal/validate-flight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifier,
          legId,
          departureTime: currentDepartureTime,
          from: currentFrom,
          to: currentTo,
          includeOnDemandProviders: selectedProviders.aerodatabox,
          providers: selectedProviders,
        }),
      });

      const payload = await response.json() as {
        status?: string;
        message?: string;
        error?: string;
        providerLabel?: string | null;
        matchedIcao24?: string | null;
        matchedFlightNumber?: string | null;
        matchedDepartureTime?: number | null;
        matchedArrivalTime?: number | null;
        matchedDepartureAirport?: string | null;
        matchedArrivalAirport?: string | null;
        departureDeltaMinutes?: number | null;
        matchedRoute?: string | null;
        lastCheckedAt?: number | null;
        candidates?: FlightValidationModalCandidate[];
      };

      if (!response.ok && !payload.status) {
        throw new Error(payload.error || 'Unable to validate the configured flight right now.');
      }

      const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
      const overallStatus = payload.status ?? 'not-found';
      const isError = overallStatus === 'error';
      const inlineResult = {
        legId,
        friendId,
        status: (overallStatus as FlightProviderValidationResult['status']) ?? 'not-found',
        message: payload.message ?? `No scheduled or live provider match was found for ${identifier}.`,
        providerLabel: typeof payload.providerLabel === 'string' ? payload.providerLabel : null,
        matchedIcao24: typeof payload.matchedIcao24 === 'string' ? payload.matchedIcao24 : null,
        matchedFlightNumber: typeof payload.matchedFlightNumber === 'string' ? payload.matchedFlightNumber : null,
        matchedDepartureTime: typeof payload.matchedDepartureTime === 'number' && Number.isFinite(payload.matchedDepartureTime)
          ? payload.matchedDepartureTime
          : null,
        matchedArrivalTime: typeof payload.matchedArrivalTime === 'number' && Number.isFinite(payload.matchedArrivalTime)
          ? payload.matchedArrivalTime
          : null,
        matchedDepartureAirport: typeof payload.matchedDepartureAirport === 'string' ? payload.matchedDepartureAirport : null,
        matchedArrivalAirport: typeof payload.matchedArrivalAirport === 'string' ? payload.matchedArrivalAirport : null,
        departureDeltaMinutes: typeof payload.departureDeltaMinutes === 'number' && Number.isFinite(payload.departureDeltaMinutes)
          ? payload.departureDeltaMinutes
          : null,
        matchedRoute: typeof payload.matchedRoute === 'string' ? payload.matchedRoute : null,
        lastCheckedAt: typeof payload.lastCheckedAt === 'number' && Number.isFinite(payload.lastCheckedAt)
          ? payload.lastCheckedAt
          : Date.now(),
      } satisfies FlightProviderValidationResult;

      const normalizedCandidates = candidates.length > 0
        ? candidates
        : (overallStatus === 'matched' || overallStatus === 'warning') && inlineResult.providerLabel
          ? [{
              status: overallStatus === 'warning' ? 'warning' : 'matched',
              providerLabel: inlineResult.providerLabel,
              matchedIcao24: inlineResult.matchedIcao24,
              matchedFlightNumber: inlineResult.matchedFlightNumber,
              matchedDepartureTime: inlineResult.matchedDepartureTime,
              matchedArrivalTime: inlineResult.matchedArrivalTime,
              matchedDepartureAirport: inlineResult.matchedDepartureAirport,
              matchedArrivalAirport: inlineResult.matchedArrivalAirport,
              departureDeltaMinutes: inlineResult.departureDeltaMinutes,
              matchedRoute: inlineResult.matchedRoute,
              message: inlineResult.message,
            } satisfies FlightValidationModalCandidate]
          : [];

      setValidationModal((current) => current
        ? {
            ...current,
            status: isError ? 'error' : 'loaded',
            candidates: normalizedCandidates,
            message: inlineResult.message,
          }
        : null);

      setFlightValidationResult(legId, inlineResult);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unable to validate this flight right now.';
      setValidationModal((current) => current
        ? { ...current, status: 'error', message: errorMessage }
        : null);

      setFlightValidationResult(legId, {
        legId,
        friendId,
        status: 'error',
        message: errorMessage,
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
      });
    }
  }

  async function handleCronToggle(nextValue: boolean) {
    const previousValue = cronEnabled;
    setCronEnabled(nextValue);
    setIsSavingCronToggle(true);
    setNotice(null);

    try {
      const response = await fetch('/api/chantal/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          updatedBy: 'chantal cron toggle',
          cronEnabled: nextValue,
        }),
      });

      const payload = await response.json() as FriendsTrackerConfig & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || 'Unable to save the cron setting.');
      }

      const nextConfig = applySavedConfig(payload);
      await refreshCronDashboard();
      setNotice({
        type: 'success',
        text: nextConfig.cronEnabled ?? nextValue
          ? 'Chantal batch enabled and added to the shared cron list.'
          : 'Chantal batch disabled and removed from the shared cron list.',
      });
    } catch (error) {
      setCronEnabled(previousValue);
      setNotice({
        type: 'error',
        text: error instanceof Error ? error.message : 'Unable to save the cron setting.',
      });
    } finally {
      setIsSavingCronToggle(false);
    }
  }

  async function handleRunCronNow() {
    setIsRunningCron(true);
    setNotice(null);

    try {
      const response = await fetch('/api/tracker/cron', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trigger: 'manual-admin',
          identifiers: trackedIdentifiers,
          requestedBy: 'chantal config page',
        }),
      });

      const payload = await response.json() as import('~/lib/server/trackerCron').TrackerCronRun & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || 'Unable to run the background prefetch cron.');
      }

      await refreshCronDashboard();
      setNotice({
        type: 'success',
        text: `Background prefetch finished with status: ${payload.status}.`,
      });
    } catch (error) {
      setNotice({
        type: 'error',
        text: error instanceof Error ? error.message : 'Unable to run the background prefetch cron.',
      });
    } finally {
      setIsRunningCron(false);
    }
  }

  async function forceRefreshFlightLeg(friendId: string, legId: string) {
    const activeTrip = selectedTrip;
    const friend = activeTrip?.friends.find((entry) => entry.id === friendId);
    const leg = friend?.flights.find((entry) => entry.id === legId);

    if (!friend || !leg) {
      return;
    }

    const identifiers = getFlightLegRefreshIdentifiers(leg);
    const displayIdentifier = identifiers[0] ?? normalizeFriendFlightIdentifier(leg.flightNumber) ?? `leg ${legId}`;

    if (identifiers.length === 0) {
      setNotice({
        type: 'error',
        text: 'Add a public flight number or a real ICAO24 lock before forcing a route refresh.',
      });
      return;
    }

    setRefreshingLegIds((current) => ({ ...current, [legId]: true }));
    setNotice(null);

    try {
      const enrichmentResponse = await fetch('/api/tracker/cron/enrichment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trigger: 'manual-admin',
          identifiers,
          requestedBy: 'chantal config leg force refresh',
        }),
      });

      const enrichmentPayload = await enrichmentResponse.json() as { error?: string };
      if (!enrichmentResponse.ok) {
        throw new Error(enrichmentPayload.error || `Unable to run the targeted refresh for ${displayIdentifier}.`);
      }

      const queryParams = new URLSearchParams({
        q: identifiers.join(','),
        refresh: '1',
      });
      const trackerResponse = await fetch(`/api/tracker?${queryParams.toString()}`);
      const trackerPayload = await trackerResponse.json() as {
        error?: string;
        matchedIdentifiers?: string[];
        flights?: Array<{
          route?: { departureAirport?: string | null; arrivalAirport?: string | null } | null;
          originPoint?: unknown;
          current?: unknown;
          track?: unknown[];
          rawTrack?: unknown[];
        }>;
      };

      if (!trackerResponse.ok) {
        throw new Error(trackerPayload.error || `Unable to fetch refreshed tracker data for ${displayIdentifier}.`);
      }

      await refreshCronDashboard();

      const matchedIdentifiers = Array.isArray(trackerPayload.matchedIdentifiers) ? trackerPayload.matchedIdentifiers : [];
      const flights = Array.isArray(trackerPayload.flights) ? trackerPayload.flights : [];
      const hasRouteData = flights.some((flight) => Boolean(
        flight.originPoint
        || flight.current
        || (Array.isArray(flight.track) && flight.track.length > 0)
        || (Array.isArray(flight.rawTrack) && flight.rawTrack.length > 0)
        || flight.route?.departureAirport
        || flight.route?.arrivalAirport
      ));

      if (matchedIdentifiers.length === 0) {
        setNotice({
          type: 'error',
          text: `Force refresh ran for ${displayIdentifier}, but no live or cached match was found yet.`,
        });
        return;
      }

      if (hasRouteData && typeof window !== 'undefined') {
        const refreshSignal = {
          at: Date.now(),
          identifiers,
        };

        try {
          window.localStorage.setItem('chantal-route-refresh-signal', JSON.stringify(refreshSignal));
        } catch {
          // Ignore storage write issues and still notify any same-tab listeners.
        }

        window.dispatchEvent(new CustomEvent('chantal:tracker-refresh', {
          detail: refreshSignal,
        }));
      }

      setNotice({
        type: hasRouteData ? 'success' : 'error',
        text: hasRouteData
          ? `Route/track refresh finished for ${displayIdentifier}. Any open tracker map will refresh automatically.`
          : `Force refresh ran for ${displayIdentifier}, but route/track data is still unavailable from the providers.`,
      });
    } catch (error) {
      setNotice({
        type: 'error',
        text: error instanceof Error ? error.message : 'Unable to refresh this flight leg right now.',
      });
    } finally {
      setRefreshingLegIds((current) => {
        const nextState = { ...current };
        delete nextState[legId];
        return nextState;
      });
    }
  }

  function handleExport() {
    setJsonNotice(null);

    try {
      const exportPayload = buildExportPayload();
      const exportTrips = removeDemoTrips(exportPayload.trips ?? []);
      const exportCurrentTripId = exportTrips.some((trip) => trip.id === exportPayload.currentTripId)
        ? exportPayload.currentTripId
        : exportTrips[0]?.id ?? null;
      const canonicalExportPayload = {
        updatedAt: exportPayload.updatedAt,
        updatedBy: exportPayload.updatedBy,
        cronEnabled: exportPayload.cronEnabled ?? true,
        currentTripId: exportCurrentTripId,
        trips: exportTrips,
        airportTimezones: exportPayload.airportTimezones ?? {},
      };
      const blob = new Blob([JSON.stringify(canonicalExportPayload, null, 2)], { type: 'application/json' });
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const dateLabel = new Date().toISOString().slice(0, 10);

      link.href = objectUrl;
      link.download = `chantal-friends-config-${dateLabel}.json`;
      link.click();
      URL.revokeObjectURL(objectUrl);

      setJsonNotice({ type: 'success', text: 'JSON export downloaded successfully.' });
    } catch (error) {
      setJsonNotice({
        type: 'error',
        text: error instanceof Error ? error.message : 'Unable to export the friends tracker config.',
      });
    }
  }

  async function handleImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file) {
      return;
    }

    setJsonNotice(null);

    try {
      const rawText = await file.text();
      const parsedValue = JSON.parse(rawText) as Partial<FriendsTrackerConfig> | FriendTravelConfig[];
      const parsedValueWithoutDemoTrips = Array.isArray(parsedValue)
        ? parsedValue
        : {
          ...parsedValue,
          currentTripId: typeof parsedValue.currentTripId === 'string' && parsedValue.currentTripId.trim()
            ? parsedValue.currentTripId.trim()
            : null,
          trips: Array.isArray(parsedValue.trips)
            ? removeDemoTrips(parsedValue.trips.map((trip, index) => normalizeFriendsTrackerTripConfig(trip, index)))
            : undefined,
        };
      const importedConfig = normalizeFriendsTrackerConfig(
        Array.isArray(parsedValueWithoutDemoTrips)
          ? { friends: parsedValueWithoutDemoTrips }
          : parsedValueWithoutDemoTrips,
        { demoReferenceTime },
      );

      const importedTripCount = Array.isArray(parsedValueWithoutDemoTrips)
        ? 1
        : Array.isArray(parsedValueWithoutDemoTrips.trips)
        ? parsedValueWithoutDemoTrips.trips.length
        : 1;

      const importedTrip = resolveImportedTripForMerge(parsedValueWithoutDemoTrips, importedConfig);
      const importedTripId = importedTrip?.id?.trim()
        ? importedTrip.id.trim()
        : createClientId('trip');

      const matchingTrip = importedTrip
        ? trips.find((trip) => trip.id === importedTripId)
        : null;
      const mergedIntoExistingTrip = Boolean(matchingTrip);

      if (importedTrip && matchingTrip) {
        const mergedTrip = reconcileImportedTripWithCurrentTrip(matchingTrip, {
          ...importedTrip,
          id: matchingTrip.id,
        });

        setTrips((currentTrips) => currentTrips.map((trip) => trip.id === matchingTrip.id ? mergedTrip : trip));
      } else if (importedTrip) {
        setTrips((currentTrips) => [...currentTrips, {
          ...importedTrip,
          id: importedTripId,
        }]);
      }

      if (importedTrip) {
        setSelectedTripId(importedTripId);
      }
      setLastSavedAt(importedConfig.updatedAt);
      setJsonNotice({
        type: 'success',
        text: importedTrip
          ? mergedIntoExistingTrip
            ? `Imported and merged into trip "${importedTrip.name}". Friends and flights now match the JSON for this trip. Click "Save config" to persist it.`
            : `Imported as a new trip "${importedTrip.name}" and selected it. Click "Save config" to persist it.`
          : `Imported ${importedTripCount} trip${importedTripCount === 1 ? '' : 's'} from JSON. Click "Save config" to persist it.`,
      });
    } catch (error) {
      setJsonNotice({
        type: 'error',
        text: error instanceof Error ? error.message : 'Unable to import the JSON config.',
      });
    }
  }

  async function persistConfig(
    nextState?: {
      trips?: FriendsTrackerTripConfig[];
      currentTripId?: string | null;
    },
    options?: {
      updatedBy?: string;
      successText?: string | ((payload: FriendsTrackerConfig) => string);
      errorText?: string;
      rollback?: () => void;
      force?: boolean;
    },
  ) {
    const nextConfig = buildExportPayload(nextState);
    const nextSnapshot = buildSaveableConfigSnapshot(nextConfig, demoReferenceTime);

    if (!options?.force && nextSnapshot === savedSnapshot) {
      return null;
    }

    setIsSaving(true);
    setNotice(null);

    try {
      const response = await fetch('/api/chantal/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          updatedBy: options?.updatedBy ?? 'chantal config page',
          cronEnabled: nextConfig.cronEnabled,
          currentTripId: nextConfig.currentTripId ?? null,
          trips: nextConfig.trips ?? [],
        }),
      });

      const payload = await response.json() as FriendsTrackerConfig & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || options?.errorText || 'Unable to save the friends tracker config.');
      }

      const appliedConfig = applySavedConfig(payload);
      const successText = typeof options?.successText === 'function'
        ? options.successText(appliedConfig)
        : options?.successText
          ?? (payload.cronEnabled === false
            ? 'Friends tracker config saved. This Chantal batch remains excluded from the shared cron list.'
            : 'Friends tracker config saved and synced to the shared cron list.');

      setNotice({
        type: 'success',
        text: successText,
      });

      return appliedConfig;
    } catch (error) {
      options?.rollback?.();
      setNotice({
        type: 'error',
        text: error instanceof Error ? error.message : options?.errorText || 'Unable to save the friends tracker config.',
      });
      return null;
    } finally {
      setIsSaving(false);
    }
  }

  async function handlePublishCurrentTrip(nextTripId: string) {
    if (nextTripId === currentTripId || isSaving || isSavingCronToggle) {
      return;
    }

    const previousTripId = currentTripId;
    setCurrentTripId(nextTripId);

    await persistConfig({ currentTripId: nextTripId }, {
      updatedBy: 'chantal live trip switch',
      successText: 'Live `/chantal` trip updated and saved immediately.',
      errorText: 'Unable to update the live Chantal trip.',
      rollback: () => setCurrentTripId(previousTripId),
      force: true,
    });
  }

  function handleCancelPendingChanges() {
    if (!hasPendingChanges || isSaving || isSavingCronToggle) {
      return;
    }

    setFlightValidationResults({});
    setValidationModal(null);
    setActiveAirportField(null);
    setAirportSuggestions([]);
    setTripPendingRemovalId(null);
    setNotice(null);
    setJsonNotice(null);
    applySavedConfig(lastSavedConfig);
  }

  async function handleSave() {
    await persistConfig(undefined, {
      updatedBy: 'chantal config page',
      successText: (payload) => payload.cronEnabled === false
        ? 'Friends tracker config saved. This Chantal batch remains excluded from the shared cron list.'
        : 'Friends tracker config saved and synced to the shared cron list.',
    });
  }

  const value = useMemo<FriendsConfigContextValue>(() => ({
    locale,
    demoReferenceTime,
    isFlightAwareValidationEnabled: initialFlightAwareValidationEnabled,
    flightAwareValidationNotice: initialFlightAwareValidationNotice,
    trips,
    setTrips,
    currentTripId,
    setCurrentTripId,
    selectedTripId,
    setSelectedTripId,
    cronEnabled,
    setCronEnabled,
    cronDashboard,
    isSaving,
    isSavingCronToggle,
    isRunningCron,
    notice,
    setNotice,
    jsonNotice,
    hasHydrated,
    airportSuggestions,
    setAirportSuggestions,
    airportTimezones,
    activeAirportField,
    setActiveAirportField,
    lastSavedAt,
    tripPendingRemovalId,
    setTripPendingRemovalId,
    fileInputRef,
    selectedTrip,
    currentTrip: currentTrip ?? null,
    tripPendingRemoval,
    friends,
    hasPendingChanges,
    trackedIdentifiers,
    latestCronRun,
    validationIssues,
    hasValidationErrors,
    availableValidationProviders,
    flightValidationResults: combinedFlightValidationResults,
    refreshingLegIds,
    validationModal,
    updateTrip,
    updateSelectedTrip,
    updateSelectedTripFriends,
    updateFriend,
    moveFriendFlight,
    removeTrip,
    addTrip,
    handleCronToggle,
    handleRunCronNow,
    forceRefreshFlightLeg,
    validateFlightLeg,
    runValidationModal,
    toggleValidationProvider,
    closeValidationModal,
    applyValidationCandidate,
    handleExport,
    handleImport,
    handlePublishCurrentTrip,
    handleCancelPendingChanges,
    handleSave,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [
    locale,
    demoReferenceTime,
    trips,
    currentTripId,
    selectedTripId,
    cronEnabled,
    cronDashboard,
    isSaving,
    isSavingCronToggle,
    isRunningCron,
    notice,
    jsonNotice,
    hasHydrated,
    airportSuggestions,
    airportTimezones,
    activeAirportField,
    lastSavedAt,
    tripPendingRemovalId,
    selectedTrip,
    currentTrip,
    tripPendingRemoval,
    friends,
    hasPendingChanges,
    trackedIdentifiers,
    latestCronRun,
    validationIssues,
    hasValidationErrors,
    availableValidationProviders,
    flightValidationResults,
    combinedFlightValidationResults,
    refreshingLegIds,
    validationModal,
    lastSavedConfig,
  ]);

  return (
    <FriendsConfigContext.Provider value={value}>
      {children}
    </FriendsConfigContext.Provider>
  );
}
