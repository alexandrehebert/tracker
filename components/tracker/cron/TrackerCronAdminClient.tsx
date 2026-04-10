'use client';

import { useLocale } from 'next-intl';
import { useEffect, useMemo, useState, type FormEvent, type UIEvent } from 'react';
import type { TrackerCronDashboard, TrackerCronRun, TrackerCronRunStatus } from '~/lib/server/trackerCron';

const HISTORY_PAGE_SIZE = 10;

function formatDateTime(value: number | null, formatter: Intl.DateTimeFormat): string {
  if (!value) {
    return '—';
  }

  return formatter.format(value);
}

function formatDuration(durationMs: number | null): string {
  if (durationMs == null) {
    return '—';
  }

  if (durationMs < 1000) {
    return `${durationMs} ms`;
  }

  return `${(durationMs / 1000).toFixed(durationMs >= 10_000 ? 0 : 1)} s`;
}

function formatExpiryWindow(expiresInMs: number | null): string {
  if (expiresInMs == null) {
    return '—';
  }

  if (expiresInMs <= 0) {
    return 'Expired';
  }

  const totalSeconds = Math.ceil(expiresInMs / 1000);
  if (totalSeconds < 60) {
    return `${totalSeconds}s remaining`;
  }

  const totalMinutes = Math.ceil(totalSeconds / 60);
  if (totalMinutes < 60) {
    return `${totalMinutes}m remaining`;
  }

  return `${Math.ceil(totalMinutes / 60)}h remaining`;
}

function getStatusClasses(status: TrackerCronRunStatus): string {
  switch (status) {
    case 'success':
      return 'border-emerald-400/40 bg-emerald-500/10 text-emerald-200';
    case 'partial':
      return 'border-amber-400/40 bg-amber-500/10 text-amber-100';
    case 'error':
      return 'border-rose-400/40 bg-rose-500/10 text-rose-100';
    case 'skipped':
      return 'border-slate-400/40 bg-slate-500/10 text-slate-200';
    default:
      return 'border-sky-400/40 bg-sky-500/10 text-sky-100';
  }
}

function triggerLabel(run: TrackerCronRun): string {
  switch (run.trigger) {
    case 'vercel-cron':
      return 'Vercel cron';
    case 'manual-admin':
      return 'Admin page';
    default:
      return 'Manual API';
  }
}

function isErrorResponse(value: unknown): value is { error: string } {
  return typeof value === 'object' && value !== null && 'error' in value && typeof value.error === 'string';
}

function isTrackerCronDashboard(value: unknown): value is TrackerCronDashboard {
  return typeof value === 'object'
    && value !== null
    && 'config' in value
    && 'history' in value
    && 'openSkyToken' in value;
}

function isTrackerCronRun(value: unknown): value is TrackerCronRun {
  return typeof value === 'object'
    && value !== null
    && 'id' in value
    && 'status' in value
    && 'results' in value;
}

function isOpenSkyTokenStatus(value: unknown): value is TrackerCronDashboard['openSkyToken'] {
  return typeof value === 'object'
    && value !== null
    && 'hasToken' in value
    && 'cacheSource' in value
    && 'tokenPreview' in value;
}

async function readApiPayload<T>(response: Response): Promise<T | { error: string }> {
  const text = await response.text();
  if (!text) {
    return {} as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    return {
      error: text.trim() || `Request failed with status ${response.status}.`,
    };
  }
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
      className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-slate-100 transition hover:border-sky-300/50 hover:bg-sky-500/10 disabled:cursor-not-allowed disabled:opacity-70"
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

function getChantalIdentifiers(config: TrackerCronDashboard['config']): string[] {
  return Array.isArray(config.chantalIdentifiers) ? config.chantalIdentifiers : [];
}

function getManualIdentifiers(config: TrackerCronDashboard['config']): string[] {
  const chantalIdentifiers = new Set(getChantalIdentifiers(config));
  const sourceIdentifiers = Array.isArray(config.manualIdentifiers)
    ? config.manualIdentifiers
    : config.identifiers;

  return sourceIdentifiers.filter((identifier) => !chantalIdentifiers.has(identifier));
}

function getChantalCronEnabled(dashboard: TrackerCronDashboard): boolean {
  return dashboard.chantalCronEnabled ?? getChantalIdentifiers(dashboard.config).length > 0;
}

export function TrackerCronAdminClient({ initialDashboard }: { initialDashboard: TrackerCronDashboard }) {
  const locale = useLocale();
  const [dashboard, setDashboard] = useState(initialDashboard);
  const [identifiersInput, setIdentifiersInput] = useState(getManualIdentifiers(initialDashboard.config).join('\n'));
  const [enabled, setEnabled] = useState(initialDashboard.config.enabled);
  const [chantalEnabled, setChantalEnabled] = useState(getChantalCronEnabled(initialDashboard));
  const [manualToken, setManualToken] = useState('');
  const [manualTokenExpirySeconds, setManualTokenExpirySeconds] = useState('1800');
  const [revealedToken, setRevealedToken] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingEnabled, setIsSavingEnabled] = useState(false);
  const [isSavingChantalEnabled, setIsSavingChantalEnabled] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [activeTokenAction, setActiveTokenAction] = useState<'checking' | 'refreshing' | 'clearing' | 'setting' | 'copying' | null>(null);
  const [notice, setNotice] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [visibleHistoryCount, setVisibleHistoryCount] = useState(() => Math.min(HISTORY_PAGE_SIZE, initialDashboard.history.length));

  const latestRun = useMemo(() => dashboard.history[0] ?? null, [dashboard.history]);
  const manualIdentifiers = useMemo(() => getManualIdentifiers(dashboard.config), [dashboard.config]);
  const chantalIdentifiers = useMemo(() => getChantalIdentifiers(dashboard.config), [dashboard.config]);
  const chantalCurrentTripName = dashboard.chantalCurrentTripName ?? null;
  const visibleHistory = useMemo(
    () => dashboard.history.slice(0, visibleHistoryCount),
    [dashboard.history, visibleHistoryCount],
  );
  const hasMoreHistory = visibleHistoryCount < dashboard.history.length;
  const dateTimeFormatter = useMemo(() => new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }), [locale]);
  const tokenStatusLabel = !dashboard.openSkyToken.hasToken
    ? 'Missing'
    : dashboard.openSkyToken.isExpired
      ? 'Expired'
      : 'Cached';
  const isTokenPending = activeTokenAction !== null;

  async function refreshDashboard() {
    const response = await fetch('/api/tracker/cron/config', { cache: 'no-store' });
    const payload: unknown = await readApiPayload<TrackerCronDashboard>(response);

    if (!response.ok || isErrorResponse(payload) || !isTrackerCronDashboard(payload)) {
      throw new Error(isErrorResponse(payload) ? payload.error : 'Unable to refresh tracker cron dashboard.');
    }

    setDashboard(payload);
    setIdentifiersInput(getManualIdentifiers(payload.config).join('\n'));
    setEnabled(payload.config.enabled);
    setChantalEnabled(getChantalCronEnabled(payload));
    return payload;
  }

  async function handleEnabledToggle(nextValue: boolean) {
    const previousValue = enabled;
    setEnabled(nextValue);
    setIsSavingEnabled(true);
    setNotice(null);

    try {
      const response = await fetch('/api/tracker/cron/config', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ enabled: nextValue }),
      });

      const payload: unknown = await readApiPayload<TrackerCronDashboard>(response);
      if (!response.ok || isErrorResponse(payload) || !isTrackerCronDashboard(payload)) {
        throw new Error(isErrorResponse(payload) ? payload.error : 'Unable to save the cron enabled state.');
      }

      setDashboard(payload);
      setEnabled(payload.config.enabled);
      setChantalEnabled(getChantalCronEnabled(payload));
      setNotice({ type: 'success', text: `Manual tracker cron ${payload.config.enabled ? 'enabled' : 'disabled'} and saved.` });
    } catch (error) {
      setEnabled(previousValue);
      setNotice({
        type: 'error',
        text: error instanceof Error ? error.message : 'Unable to save the manual tracker cron state.',
      });
    } finally {
      setIsSavingEnabled(false);
    }
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setNotice(null);

    try {
      const response = await fetch('/api/tracker/cron/config', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          identifiers: identifiersInput,
          enabled,
        }),
      });

      const payload: unknown = await readApiPayload<TrackerCronDashboard>(response);
      if (!response.ok || isErrorResponse(payload) || !isTrackerCronDashboard(payload)) {
        throw new Error(isErrorResponse(payload) ? payload.error : 'Unable to save the cron settings.');
      }

      setDashboard(payload);
      setIdentifiersInput(getManualIdentifiers(payload.config).join('\n'));
      setEnabled(payload.config.enabled);
      setChantalEnabled(getChantalCronEnabled(payload));
      setNotice({ type: 'success', text: 'Manual tracker cron list saved to MongoDB.' });
    } catch (error) {
      setNotice({
        type: 'error',
        text: error instanceof Error ? error.message : 'Unable to save the cron settings.',
      });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleChantalEnabledToggle(nextValue: boolean) {
    const previousValue = chantalEnabled;
    setChantalEnabled(nextValue);
    setIsSavingChantalEnabled(true);
    setNotice(null);

    try {
      const response = await fetch('/api/tracker/cron/config', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ chantalEnabled: nextValue }),
      });

      const payload: unknown = await readApiPayload<TrackerCronDashboard>(response);
      if (!response.ok || isErrorResponse(payload) || !isTrackerCronDashboard(payload)) {
        throw new Error(isErrorResponse(payload) ? payload.error : 'Unable to save the Chantal cron state.');
      }

      setDashboard(payload);
      setChantalEnabled(getChantalCronEnabled(payload));
      setEnabled(payload.config.enabled);
      setIdentifiersInput(getManualIdentifiers(payload.config).join('\n'));
      setNotice({
        type: 'success',
        text: (payload.chantalCronEnabled ?? nextValue)
          ? 'Chantal cron enabled and kept separate from the manual tracker toggle.'
          : 'Chantal cron disabled and removed from the cron queue.',
      });
    } catch (error) {
      setChantalEnabled(previousValue);
      setNotice({
        type: 'error',
        text: error instanceof Error ? error.message : 'Unable to save the Chantal cron state.',
      });
    } finally {
      setIsSavingChantalEnabled(false);
    }
  }

  async function handleRunNow() {
    setIsRunning(true);
    setNotice(null);

    try {
      const response = await fetch('/api/tracker/cron', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          trigger: 'manual-admin',
          requestedBy: 'tracker/cron dashboard',
        }),
      });

      const payload: unknown = await readApiPayload<TrackerCronRun>(response);
      if (!response.ok || isErrorResponse(payload) || !isTrackerCronRun(payload)) {
        throw new Error(isErrorResponse(payload) ? payload.error : 'Unable to start the cron run.');
      }

      await refreshDashboard();
      setNotice({
        type: 'success',
        text: `Cron run finished with status: ${payload.status}.`,
      });
    } catch (error) {
      setNotice({
        type: 'error',
        text: error instanceof Error ? error.message : 'Unable to start the cron run.',
      });
    } finally {
      setIsRunning(false);
    }
  }

  async function handleCheckToken() {
    setActiveTokenAction('checking');
    setNotice(null);

    try {
      const response = await fetch('/api/tracker/cron/token', { cache: 'no-store' });
      const payload: unknown = await readApiPayload<TrackerCronDashboard['openSkyToken']>(response);

      if (!response.ok || isErrorResponse(payload) || !isOpenSkyTokenStatus(payload)) {
        throw new Error(isErrorResponse(payload) ? payload.error : 'Unable to check the OpenSky token cache.');
      }

      const nextDashboard = await refreshDashboard();
      setNotice({
        type: 'info',
        text: nextDashboard.openSkyToken.hasToken
          ? `Token status checked: ${nextDashboard.openSkyToken.isExpired ? 'expired' : 'cached'} (${nextDashboard.openSkyToken.cacheSource}).`
          : 'No shared OpenSky token is currently cached.',
      });
    } catch (error) {
      setNotice({
        type: 'error',
        text: error instanceof Error ? error.message : 'Unable to check the OpenSky token cache.',
      });
    } finally {
      setActiveTokenAction(null);
    }
  }

  async function handleTokenAction(action: 'refresh' | 'clear' | 'set') {
    if (action === 'set' && !manualToken.trim()) {
      setNotice({ type: 'error', text: 'Paste an OpenSky access token before saving it.' });
      return;
    }

    setActiveTokenAction(action === 'refresh' ? 'refreshing' : action === 'clear' ? 'clearing' : 'setting');
    setNotice(null);

    try {
      const response = await fetch('/api/tracker/cron/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action,
          includeToken: action !== 'clear',
          accessToken: action === 'set' ? manualToken : undefined,
          expiresInSeconds: action === 'set' ? Number.parseInt(manualTokenExpirySeconds, 10) : undefined,
        }),
      });

      const payload: unknown = await readApiPayload<TrackerCronDashboard['openSkyToken']>(response);
      if (!response.ok || isErrorResponse(payload) || !isOpenSkyTokenStatus(payload)) {
        throw new Error(isErrorResponse(payload) ? payload.error : 'Unable to update the OpenSky token cache.');
      }

      if (payload.accessToken) {
        setRevealedToken(payload.accessToken);
      } else if (action === 'clear') {
        setRevealedToken(null);
      }

      await refreshDashboard();
      if (action === 'set') {
        setManualToken('');
      }

      setNotice({
        type: 'success',
        text: action === 'refresh'
          ? 'Fetched and cached a fresh OpenSky token.'
          : action === 'clear'
            ? 'Cleared the shared OpenSky token cache.'
            : 'Saved the provided OpenSky token to MongoDB.',
      });
    } catch (error) {
      setNotice({
        type: 'error',
        text: error instanceof Error ? error.message : 'Unable to update the OpenSky token cache.',
      });
    } finally {
      setActiveTokenAction(null);
    }
  }

  async function handleCopyActualToken() {
    setActiveTokenAction('copying');
    setNotice(null);

    try {
      const response = await fetch('/api/tracker/cron/token?includeToken=1', { cache: 'no-store' });
      const payload: unknown = await readApiPayload<TrackerCronDashboard['openSkyToken']>(response);

      if (!response.ok || isErrorResponse(payload) || !isOpenSkyTokenStatus(payload)) {
        throw new Error(isErrorResponse(payload) ? payload.error : 'Unable to load the actual OpenSky token.');
      }

      if (!payload.accessToken) {
        throw new Error('No shared OpenSky token is currently cached.');
      }

      setRevealedToken(payload.accessToken);

      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(payload.accessToken);
        setNotice({ type: 'success', text: 'Actual OpenSky token copied to clipboard.' });
      } else {
        setNotice({ type: 'info', text: 'Actual token loaded below. Copy it manually from the text box.' });
      }
    } catch (error) {
      setNotice({
        type: 'error',
        text: error instanceof Error ? error.message : 'Unable to copy the OpenSky token.',
      });
    } finally {
      setActiveTokenAction(null);
    }
  }

  useEffect(() => {
    setVisibleHistoryCount((current) => {
      const minimumVisible = Math.min(HISTORY_PAGE_SIZE, dashboard.history.length);
      if (current < minimumVisible) {
        return minimumVisible;
      }

      return Math.min(current, dashboard.history.length);
    });
  }, [dashboard.history.length]);

  function loadMoreHistory() {
    setVisibleHistoryCount((current) => Math.min(current + HISTORY_PAGE_SIZE, dashboard.history.length));
  }

  function handleHistoryScroll(event: UIEvent<HTMLDivElement>) {
    if (!hasMoreHistory) {
      return;
    }

    const { scrollTop, scrollHeight, clientHeight } = event.currentTarget;
    if (scrollHeight - scrollTop - clientHeight <= 96) {
      loadMoreHistory();
    }
  }

  return (
    <div className="space-y-6">
      {!dashboard.mongoConfigured ? (
        <div className="rounded-2xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          MongoDB is not configured. The page still works, but cron settings and run history cannot be persisted.
        </div>
      ) : null}

      {notice ? (
        <div className={`rounded-2xl border px-4 py-3 text-sm ${notice.type === 'success'
          ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-100'
          : notice.type === 'error'
            ? 'border-rose-400/40 bg-rose-500/10 text-rose-100'
            : 'border-sky-400/40 bg-sky-500/10 text-sky-100'}`}>
          {notice.text}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Schedule</p>
          <p className="mt-2 text-lg font-semibold text-white">Every 15 minutes</p>
          <p className="mt-1 text-sm text-slate-300">`{dashboard.config.schedule}` via Vercel cron.</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Tracked flights</p>
          <p className="mt-2 text-lg font-semibold text-white">{dashboard.config.identifiers.length}</p>
          <p className="mt-1 text-sm text-slate-300">
            {manualIdentifiers.length} manual{chantalIdentifiers.length > 0 ? ` · ${chantalIdentifiers.length} from /chantal` : ''}
          </p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Latest run (UTC)</p>
          <p className="mt-2 text-lg font-semibold text-white">{latestRun ? formatDateTime(latestRun.startedAt, dateTimeFormatter) : 'Never'}</p>
          <p className="mt-1 text-sm text-slate-300">{latestRun ? `${triggerLabel(latestRun)} · ${latestRun.status}` : 'No executions yet.'}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">OpenSky token</p>
          <p className="mt-2 text-lg font-semibold text-white">{tokenStatusLabel}</p>
          <p className="mt-1 text-sm text-slate-300">{dashboard.openSkyToken.tokenPreview ?? 'No shared token cached yet.'}</p>
        </div>
      </div>

      <div className="grid gap-6 lg:items-start lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="space-y-6">
          <form onSubmit={handleSave} className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-[0_18px_50px_rgba(2,6,23,0.25)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-white">Manual tracker flight list</h2>
                <p className="mt-1 text-sm text-slate-300">
                  Enter the manual callsigns or ICAO24 values you want to track from `/tracker`. The `/chantal` batch is managed separately below and can stay on even when this manual toggle is off.
                </p>
              </div>
              <ToggleSwitch
                checked={enabled}
                onToggle={handleEnabledToggle}
                label="Enable or disable the manual tracker cron list"
                disabled={isSaving || isSavingEnabled || isSavingChantalEnabled}
                pending={isSavingEnabled}
              />
            </div>

            <label className="mt-4 block text-sm font-medium text-slate-200" htmlFor="tracker-cron-identifiers">
              Manual flight identifiers
            </label>
            <textarea
              id="tracker-cron-identifiers"
              value={identifiersInput}
              onChange={(event) => setIdentifiersInput(event.target.value)}
              placeholder={'AF123\nBA117\n3c675a'}
              className="mt-2 min-h-56 w-full rounded-2xl border border-white/10 bg-slate-950 px-3 py-3 font-mono text-sm text-slate-100 outline-none transition focus:border-sky-400/60"
            />

            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="submit"
                disabled={isSaving || isSavingEnabled}
                className="inline-flex items-center justify-center rounded-full bg-sky-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-sky-400 disabled:cursor-wait disabled:opacity-70"
              >
                {isSaving ? 'Saving…' : 'Save list'}
              </button>
              <button
                type="button"
                onClick={() => void handleRunNow()}
                disabled={isRunning}
                className="inline-flex items-center justify-center rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-100 transition hover:border-sky-300/60 hover:bg-sky-500/10 disabled:cursor-wait disabled:opacity-70"
              >
                {isRunning ? 'Running…' : 'Run now'}
              </button>
            </div>
          </form>

          <section className="rounded-3xl border border-cyan-400/30 bg-cyan-500/10 p-5 shadow-[0_18px_50px_rgba(2,6,23,0.25)]">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="text-xs uppercase tracking-[0.2em] text-cyan-100">Managed by /chantal</div>
                <p className="mt-1 text-sm text-cyan-50">
                  Control whether the live Chantal trip is included in the cron queue. This batch keeps running even if the manual tracker cron above is disabled.
                </p>
                <p className="mt-2 text-xs text-cyan-100/80">
                  Current live trip: <span className="font-semibold text-white">{chantalCurrentTripName ?? 'No published Chantal trip selected yet'}</span>
                </p>
              </div>
              <ToggleSwitch
                checked={chantalEnabled}
                onToggle={handleChantalEnabledToggle}
                label="Enable or disable the Chantal cron batch"
                disabled={isSaving || isSavingEnabled || isSavingChantalEnabled}
                pending={isSavingChantalEnabled}
              />
            </div>

            <textarea
              readOnly
              aria-label="Chantal-managed flight identifiers"
              value={chantalIdentifiers.join('\n')}
              placeholder={chantalEnabled
                ? 'No flight identifiers are currently synced from the published Chantal trip.'
                : 'Enable the Chantal cron batch to sync the published trip here.'}
              className="mt-3 min-h-24 w-full rounded-2xl border border-cyan-400/20 bg-slate-950 px-3 py-3 font-mono text-sm text-cyan-50 outline-none"
            />
          </section>

          <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-[0_18px_50px_rgba(2,6,23,0.25)]">
            <h2 className="text-lg font-semibold text-white">Shared OpenSky token cache</h2>
            <p className="mt-1 text-sm text-slate-300">
              Fetch the OAuth token once, store it in Mongo, and reuse it across cold starts until it expires. These controls run on the Node.js server runtime.
            </p>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-slate-950/40 px-3 py-3 text-sm text-slate-200">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Status</p>
                <p className="mt-1 font-semibold text-white">{tokenStatusLabel}</p>
                <p className="mt-1 text-xs text-slate-400">Cache source: {dashboard.openSkyToken.cacheSource}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-950/40 px-3 py-3 text-sm text-slate-200">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Preview</p>
                <p className="mt-1 break-all font-mono text-white">{dashboard.openSkyToken.tokenPreview ?? '—'}</p>
                <p className="mt-1 text-xs text-slate-400">Origin: {dashboard.openSkyToken.storageSource ?? '—'}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-950/40 px-3 py-3 text-sm text-slate-200">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Fetched at (UTC)</p>
                <p className="mt-1 text-white">{formatDateTime(dashboard.openSkyToken.fetchedAt, dateTimeFormatter)}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-950/40 px-3 py-3 text-sm text-slate-200">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Expires</p>
                <p className="mt-1 text-white">{formatDateTime(dashboard.openSkyToken.expiresAt, dateTimeFormatter)}</p>
                <p className="mt-1 text-xs text-slate-400">{formatExpiryWindow(dashboard.openSkyToken.expiresInMs)}</p>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void handleCheckToken()}
                disabled={isTokenPending}
                className="inline-flex items-center justify-center rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-100 transition hover:border-sky-300/60 hover:bg-sky-500/10 disabled:cursor-wait disabled:opacity-70"
              >
                {activeTokenAction === 'checking' ? 'Checking…' : 'Check token'}
              </button>
              <button
                type="button"
                onClick={() => void handleTokenAction('refresh')}
                disabled={isTokenPending}
                className="inline-flex items-center justify-center rounded-full bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-wait disabled:opacity-70"
              >
                {activeTokenAction === 'refreshing' ? 'Fetching…' : 'Fetch token now'}
              </button>
              <button
                type="button"
                onClick={() => void handleCopyActualToken()}
                disabled={isTokenPending}
                className="inline-flex items-center justify-center rounded-full border border-sky-400/40 bg-sky-500/10 px-4 py-2 text-sm font-semibold text-sky-100 transition hover:bg-sky-500/20 disabled:cursor-wait disabled:opacity-70"
              >
                {activeTokenAction === 'copying' ? 'Copying…' : 'Copy actual token'}
              </button>
              <button
                type="button"
                onClick={() => void handleTokenAction('clear')}
                disabled={isTokenPending}
                className="inline-flex items-center justify-center rounded-full border border-rose-400/40 bg-rose-500/10 px-4 py-2 text-sm font-semibold text-rose-100 transition hover:bg-rose-500/20 disabled:cursor-wait disabled:opacity-70"
              >
                {activeTokenAction === 'clearing' ? 'Clearing…' : 'Clear token'}
              </button>
            </div>

            {revealedToken ? (
              <div className="mt-5 rounded-2xl border border-sky-400/30 bg-sky-500/10 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-sky-100">Actual token loaded in this browser session</p>
                  <button
                    type="button"
                    onClick={() => void handleCopyActualToken()}
                    disabled={isTokenPending}
                    className="inline-flex items-center justify-center rounded-full border border-sky-300/40 bg-sky-500/10 px-3 py-1.5 text-xs font-semibold text-sky-100 transition hover:bg-sky-500/20 disabled:cursor-wait disabled:opacity-70"
                  >
                    Copy again
                  </button>
                </div>
                <textarea
                  readOnly
                  value={revealedToken}
                  className="mt-3 min-h-24 w-full rounded-2xl border border-white/10 bg-slate-950 px-3 py-3 font-mono text-xs text-slate-100 outline-none"
                />
              </div>
            ) : null}

            <div className="mt-5 border-t border-white/10 pt-4">
              <label className="block text-sm font-medium text-slate-200" htmlFor="manual-opensky-token">
                Manually set a token
              </label>
              <textarea
                id="manual-opensky-token"
                value={manualToken}
                onChange={(event) => setManualToken(event.target.value)}
                placeholder="Paste an access_token here if you want to seed the shared cache manually"
                className="mt-2 min-h-28 w-full rounded-2xl border border-white/10 bg-slate-950 px-3 py-3 font-mono text-sm text-slate-100 outline-none transition focus:border-sky-400/60"
              />
              <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
                <label className="block text-sm text-slate-200">
                  <span className="mb-1 block">Expiry in seconds</span>
                  <input
                    type="number"
                    min="60"
                    step="60"
                    value={manualTokenExpirySeconds}
                    onChange={(event) => setManualTokenExpirySeconds(event.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-sky-400/60"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void handleTokenAction('set')}
                  disabled={isTokenPending}
                  className="inline-flex items-center justify-center rounded-full bg-sky-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-sky-400 disabled:cursor-wait disabled:opacity-70"
                >
                  {activeTokenAction === 'setting' ? 'Saving token…' : 'Save token to Mongo'}
                </button>
              </div>
            </div>
          </section>
        </div>

        <section className="self-start rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-[0_18px_50px_rgba(2,6,23,0.25)]">
          <h2 className="text-lg font-semibold text-white">Execution history</h2>
          <p className="mt-1 text-sm text-slate-300">
            Mongo keeps the full run history. Showing the latest {visibleHistory.length} of {dashboard.history.length} executions{hasMoreHistory ? ' — scroll to the bottom to load 10 more.' : '.'}
          </p>

          <div className="mt-4 max-h-[70vh] space-y-3 overflow-y-auto pr-1" onScroll={handleHistoryScroll}>
            {dashboard.history.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/10 bg-slate-950/40 px-4 py-5 text-sm text-slate-400">
                No cron executions have been recorded yet.
              </div>
            ) : visibleHistory.map((run) => (
              <details key={run.id} className="rounded-2xl border border-white/10 bg-slate-950/40 p-4" open={run === latestRun}>
                <summary className="flex cursor-pointer list-none flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.16em] ${getStatusClasses(run.status)}`}>
                        {run.status}
                      </span>
                      <span className="text-sm text-slate-300">{triggerLabel(run)}</span>
                    </div>
                    <p className="mt-2 text-sm text-white">{formatDateTime(run.startedAt, dateTimeFormatter)}</p>
                    <p className="mt-1 text-xs text-slate-400">
                      {run.identifiers.length} identifier{run.identifiers.length === 1 ? '' : 's'} · {run.summary.flightsFetched} flight{run.summary.flightsFetched === 1 ? '' : 's'} stored
                    </p>
                  </div>
                  <div className="text-xs text-slate-400 md:text-right">
                    <p>Duration: {formatDuration(run.durationMs)}</p>
                    <p>Matched: {run.summary.matchedIdentifiers} · Not found: {run.summary.notFoundIdentifiers} · Errors: {run.summary.errors}</p>
                  </div>
                </summary>

                <div className="mt-4 space-y-2 border-t border-white/10 pt-4">
                  {run.error ? (
                    <p className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
                      {run.error}
                    </p>
                  ) : null}

                  {run.results.map((result) => (
                    <div key={`${run.id}:${result.identifier}`} className="rounded-xl border border-white/10 bg-slate-900/70 px-3 py-3 text-sm text-slate-200">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-mono text-white">{result.identifier}</span>
                        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.16em] ${result.status === 'matched'
                          ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-100'
                          : result.status === 'not-found'
                            ? 'border-amber-400/40 bg-amber-500/10 text-amber-100'
                            : 'border-rose-400/40 bg-rose-500/10 text-rose-100'}`}>
                          {result.status}
                        </span>
                      </div>
                      <p className="mt-2 text-xs text-slate-400">
                        {result.flightCount} flight result{result.flightCount === 1 ? '' : 's'} · fetched at {formatDateTime(result.fetchedAt, dateTimeFormatter)}
                      </p>
                      {result.cachedIcao24s.length > 0 ? (
                        <p className="mt-1 text-xs text-slate-300">ICAO24: {result.cachedIcao24s.join(', ')}</p>
                      ) : null}
                      {result.error ? (
                        <p className="mt-2 text-xs text-rose-100">{result.error}</p>
                      ) : null}
                    </div>
                  ))}
                </div>
              </details>
            ))}
          </div>

          {hasMoreHistory ? (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-slate-950/40 px-3 py-2 text-xs text-slate-300">
              <p>Scroll to the bottom to load 10 more executions automatically.</p>
              <button
                type="button"
                onClick={loadMoreHistory}
                className="inline-flex items-center justify-center rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-100 transition hover:border-sky-300/60 hover:bg-sky-500/10"
              >
                Load 10 more
              </button>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
