'use client';

import { useRef, useState, type ChangeEvent } from 'react';
import { useLocale } from 'next-intl';
import { ArrowRight, Clock3, Download, PlaneTakeoff, Play, Plus, RefreshCw, Save, Settings2, Trash2, Upload, Users } from 'lucide-react';
import { Link } from '~/i18n/navigation';
import {
  createEmptyFriendConfig,
  createEmptyFriendFlightLeg,
  extractFriendTrackerIdentifiers,
  normalizeFriendsTrackerConfig,
  type FriendFlightLeg,
  type FriendTravelConfig,
  type FriendsTrackerConfig,
} from '~/lib/friendsTracker';
import type { TrackerCronDashboard, TrackerCronRun } from '~/lib/server/trackerCron';

function createClientId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
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

export function FriendsConfigClient({
  initialConfig,
  initialCronDashboard,
}: {
  initialConfig: FriendsTrackerConfig;
  initialCronDashboard: TrackerCronDashboard;
}) {
  const locale = useLocale();
  const normalizedConfig = normalizeFriendsTrackerConfig(initialConfig);
  const [friends, setFriends] = useState(normalizedConfig.friends);
  const [cronEnabled, setCronEnabled] = useState(normalizedConfig.cronEnabled ?? initialCronDashboard.config.enabled);
  const [cronDashboard, setCronDashboard] = useState(initialCronDashboard);
  const [isSaving, setIsSaving] = useState(false);
  const [isRunningCron, setIsRunningCron] = useState(false);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(normalizedConfig.updatedAt);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const trackedIdentifiers = extractFriendTrackerIdentifiers({ ...normalizedConfig, cronEnabled, friends });
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

  function updateFriend(friendId: string, updater: (friend: FriendTravelConfig) => FriendTravelConfig) {
    setFriends((currentFriends) => currentFriends.map((friend) => friend.id === friendId ? updater(friend) : friend));
  }

  function buildExportPayload(): FriendsTrackerConfig {
    return normalizeFriendsTrackerConfig({
      updatedAt: lastSavedAt,
      updatedBy: normalizedConfig.updatedBy ?? 'chantal config page',
      cronEnabled,
      friends,
    });
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
      );

      setFriends(importedConfig.friends);
      setCronEnabled(importedConfig.cronEnabled ?? true);
      setLastSavedAt(importedConfig.updatedAt);
      setNotice({
        type: 'success',
        text: `Imported ${importedConfig.friends.length} friend${importedConfig.friends.length === 1 ? '' : 's'} from JSON. Click “Save config” to persist it.`,
      });
    } catch (error) {
      setNotice({
        type: 'error',
        text: error instanceof Error ? error.message : 'Unable to import the JSON config.',
      });
    }
  }

  async function handleSave() {
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
          friends,
        }),
      });

      const payload = await response.json() as FriendsTrackerConfig & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || 'Unable to save the friends tracker config.');
      }

      const nextConfig = normalizeFriendsTrackerConfig(payload);
      setFriends(nextConfig.friends);
      setCronEnabled(nextConfig.cronEnabled ?? true);
      setLastSavedAt(nextConfig.updatedAt);
      setCronDashboard((currentDashboard) => ({
        ...currentDashboard,
        config: {
          ...currentDashboard.config,
          enabled: nextConfig.cronEnabled ?? true,
          identifiers: extractFriendTrackerIdentifiers(nextConfig),
          updatedAt: nextConfig.updatedAt,
          updatedBy: nextConfig.updatedBy,
        },
      }));
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
      <section className="rounded-3xl border border-white/10 bg-slate-950/55 p-5 backdrop-blur-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sky-200">
              <Settings2 className="h-4 w-4" />
              <p className="text-xs uppercase tracking-[0.24em]">What this page does</p>
            </div>
            <p className="mt-3 max-w-3xl text-sm text-slate-300">
              Add one card per friend, then add as many flight legs as needed for connections and return trips.
              Each save updates the live `/chantal` view and mirrors the flight identifiers into the tracker cron.
              You can also import a JSON backup or export the full crew config at any time.
            </p>
            <div className="mt-3 text-xs text-slate-400">
              Last saved (UTC): {formatDateTime(lastSavedAt, locale)}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={handleImport}
            />
            <Link
              href="/chantal"
              className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-slate-950/80 px-4 py-2 text-sm font-medium text-slate-100 transition hover:border-white/20 hover:bg-slate-900"
            >
              <ArrowRight className="h-4 w-4" />
              Open map
            </Link>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-slate-950/80 px-4 py-2 text-sm font-medium text-slate-100 transition hover:border-white/20 hover:bg-slate-900"
            >
              <Upload className="h-4 w-4" />
              Import JSON
            </button>
            <button
              type="button"
              onClick={handleExport}
              className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-slate-950/80 px-4 py-2 text-sm font-medium text-slate-100 transition hover:border-white/20 hover:bg-slate-900"
            >
              <Download className="h-4 w-4" />
              Export JSON
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="inline-flex items-center gap-2 rounded-full bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isSaving}
            >
              {isSaving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {isSaving ? 'Saving…' : 'Save config'}
            </button>
          </div>
        </div>

        {notice ? (
          <div className={`mt-4 rounded-2xl border px-4 py-3 text-sm ${notice.type === 'success'
            ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-100'
            : 'border-rose-400/40 bg-rose-500/10 text-rose-100'}`}
          >
            {notice.text}
          </div>
        ) : null}
      </section>

      <section className="rounded-3xl border border-white/10 bg-slate-950/55 p-5 backdrop-blur-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sky-200">
              <Clock3 className="h-4 w-4" />
              <p className="text-xs uppercase tracking-[0.24em]">Background prefetch cron</p>
            </div>
            <p className="mt-3 max-w-3xl text-sm text-slate-300">
              Reuse the same shared cron as `/tracker/cron` to precompute crew telemetry and keep completed legs visible on the map.
              You can turn it on or off here, then save the crew config to sync the setting.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-slate-200">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-500 bg-slate-950"
                checked={cronEnabled}
                onChange={(event) => setCronEnabled(event.target.checked)}
              />
              Enabled
            </label>
            <button
              type="button"
              onClick={handleRunCronNow}
              disabled={isRunningCron || trackedIdentifiers.length === 0}
              className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-slate-950/80 px-4 py-2 text-sm font-medium text-slate-100 transition hover:border-white/20 hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isRunningCron ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {isRunningCron ? 'Running…' : 'Run now'}
            </button>
            <Link
              href="/tracker/cron"
              className="inline-flex items-center gap-2 rounded-full border border-sky-400/40 bg-sky-500/10 px-4 py-2 text-sm font-medium text-sky-100 transition hover:bg-sky-500/20"
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
            <div className="mt-1 text-xs text-slate-400">{cronEnabled ? 'Cron ready for crew flight refreshes.' : 'Cron currently paused.'}</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-3 text-sm text-slate-200">
            <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Latest run</div>
            <div className="mt-1 font-semibold text-white">{formatDateTime(latestCronRun?.startedAt ?? null, locale)}</div>
            <div className="mt-1 text-xs text-slate-400">{latestCronRun ? latestCronRun.status : 'No runs yet'}</div>
          </div>
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-slate-300">
          <Users className="h-4 w-4 text-sky-300" />
          <span>{friends.length} friends configured</span>
        </div>
        <button
          type="button"
          onClick={() => setFriends((currentFriends) => [...currentFriends, createDraftFriend()])}
          className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-slate-950/80 px-4 py-2 text-sm font-medium text-slate-100 transition hover:border-white/20 hover:bg-slate-900"
        >
          <Plus className="h-4 w-4" />
          Add friend
        </button>
      </div>

      {friends.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-white/10 bg-slate-950/35 p-8 text-center text-sm text-slate-400">
          No friends yet. Create the first itinerary card to start populating the `/chantal` map.
        </div>
      ) : null}

      <div className="space-y-4">
        {friends.map((friend, friendIndex) => (
          <section key={friend.id} className="rounded-3xl border border-white/10 bg-slate-950/55 p-5 backdrop-blur-sm">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
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
              </div>

              <button
                type="button"
                onClick={() => setFriends((currentFriends) => currentFriends.filter((currentFriend) => currentFriend.id !== friend.id))}
                className="inline-flex items-center gap-2 self-start rounded-full border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm font-medium text-rose-100 transition hover:bg-rose-500/20"
              >
                <Trash2 className="h-4 w-4" />
                Remove friend
              </button>
            </div>

            <div className="mt-4 space-y-3">
              {friend.flights.map((leg, legIndex) => (
                <div key={leg.id} className="rounded-2xl border border-white/10 bg-slate-950/70 p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-sm font-semibold text-white">
                      <PlaneTakeoff className="h-4 w-4 text-sky-300" />
                      <span>Leg {legIndex + 1}</span>
                    </div>
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

                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                    <div className="xl:col-span-1">
                      <label className="mb-2 block text-xs font-medium uppercase tracking-[0.2em] text-slate-400">Flight number</label>
                      <input
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
    </div>
  );
}
