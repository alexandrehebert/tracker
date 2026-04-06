'use client';

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useLocale } from 'next-intl';
import { ArrowDown, ArrowRight, ArrowUp, Camera, Clock3, Download, MapPin, PlaneTakeoff, Play, Plus, RefreshCw, Save, Settings2, Trash2, Upload, Users, X } from 'lucide-react';
import { Link } from '~/i18n/navigation';
import {
  createEmptyFriendConfig,
  createEmptyFriendFlightLeg,
  createEmptyTripConfig,
  extractFriendTrackerIdentifiers,
  getCurrentTripConfig,
  normalizeFriendsTrackerConfig,
  type FriendFlightLeg,
  type FriendTravelConfig,
  type FriendsTrackerConfig,
  type FriendsTrackerTripConfig,
} from '~/lib/friendsTracker';
import { getFriendInitials } from '~/lib/utils/friendInitials';
import type { TrackerCronDashboard, TrackerCronRun } from '~/lib/server/trackerCron';

async function resizeImageToDataUrl(file: File, size = 80): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Could not get canvas context'));
          return;
        }

        const sourceSize = Math.min(img.width, img.height);
        const offsetX = (img.width - sourceSize) / 2;
        const offsetY = (img.height - sourceSize) / 2;
        ctx.drawImage(img, offsetX, offsetY, sourceSize, sourceSize, 0, 0, size, size);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = event.target?.result as string;
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

function createClientId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function moveArrayItem<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= items.length || toIndex >= items.length) {
    return items;
  }

  const nextItems = [...items];
  const [movedItem] = nextItems.splice(fromIndex, 1);

  if (movedItem == null) {
    return items;
  }

  nextItems.splice(toIndex, 0, movedItem);
  return nextItems;
}

function toDateTimeLocalValue(value: string): string {
  if (!value) {
    return '';
  }

  const parsedTime = Date.parse(value);
  if (Number.isNaN(parsedTime)) {
    return '';
  }

  const date = new Date(parsedTime);
  const timezoneOffsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(parsedTime - timezoneOffsetMs).toISOString().slice(0, 16);
}

function fromDateTimeLocalValue(value: string): string {
  return value ? new Date(value).toISOString() : '';
}

function formatDateTime(value: number | null, locale: string): string {
  if (!value) {
    return '—';
  }

  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(value);
}

function buildSaveableConfigSnapshot(config: FriendsTrackerConfig, demoReferenceTime?: number): string {
  const normalized = normalizeFriendsTrackerConfig(
    config,
    demoReferenceTime == null ? undefined : { demoReferenceTime },
  );

  return JSON.stringify({
    currentTripId: normalized.currentTripId ?? null,
    cronEnabled: normalized.cronEnabled ?? true,
    trips: normalized.trips ?? [],
  });
}

function createDraftFriend(): FriendTravelConfig {
  const friend = createEmptyFriendConfig();
  return {
    ...friend,
    id: createClientId('friend'),
    name: '',
    flights: [{
      ...createEmptyFriendFlightLeg(),
      id: createClientId('leg'),
    }],
  };
}

function createDraftLeg(): FriendFlightLeg {
  return {
    ...createEmptyFriendFlightLeg(),
    id: createClientId('leg'),
  };
}

function createDraftTrip(): FriendsTrackerTripConfig {
  const trip = createEmptyTripConfig();
  return {
    ...trip,
    id: createClientId('trip'),
    name: 'New trip',
  };
}

function ToggleSwitch({
  checked,
  onToggle,
  label,
  disabled = false,
  pending = false,
}: {
  checked: boolean;
  onToggle: (nextValue: boolean) => void;
  label: string;
  disabled?: boolean;
  pending?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onToggle(!checked)}
      className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-slate-900/80 px-2.5 py-1.5 text-xs text-slate-100 transition hover:border-cyan-400/40 hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-70"
    >
      <span
        className={`relative inline-flex h-5 w-9 items-center rounded-full transition ${checked ? 'bg-emerald-500/90' : 'bg-slate-700'}`}
        aria-hidden="true"
      >
        <span
          className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition ${checked ? 'translate-x-4' : 'translate-x-0.5'}`}
        />
      </span>
      <span className="font-medium">{pending ? 'Saving…' : checked ? 'On' : 'Off'}</span>
    </button>
  );
}

export function FriendsConfigClient({
  initialConfig,
  initialCronDashboard,
  initialDemoReferenceTime,
}: {
  initialConfig: FriendsTrackerConfig;
  initialCronDashboard: TrackerCronDashboard;
  initialDemoReferenceTime?: number;
}) {
  const locale = useLocale();
  const [demoReferenceTime] = useState(() => initialDemoReferenceTime ?? Date.now());
  const normalizedConfig = normalizeFriendsTrackerConfig(initialConfig, { demoReferenceTime });
  const initialCurrentTrip = getCurrentTripConfig(normalizedConfig);
  const [trips, setTrips] = useState(normalizedConfig.trips ?? []);
  const [currentTripId, setCurrentTripId] = useState<string | null>(normalizedConfig.currentTripId ?? initialCurrentTrip?.id ?? null);
  const [selectedTripId, setSelectedTripId] = useState<string | null>(normalizedConfig.currentTripId ?? initialCurrentTrip?.id ?? normalizedConfig.trips?.[0]?.id ?? null);
  const [cronEnabled, setCronEnabled] = useState(normalizedConfig.cronEnabled ?? initialCronDashboard.config.enabled);
  const [cronDashboard, setCronDashboard] = useState(initialCronDashboard);
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingCronToggle, setIsSavingCronToggle] = useState(false);
  const [isRunningCron, setIsRunningCron] = useState(false);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(normalizedConfig.updatedAt);
  const [savedSnapshot, setSavedSnapshot] = useState(() => buildSaveableConfigSnapshot({
    ...normalizedConfig,
    currentTripId: normalizedConfig.currentTripId ?? initialCurrentTrip?.id ?? normalizedConfig.trips?.[0]?.id ?? null,
    cronEnabled: normalizedConfig.cronEnabled ?? initialCronDashboard.config.enabled,
    trips: normalizedConfig.trips ?? [],
  }, demoReferenceTime));
  const [tripPendingRemovalId, setTripPendingRemovalId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const selectedTrip = trips.find((trip) => trip.id === selectedTripId) ?? trips[0] ?? null;
  const currentTrip = trips.find((trip) => trip.id === currentTripId) ?? selectedTrip;
  const tripPendingRemoval = trips.find((trip) => trip.id === tripPendingRemovalId) ?? null;
  const friends = selectedTrip?.friends ?? [];
  const destinationAirport = selectedTrip?.destinationAirport ?? '';
  const currentSnapshot = buildSaveableConfigSnapshot(buildExportPayload(), demoReferenceTime);
  const hasPendingChanges = currentSnapshot !== savedSnapshot;
  const trackedIdentifiers = extractFriendTrackerIdentifiers(buildExportPayload());
  const latestCronRun = cronDashboard.history[0] ?? null;

  async function refreshCronDashboard() {
    const response = await fetch('/api/tracker/cron/config', { cache: 'no-store' });
    const payload = await response.json() as TrackerCronDashboard & { error?: string };

    if (!response.ok) {
      throw new Error(payload.error || 'Unable to refresh the background cron status.');
    }

    setCronDashboard(payload);
    setCronEnabled(payload.config.enabled);
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

  function removeTrip(tripId: string) {
    const remainingTrips = trips.filter((trip) => trip.id !== tripId);
    const fallbackTrip = remainingTrips.find((trip) => !trip.isDemo) ?? remainingTrips[0] ?? null;

    setTrips(remainingTrips);
    setSelectedTripId(fallbackTrip?.id ?? null);

    if (currentTripId === tripId) {
      setCurrentTripId(fallbackTrip?.id ?? null);
    }
  }

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
    setSavedSnapshot(buildSaveableConfigSnapshot({
      ...normalizedNextConfig,
      currentTripId: normalizedNextConfig.currentTripId ?? nextTrips[0]?.id ?? null,
      cronEnabled: normalizedNextConfig.cronEnabled ?? true,
      trips: nextTrips,
    }, demoReferenceTime));
    setCronDashboard((currentDashboard) => ({
      ...currentDashboard,
      config: {
        ...currentDashboard.config,
        enabled: normalizedNextConfig.cronEnabled ?? true,
        identifiers: extractFriendTrackerIdentifiers(normalizedNextConfig),
        updatedAt: normalizedNextConfig.updatedAt,
        updatedBy: normalizedNextConfig.updatedBy,
      },
    }));

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
        headers: {
          'Content-Type': 'application/json',
        },
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
        text: `Background prefetch cron ${nextConfig.cronEnabled ?? nextValue ? 'enabled' : 'disabled'} and saved.`,
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
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          trigger: 'manual-admin',
          identifiers: trackedIdentifiers,
          requestedBy: 'chantal config page',
        }),
      });

      const payload = await response.json() as TrackerCronRun & { error?: string };
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

      setNotice({ type: 'success', text: 'JSON export downloaded successfully.' });
    } catch (error) {
      setNotice({
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
      setNotice({
        type: 'success',
        text: `Imported ${importedTripCount} trip${importedTripCount === 1 ? '' : 's'} from JSON. Click “Save config” to persist it.`,
      });
    } catch (error) {
      setNotice({
        type: 'error',
        text: error instanceof Error ? error.message : 'Unable to import the JSON config.',
      });
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
        headers: {
          'Content-Type': 'application/json',
        },
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
      setNotice({ type: 'success', text: 'Friends tracker config saved and synced to the background prefetch cron.' });
    } catch (error) {
      setNotice({
        type: 'error',
        text: error instanceof Error ? error.message : 'Unable to save the friends tracker config.',
      });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-white/10 bg-slate-950/55 p-4 backdrop-blur-sm sm:p-5">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sky-200">
              <Settings2 className="h-4 w-4" />
              <p className="text-xs uppercase tracking-[0.24em]">Workspace overview</p>
            </div>

            <div>
              <h2 className="text-xl font-semibold text-white sm:text-2xl">Set up the live Chantal group trip</h2>
              <p className="mt-2 max-w-3xl text-sm text-slate-300">
                Choose the trip you want to edit, set its meeting airport, update friend itineraries below, then save when you are ready to publish the latest setup on `/chantal`.
              </p>
            </div>

            <div className="flex flex-wrap gap-2 text-xs text-slate-300">
              <span className="rounded-full border border-white/10 bg-slate-900/80 px-3 py-1.5">
                Editing: <span className="font-semibold text-white">{selectedTrip?.name ?? 'No trip selected'}</span>
              </span>
              <span className="rounded-full border border-white/10 bg-slate-900/80 px-3 py-1.5">
                Live map: <span className="font-semibold text-white">{currentTrip?.name ?? '—'}</span>
              </span>
              <span className="rounded-full border border-white/10 bg-slate-900/80 px-3 py-1.5">
                Last saved (UTC): <span className="font-semibold text-white">{formatDateTime(lastSavedAt, locale)}</span>
              </span>
            </div>

            <div className="rounded-2xl border border-cyan-400/20 bg-cyan-500/10 px-4 py-3 text-xs text-cyan-50">
              Changes stay local until you click <span className="font-semibold">Save config</span> in the sticky bar below.
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 xl:min-w-[22rem]">
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={handleImport}
            />
            <Link
              href="/chantal"
              className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-white/12 bg-slate-950/80 px-4 py-2 text-sm font-medium text-slate-100 transition hover:border-white/20 hover:bg-slate-900"
            >
              <ArrowRight className="h-4 w-4" />
              Preview map
            </Link>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-white/12 bg-slate-950/80 px-4 py-2 text-sm font-medium text-slate-100 transition hover:border-white/20 hover:bg-slate-900"
            >
              <Upload className="h-4 w-4" />
              Import JSON
            </button>
            <button
              type="button"
              onClick={handleExport}
              className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-white/12 bg-slate-950/80 px-4 py-2 text-sm font-medium text-slate-100 transition hover:border-white/20 hover:bg-slate-900 sm:col-span-2"
            >
              <Download className="h-4 w-4" />
              Export current JSON
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-white/10 bg-slate-950/55 p-4 backdrop-blur-sm sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sky-200">
              <Users className="h-4 w-4" />
              <p className="text-xs uppercase tracking-[0.24em]">Group trips</p>
            </div>
            <p className="mt-3 max-w-3xl text-sm text-slate-300">
              Keep each destination in its own trip, quickly switch which one you are editing, and decide which trip should currently power the live `/chantal` page.
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              const newTrip = createDraftTrip();
              setTrips((currentTrips) => [...currentTrips, newTrip]);
              setSelectedTripId(newTrip.id);
            }}
            className="inline-flex w-full items-center justify-center gap-2 self-start rounded-full border border-white/12 bg-slate-950/80 px-4 py-2 text-sm font-medium text-slate-100 transition hover:border-white/20 hover:bg-slate-900 sm:w-auto"
          >
            <Plus className="h-4 w-4" />
            Add trip
          </button>
        </div>

        {trips.length > 0 ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {trips.map((trip, index) => {
              const isSelected = trip.id === selectedTripId;
              const isCurrent = trip.id === currentTripId;

              return (
                <button
                  key={trip.id}
                  type="button"
                  onClick={() => setSelectedTripId(trip.id)}
                  className={`rounded-2xl border p-4 text-left transition ${isSelected
                    ? 'border-cyan-400/50 bg-cyan-500/10 shadow-lg shadow-cyan-950/10'
                    : 'border-white/10 bg-slate-950/70 hover:border-white/20 hover:bg-slate-900/80'}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-white">{trip.name || `Untitled trip ${index + 1}`}</div>
                      <p className="mt-1 text-xs text-slate-400">
                        {trip.friends.length} friend{trip.friends.length === 1 ? '' : 's'} • {trip.destinationAirport || 'No destination yet'}
                      </p>
                    </div>
                    {isCurrent ? (
                      <span className="rounded-full border border-emerald-400/40 bg-emerald-500/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-100">
                        Live
                      </span>
                    ) : null}
                  </div>

                  <p className={`mt-3 text-xs ${isSelected ? 'text-cyan-100' : 'text-slate-400'}`}>
                    {trip.isDemo
                      ? 'Built-in demo using TEST1, TEST2, and TEST3.'
                      : isSelected
                        ? 'Currently open below.'
                        : 'Tap to edit this trip.'}
                  </p>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="mt-4 rounded-2xl border border-dashed border-white/10 bg-slate-950/35 p-5 text-sm text-slate-400">
            No trips yet. Add one to start building the next group journey.
          </div>
        )}

        {selectedTrip ? (
          <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,0.85fr)]">
            <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-4">
              <p className="text-xs uppercase tracking-[0.24em] text-sky-200">Trip details</p>

              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div className="md:col-span-2">
                  <label className="mb-2 block text-xs font-medium uppercase tracking-[0.2em] text-slate-400">
                    Trip name
                  </label>
                  <input
                    value={selectedTrip.name}
                    onChange={(event) => {
                      const name = event.target.value;
                      updateSelectedTrip((trip) => ({
                        ...trip,
                        name,
                      }));
                    }}
                    placeholder="Weekend in Lisbon"
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/90 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-500/20"
                  />
                </div>

                <div>
                  <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.2em] text-slate-400">
                    <MapPin className="h-3.5 w-3.5" />
                    Meeting destination
                  </div>
                  <input
                    value={destinationAirport}
                    onChange={(event) => {
                      const nextDestinationAirport = event.target.value.toUpperCase();
                      updateSelectedTrip((trip) => ({
                        ...trip,
                        destinationAirport: nextDestinationAirport,
                      }));
                    }}
                    placeholder="e.g. MIA, LIS, CDG"
                    maxLength={10}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/90 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-500/20"
                  />
                  <p className="mt-2 text-xs text-slate-400">
                    Match the airport used in each leg&apos;s “To” field, such as `MIA`, `LIS`, or `KMIA`.
                  </p>
                </div>

                <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-3 text-sm text-slate-300">
                  <div className="text-xs uppercase tracking-[0.2em] text-slate-400">How this is used</div>
                  <p className="mt-2">
                    The meeting airport lets the Chantal map decide which legs belong to the outbound trip and which ones are part of the return.
                  </p>
                  <p className="mt-2 text-xs text-slate-400">
                    {selectedTrip.id === currentTripId
                      ? 'This trip is already the one shown live on `/chantal`.'
                      : 'This trip stays as a draft until you set it as current and save.'}
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-4">
              <p className="text-xs uppercase tracking-[0.24em] text-sky-200">Publishing</p>

              <div className="mt-3 space-y-3">
                <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-3 text-sm text-slate-200">
                  <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Shown right now on `/chantal`</div>
                  <div className="mt-1 font-semibold text-white">{currentTrip?.name ?? '—'}</div>
                  <div className="mt-1 text-xs text-slate-400">
                    {selectedTrip.id === currentTripId ? 'This trip is already live.' : 'Switch to this trip when you are ready, then save.'}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setCurrentTripId(selectedTrip.id)}
                  className={`inline-flex w-full items-center justify-center rounded-full px-4 py-2 text-sm font-medium transition ${selectedTrip.id === currentTripId
                    ? 'border border-emerald-400/40 bg-emerald-500/10 text-emerald-100'
                    : 'border border-sky-400/40 bg-sky-500/10 text-sky-100 hover:bg-sky-500/20'}`}
                >
                  {selectedTrip.id === currentTripId ? 'Current on /chantal' : 'Set as current trip'}
                </button>

                {!selectedTrip.isDemo ? (
                  <button
                    type="button"
                    onClick={() => setTripPendingRemovalId(selectedTrip.id)}
                    className="inline-flex w-full items-center justify-center rounded-full border border-rose-400/30 bg-rose-500/10 px-4 py-2 text-sm font-medium text-rose-100 transition hover:bg-rose-500/20"
                  >
                    Remove this trip
                  </button>
                ) : (
                  <div className="rounded-2xl border border-sky-400/30 bg-sky-500/10 px-4 py-3 text-sm text-sky-100">
                    Built-in demo trip — handy for TEST1, TEST2, and TEST3 validation.
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </section>

      <section className="sticky top-3 z-20 rounded-2xl border border-white/10 bg-slate-950/90 p-3 shadow-lg shadow-slate-950/25 backdrop-blur">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-semibold text-white">
              {notice ? (notice.type === 'success' ? 'Update ready' : 'Please review this message') : 'Ready to publish your changes?'}
            </p>
            <p className={`text-xs ${notice
              ? notice.type === 'success'
                ? 'text-emerald-200'
                : 'text-rose-200'
              : 'text-slate-400'}`}
            >
              {notice?.text ?? (hasPendingChanges
                ? 'Saving syncs the selected live trip, meeting airport, and shared cron identifiers used by the tracker.'
                : 'All changes are already saved. Make any edit to enable Save config.')}
            </p>
          </div>

          <button
            type="button"
            onClick={handleSave}
            className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-60 md:w-auto"
            disabled={!hasPendingChanges || isSaving || isSavingCronToggle}
          >
            {isSaving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {isSaving ? 'Saving…' : 'Save config'}
          </button>
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-slate-300">
          <Users className="h-4 w-4 text-sky-300" />
          <span>{friends.length} friends configured for {selectedTrip?.name ?? 'this trip'}</span>
        </div>
        <button
          type="button"
          onClick={() => updateSelectedTripFriends((currentFriends) => [...currentFriends, createDraftFriend()])}
          className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-slate-950/80 px-4 py-2 text-sm font-medium text-slate-100 transition hover:border-white/20 hover:bg-slate-900"
        >
          <Plus className="h-4 w-4" />
          Add friend
        </button>
      </div>

      {friends.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-white/10 bg-slate-950/35 p-8 text-center text-sm text-slate-400">
          No friends yet for {selectedTrip?.name ?? 'this trip'}. Create the first itinerary card to start populating the `/chantal` map.
        </div>
      ) : null}

      <div className="space-y-4">
        {friends.map((friend, friendIndex) => (
          <section key={friend.id} className="rounded-3xl border border-white/10 bg-slate-950/55 p-5 backdrop-blur-sm">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex items-start gap-4">
                <div className="relative shrink-0">
                  <div
                    className="relative h-16 w-16 cursor-pointer overflow-hidden rounded-full border-2 border-white/20 bg-slate-800 transition hover:border-cyan-400/60"
                    title="Click to upload avatar photo"
                    onClick={() => {
                      const input = document.createElement('input');
                      input.type = 'file';
                      input.accept = 'image/*';
                      input.onchange = async (event) => {
                        const file = (event.target as HTMLInputElement).files?.[0];
                        if (!file) return;
                        try {
                          const dataUrl = await resizeImageToDataUrl(file);
                          updateFriend(friend.id, (currentFriend) => ({
                            ...currentFriend,
                            avatarUrl: dataUrl,
                          }));
                        } catch {
                          /* ignore */
                        }
                      };
                      input.click();
                    }}
                  >
                    {friend.avatarUrl ? (
                      <img
                        src={friend.avatarUrl}
                        alt={friend.name || `Friend ${friendIndex + 1}`}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-lg font-bold text-white/60">
                        {getFriendInitials(friend.name || `F${friendIndex + 1}`)}
                      </div>
                    )}
                    <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-0 transition hover:opacity-100">
                      <Camera className="h-5 w-5 text-white" />
                    </div>
                  </div>
                  {friend.avatarUrl ? (
                    <button
                      type="button"
                      title="Remove avatar"
                      className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full border border-white/20 bg-rose-500/80 text-white transition hover:bg-rose-500"
                      onClick={() => {
                        updateFriend(friend.id, (currentFriend) => ({
                          ...currentFriend,
                          avatarUrl: null,
                        }));
                      }}
                    >
                      <span className="text-[10px] font-bold leading-none">×</span>
                    </button>
                  ) : null}
                </div>

                <div className="flex-1">
                  <label className="mb-2 block text-xs font-medium uppercase tracking-[0.2em] text-slate-400">
                    Friend name
                  </label>
                  <input
                    value={friend.name}
                    onChange={(event) => {
                      const name = event.target.value;
                      updateFriend(friend.id, (currentFriend) => ({
                        ...currentFriend,
                        name,
                      }));
                    }}
                    placeholder={`Friend ${friendIndex + 1}`}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/90 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-500/20"
                  />
                  <p className="mt-1.5 text-xs text-slate-500">Click the avatar to upload a photo (shown as bubble on map)</p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => updateSelectedTripFriends((currentFriends) => currentFriends.filter((currentFriend) => currentFriend.id !== friend.id))}
                className="inline-flex items-center gap-2 self-start rounded-full border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm font-medium text-rose-100 transition hover:bg-rose-500/20"
              >
                <Trash2 className="h-4 w-4" />
                Remove friend
              </button>
            </div>

            <div className="mt-4 space-y-3">
              {friend.flights.map((leg, legIndex) => (
                <div key={leg.id} className="rounded-2xl border border-white/10 bg-slate-950/70 p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-sm font-semibold text-white">
                      <PlaneTakeoff className="h-4 w-4 text-sky-300" />
                      <span>Leg {legIndex + 1}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        aria-label={`Move leg ${legIndex + 1} up`}
                        disabled={legIndex === 0}
                        onClick={() => moveFriendFlight(friend.id, legIndex, -1)}
                        className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-slate-900/80 px-2.5 py-1.5 text-xs font-medium text-slate-200 transition hover:border-white/20 hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">Up</span>
                      </button>
                      <button
                        type="button"
                        aria-label={`Move leg ${legIndex + 1} down`}
                        disabled={legIndex === friend.flights.length - 1}
                        onClick={() => moveFriendFlight(friend.id, legIndex, 1)}
                        className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-slate-900/80 px-2.5 py-1.5 text-xs font-medium text-slate-200 transition hover:border-white/20 hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">Down</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          updateFriend(friend.id, (currentFriend) => ({
                            ...currentFriend,
                            flights: currentFriend.flights.length > 1
                              ? currentFriend.flights.filter((currentLeg) => currentLeg.id !== leg.id)
                              : [createDraftLeg()],
                          }));
                        }}
                        className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-slate-900/80 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:border-white/20 hover:bg-slate-900"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Remove leg
                      </button>
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                    <div className="xl:col-span-1">
                      <label className="mb-2 block text-xs font-medium uppercase tracking-[0.2em] text-slate-400">Flight number</label>
                      <input
                        aria-label={`Flight number for leg ${legIndex + 1}`}
                        value={leg.flightNumber}
                        onChange={(event) => {
                          const flightNumber = event.target.value;
                          updateFriend(friend.id, (currentFriend) => ({
                            ...currentFriend,
                            flights: currentFriend.flights.map((currentLeg) => currentLeg.id === leg.id
                              ? { ...currentLeg, flightNumber }
                              : currentLeg),
                          }));
                        }}
                        placeholder="AF123"
                        className="w-full rounded-2xl border border-white/10 bg-slate-950/90 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-500/20"
                      />
                    </div>
                    <div className="xl:col-span-1">
                      <label className="mb-2 block text-xs font-medium uppercase tracking-[0.2em] text-slate-400">Estimated departure</label>
                      <input
                        type="datetime-local"
                        value={toDateTimeLocalValue(leg.departureTime)}
                        onChange={(event) => {
                          const departureTime = fromDateTimeLocalValue(event.target.value);
                          updateFriend(friend.id, (currentFriend) => ({
                            ...currentFriend,
                            flights: currentFriend.flights.map((currentLeg) => currentLeg.id === leg.id
                              ? { ...currentLeg, departureTime }
                              : currentLeg),
                          }));
                        }}
                        className="w-full rounded-2xl border border-white/10 bg-slate-950/90 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-500/20"
                      />
                    </div>
                    <div>
                      <label className="mb-2 block text-xs font-medium uppercase tracking-[0.2em] text-slate-400">From</label>
                      <input
                        value={leg.from ?? ''}
                        onChange={(event) => {
                          const from = event.target.value;
                          updateFriend(friend.id, (currentFriend) => ({
                            ...currentFriend,
                            flights: currentFriend.flights.map((currentLeg) => currentLeg.id === leg.id
                              ? { ...currentLeg, from }
                              : currentLeg),
                          }));
                        }}
                        placeholder="CDG"
                        className="w-full rounded-2xl border border-white/10 bg-slate-950/90 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-500/20"
                      />
                    </div>
                    <div>
                      <label className="mb-2 block text-xs font-medium uppercase tracking-[0.2em] text-slate-400">To</label>
                      <input
                        value={leg.to ?? ''}
                        onChange={(event) => {
                          const to = event.target.value;
                          updateFriend(friend.id, (currentFriend) => ({
                            ...currentFriend,
                            flights: currentFriend.flights.map((currentLeg) => currentLeg.id === leg.id
                              ? { ...currentLeg, to }
                              : currentLeg),
                          }));
                        }}
                        placeholder="LIS"
                        className="w-full rounded-2xl border border-white/10 bg-slate-950/90 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-500/20"
                      />
                    </div>
                    <div>
                      <label className="mb-2 block text-xs font-medium uppercase tracking-[0.2em] text-slate-400">Note</label>
                      <input
                        value={leg.note ?? ''}
                        onChange={(event) => {
                          const note = event.target.value;
                          updateFriend(friend.id, (currentFriend) => ({
                            ...currentFriend,
                            flights: currentFriend.flights.map((currentLeg) => currentLeg.id === leg.id
                              ? { ...currentLeg, note }
                              : currentLeg),
                          }));
                        }}
                        placeholder="Connection in AMS"
                        className="w-full rounded-2xl border border-white/10 bg-slate-950/90 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-500/20"
                      />
                    </div>
                  </div>

                  {leg.resolvedIcao24 ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-300">
                      <span className="rounded-full border border-cyan-400/30 bg-cyan-500/10 px-2.5 py-1 text-cyan-100">
                        Locked ICAO24: {leg.resolvedIcao24}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          updateFriend(friend.id, (currentFriend) => ({
                            ...currentFriend,
                            flights: currentFriend.flights.map((currentLeg) => currentLeg.id === leg.id
                              ? { ...currentLeg, resolvedIcao24: null, lastResolvedAt: null }
                              : currentLeg),
                          }));
                        }}
                        className="rounded-full border border-white/10 bg-slate-900/80 px-2.5 py-1 font-medium text-slate-200 transition hover:border-white/20 hover:bg-slate-900"
                      >
                        Clear lock
                      </button>
                    </div>
                  ) : null}
                </div>
              ))}

              <button
                type="button"
                onClick={() => {
                  updateFriend(friend.id, (currentFriend) => ({
                    ...currentFriend,
                    flights: [...currentFriend.flights, createDraftLeg()],
                  }));
                }}
                className="inline-flex items-center gap-2 rounded-full border border-dashed border-sky-400/40 bg-sky-500/10 px-3 py-2 text-sm font-medium text-sky-100 transition hover:bg-sky-500/20"
              >
                <Plus className="h-4 w-4" />
                Add connection / next leg
              </button>
            </div>
          </section>
        ))}
      </div>

      <section className="rounded-3xl border border-white/10 bg-slate-950/55 p-4 backdrop-blur-sm sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sky-200">
              <Clock3 className="h-4 w-4" />
              <p className="text-xs uppercase tracking-[0.24em]">Background prefetch cron</p>
            </div>
            <p className="mt-3 max-w-3xl text-sm text-slate-300">
              This stays separate from trip editing so the itinerary builder remains focused. Toggling the cron saves immediately, while itinerary edits still wait for “Save config”.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <ToggleSwitch
              checked={cronEnabled}
              onToggle={handleCronToggle}
              label="Enable or disable the Chantal background prefetch cron"
              disabled={isSaving || isSavingCronToggle}
              pending={isSavingCronToggle}
            />
            <button
              type="button"
              onClick={handleRunCronNow}
              disabled={isRunningCron || trackedIdentifiers.length === 0}
              className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-white/12 bg-slate-950/80 px-4 py-2 text-sm font-medium text-slate-100 transition hover:border-white/20 hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            >
              {isRunningCron ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {isRunningCron ? 'Running…' : 'Run now'}
            </button>
            <Link
              href="/tracker/cron"
              className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-sky-400/40 bg-sky-500/10 px-4 py-2 text-sm font-medium text-sky-100 transition hover:bg-sky-500/20 sm:w-auto"
            >
              Full cron admin
            </Link>
          </div>
        </div>

        {!cronDashboard.mongoConfigured ? (
          <div className="mt-4 rounded-2xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
            MongoDB is not configured, so cron state and history cannot be persisted.
          </div>
        ) : null}

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-3 text-sm text-slate-200">
            <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Schedule</div>
            <div className="mt-1 font-semibold text-white">Every 15 minutes</div>
            <div className="mt-1 text-xs text-slate-400">{cronDashboard.config.schedule}</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-3 text-sm text-slate-200">
            <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Tracked identifiers</div>
            <div className="mt-1 font-semibold text-white">{trackedIdentifiers.length}</div>
            <div className="mt-1 text-xs text-slate-400">
              {cronEnabled ? `Currently tracking ${currentTrip?.name ?? 'the selected trip'}.` : 'Cron currently paused.'}
            </div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-3 text-sm text-slate-200">
            <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Latest run</div>
            <div className="mt-1 font-semibold text-white">{formatDateTime(latestCronRun?.startedAt ?? null, locale)}</div>
            <div className="mt-1 text-xs text-slate-400">{latestCronRun ? latestCronRun.status : 'No runs yet'}</div>
          </div>
        </div>
      </section>

      {tripPendingRemoval ? (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm"
          onClick={() => setTripPendingRemovalId(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Confirm trip removal"
            className="w-full max-w-md overflow-hidden rounded-3xl border border-rose-400/30 bg-slate-950/95 shadow-2xl shadow-rose-950/20"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-white/10 px-4 py-3">
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-rose-200">Remove trip</p>
                <h3 className="mt-1 text-lg font-semibold text-white">{tripPendingRemoval.name || 'Untitled trip'}</h3>
              </div>
              <button
                type="button"
                onClick={() => setTripPendingRemovalId(null)}
                className="rounded-full border border-white/10 bg-slate-900/80 p-2 text-slate-200 transition hover:border-white/20 hover:bg-slate-800"
                aria-label="Close remove trip confirmation"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3 px-4 py-4 text-sm text-slate-300">
              <p>
                Remove this trip from the editor? This only updates the local form until you click <span className="font-semibold text-white">Save config</span>.
              </p>
              <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-3 text-xs text-slate-300">
                <div>{tripPendingRemoval.friends.length} friend{tripPendingRemoval.friends.length === 1 ? '' : 's'} in this trip</div>
                <div className="mt-1">Meeting airport: {tripPendingRemoval.destinationAirport || 'Not set yet'}</div>
              </div>
            </div>

            <div className="flex flex-col-reverse gap-2 border-t border-white/10 px-4 py-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setTripPendingRemovalId(null)}
                className="inline-flex items-center justify-center rounded-full border border-white/10 bg-slate-900/80 px-4 py-2 text-sm font-medium text-slate-100 transition hover:border-white/20 hover:bg-slate-900"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const removedTripName = tripPendingRemoval.name || 'Trip';
                  removeTrip(tripPendingRemoval.id);
                  setTripPendingRemovalId(null);
                  setNotice({
                    type: 'success',
                    text: `${removedTripName} removed locally. Click “Save config” to persist the change.`,
                  });
                }}
                className="inline-flex items-center justify-center rounded-full border border-rose-400/30 bg-rose-500/10 px-4 py-2 text-sm font-medium text-rose-100 transition hover:bg-rose-500/20"
              >
                Remove trip
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
