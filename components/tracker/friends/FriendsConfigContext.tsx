'use client';

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode, type RefObject } from 'react';
import { useLocale } from 'next-intl';
import type { AirportDirectoryResponse } from '~/components/tracker/flight/types';
import {
  extractFriendTrackerIdentifiers,
  getCurrentTripConfig,
  normalizeFriendsTrackerConfig,
  type FriendTravelConfig,
  type FriendsTrackerConfig,
  type FriendsTrackerTripConfig,
} from '~/lib/friendsTracker';
import { getAirportSuggestionCode, normalizeAirportCode } from '~/lib/utils/airportUtils';
import { buildSaveableConfigSnapshot, createDraftTrip, moveArrayItem } from '~/lib/utils/friendsConfigUtils';
import type { TrackerCronDashboard } from '~/lib/server/trackerCron';

function getCronDashboardChantalIdentifiers(dashboard: TrackerCronDashboard): string[] {
  return Array.isArray(dashboard.config.chantalIdentifiers) ? dashboard.config.chantalIdentifiers : [];
}

function getCronDashboardManualIdentifiers(dashboard: TrackerCronDashboard): string[] {
  if (Array.isArray(dashboard.config.manualIdentifiers)) {
    return dashboard.config.manualIdentifiers;
  }

  const chantalIdentifiers = new Set(getCronDashboardChantalIdentifiers(dashboard));
  return dashboard.config.identifiers.filter((identifier) => !chantalIdentifiers.has(identifier));
}

export interface FriendsConfigContextValue {
  locale: string;
  demoReferenceTime: number;
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
  handleExport: () => void;
  handleImport: (event: ChangeEvent<HTMLInputElement>) => Promise<void>;
  handlePublishCurrentTrip: (nextTripId: string) => Promise<void>;
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
  children: ReactNode;
}

export function FriendsConfigProvider({
  initialConfig,
  initialCronDashboard,
  initialDemoReferenceTime,
  initialAirportTimezones = initialConfig.airportTimezones ?? {},
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
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [jsonNotice, setJsonNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [hasHydrated, setHasHydrated] = useState(false);
  const [airportSuggestions, setAirportSuggestions] = useState<AirportDirectoryResponse['airports']>([]);
  const [airportTimezones, setAirportTimezones] = useState<Record<string, string>>(() => ({ ...initialAirportTimezones }));
  const [activeAirportField, setActiveAirportField] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(normalizedConfig.updatedAt);
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
  const latestCronRun = cronDashboard.history[0] ?? null;

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

    const [friendId, legId, field] = activeAirportField.split(':') as [string, string, 'from' | 'to'];
    const activeFriend = selectedTrip.friends.find((friend) => friend.id === friendId);
    const activeLeg = activeFriend?.flights.find((leg) => leg.id === legId);
    const query = field === 'from' ? activeLeg?.from ?? '' : activeLeg?.to ?? '';

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

    setSavedSnapshot(buildSaveableConfigSnapshot({
      ...normalizedNextConfig,
      currentTripId: normalizedNextConfig.currentTripId ?? nextTrips[0]?.id ?? null,
      cronEnabled: normalizedNextConfig.cronEnabled ?? true,
      trips: nextTrips,
    }, demoReferenceTime));

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

  function handleExport() {
    setJsonNotice(null);

    try {
      const exportPayload = buildExportPayload();
      const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: 'application/json' });
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
      const importedConfig = normalizeFriendsTrackerConfig(
        Array.isArray(parsedValue)
          ? { friends: parsedValue }
          : parsedValue,
        { demoReferenceTime },
      );

      const importedTripCount = Array.isArray(parsedValue)
        ? 1
        : Array.isArray(parsedValue.trips) && parsedValue.trips.length > 0
        ? parsedValue.trips.length
        : 1;

      const importedTrips = importedConfig.trips ?? [];

      setTrips(importedTrips);
      setCurrentTripId(importedConfig.currentTripId ?? importedTrips[0]?.id ?? null);
      setSelectedTripId(importedConfig.currentTripId ?? importedTrips[0]?.id ?? null);
      setCronEnabled(importedConfig.cronEnabled ?? true);
      setLastSavedAt(importedConfig.updatedAt);
      setJsonNotice({
        type: 'success',
        text: `Imported ${importedTripCount} trip${importedTripCount === 1 ? '' : 's'} from JSON. Click "Save config" to persist it.`,
      });
    } catch (error) {
      setJsonNotice({
        type: 'error',
        text: error instanceof Error ? error.message : 'Unable to import the JSON config.',
      });
    }
  }

  async function handlePublishCurrentTrip(nextTripId: string) {
    const previousTripId = currentTripId;
    setCurrentTripId(nextTripId);
    setIsSaving(true);
    setNotice(null);

    try {
      const response = await fetch('/api/chantal/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          updatedBy: 'chantal current trip publish',
          cronEnabled,
          currentTripId: nextTripId,
          trips,
        }),
      });

      const payload = await response.json() as FriendsTrackerConfig & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || 'Unable to publish the selected trip live on /chantal.');
      }

      applySavedConfig(payload);
      setNotice({ type: 'success', text: 'Current /chantal trip updated.' });
    } catch (error) {
      setCurrentTripId(previousTripId);
      setNotice({
        type: 'error',
        text: error instanceof Error ? error.message : 'Unable to publish the selected trip live on /chantal.',
      });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSave() {
    if (!hasPendingChanges) {
      return;
    }

    setIsSaving(true);
    setNotice(null);

    try {
      const response = await fetch('/api/chantal/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          updatedBy: 'chantal config page',
          cronEnabled,
          currentTripId: currentTripId ?? selectedTrip?.id ?? null,
          trips,
        }),
      });

      const payload = await response.json() as FriendsTrackerConfig & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || 'Unable to save the friends tracker config.');
      }

      applySavedConfig(payload);
      setNotice({
        type: 'success',
        text: payload.cronEnabled === false
          ? 'Friends tracker config saved. This Chantal batch remains excluded from the shared cron list.'
          : 'Friends tracker config saved and synced to the shared cron list.',
      });
    } catch (error) {
      setNotice({
        type: 'error',
        text: error instanceof Error ? error.message : 'Unable to save the friends tracker config.',
      });
    } finally {
      setIsSaving(false);
    }
  }

  const value = useMemo<FriendsConfigContextValue>(() => ({
    locale,
    demoReferenceTime,
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
    updateTrip,
    updateSelectedTrip,
    updateSelectedTripFriends,
    updateFriend,
    moveFriendFlight,
    removeTrip,
    addTrip,
    handleCronToggle,
    handleRunCronNow,
    handleExport,
    handleImport,
    handlePublishCurrentTrip,
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
  ]);

  return (
    <FriendsConfigContext.Provider value={value}>
      {children}
    </FriendsConfigContext.Provider>
  );
}
