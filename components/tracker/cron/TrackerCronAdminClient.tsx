'use client';

import { useMemo, useState, type FormEvent } from 'react';
import type { TrackerCronDashboard, TrackerCronRun, TrackerCronRunStatus } from '~/lib/server/trackerCron';

function formatDateTime(value: number | null): string {
  if (!value) {
    return '—';
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(value);
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
    && 'history' in value;
}

function isTrackerCronRun(value: unknown): value is TrackerCronRun {
  return typeof value === 'object'
    && value !== null
    && 'id' in value
    && 'status' in value
    && 'results' in value;
}

export function TrackerCronAdminClient({ initialDashboard }: { initialDashboard: TrackerCronDashboard }) {
  const [dashboard, setDashboard] = useState(initialDashboard);
  const [identifiersInput, setIdentifiersInput] = useState(initialDashboard.config.identifiers.join('\n'));
  const [enabled, setEnabled] = useState(initialDashboard.config.enabled);
  const [isSaving, setIsSaving] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [notice, setNotice] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  const latestRun = useMemo(() => dashboard.history[0] ?? null, [dashboard.history]);

  async function refreshDashboard() {
    const response = await fetch('/api/tracker/cron/config', { cache: 'no-store' });
    const payload: unknown = await response.json();

    if (!response.ok || isErrorResponse(payload) || !isTrackerCronDashboard(payload)) {
      throw new Error(isErrorResponse(payload) ? payload.error : 'Unable to refresh tracker cron dashboard.');
    }

    setDashboard(payload);
    setIdentifiersInput(payload.config.identifiers.join('\n'));
    setEnabled(payload.config.enabled);
    return payload;
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

      const payload: unknown = await response.json();
      if (!response.ok || isErrorResponse(payload) || !isTrackerCronDashboard(payload)) {
        throw new Error(isErrorResponse(payload) ? payload.error : 'Unable to save the cron settings.');
      }

      setDashboard(payload);
      setIdentifiersInput(payload.config.identifiers.join('\n'));
      setEnabled(payload.config.enabled);
      setNotice({ type: 'success', text: 'Cron configuration saved to MongoDB.' });
    } catch (error) {
      setNotice({
        type: 'error',
        text: error instanceof Error ? error.message : 'Unable to save the cron settings.',
      });
    } finally {
      setIsSaving(false);
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

      const payload: unknown = await response.json();
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
          <p className="mt-1 text-sm text-slate-300">Saved identifiers that the cron will refresh.</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Latest run</p>
          <p className="mt-2 text-lg font-semibold text-white">{latestRun ? formatDateTime(latestRun.startedAt) : 'Never'}</p>
          <p className="mt-1 text-sm text-slate-300">{latestRun ? `${triggerLabel(latestRun)} · ${latestRun.status}` : 'No executions yet.'}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Mongo persistence</p>
          <p className="mt-2 text-lg font-semibold text-white">{dashboard.mongoConfigured ? 'Enabled' : 'Missing'}</p>
          <p className="mt-1 text-sm text-slate-300">Search cache and execution history are stored there.</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <form onSubmit={handleSave} className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-[0_18px_50px_rgba(2,6,23,0.25)]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-white">Cron flight list</h2>
              <p className="mt-1 text-sm text-slate-300">
                Enter one callsign or ICAO24 per line. These identifiers are fetched every 15 minutes and refreshed into Mongo.
              </p>
            </div>
            <label className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-500 bg-slate-950"
                checked={enabled}
                onChange={(event) => setEnabled(event.target.checked)}
              />
              Enabled
            </label>
          </div>

          <label className="mt-4 block text-sm font-medium text-slate-200" htmlFor="tracker-cron-identifiers">
            Flight identifiers
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
              disabled={isSaving}
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

        <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-[0_18px_50px_rgba(2,6,23,0.25)]">
          <h2 className="text-lg font-semibold text-white">Execution history</h2>
          <p className="mt-1 text-sm text-slate-300">
            Mongo keeps the full run history. This page shows the most recent {dashboard.history.length} executions.
          </p>

          <div className="mt-4 space-y-3">
            {dashboard.history.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/10 bg-slate-950/40 px-4 py-5 text-sm text-slate-400">
                No cron executions have been recorded yet.
              </div>
            ) : dashboard.history.map((run) => (
              <details key={run.id} className="rounded-2xl border border-white/10 bg-slate-950/40 p-4" open={run === latestRun}>
                <summary className="flex cursor-pointer list-none flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.16em] ${getStatusClasses(run.status)}`}>
                        {run.status}
                      </span>
                      <span className="text-sm text-slate-300">{triggerLabel(run)}</span>
                    </div>
                    <p className="mt-2 text-sm text-white">{formatDateTime(run.startedAt)}</p>
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
                        {result.flightCount} flight result{result.flightCount === 1 ? '' : 's'} · fetched at {formatDateTime(result.fetchedAt)}
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
        </section>
      </div>
    </div>
  );
}
