'use client';

import { Clock3, Play, RefreshCw } from 'lucide-react';
import { Link } from '~/i18n/navigation';
import { useFriendsConfig } from './FriendsConfigContext';
import { ToggleSwitch } from './ToggleSwitch';
import { formatDateTime } from '~/lib/utils/dateTimeLocal';

export function CronSection() {
  const {
    locale,
    cronEnabled,
    cronDashboard,
    isSaving,
    isSavingCronToggle,
    isRunningCron,
    trackedIdentifiers,
    currentTrip,
    latestCronRun,
    handleCronToggle,
    handleRunCronNow,
  } = useFriendsConfig();

  return (
    <section className="rounded-3xl border border-white/10 bg-slate-950/55 p-4 backdrop-blur-sm sm:p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sky-200">
            <Clock3 className="h-4 w-4" />
            <p className="text-xs uppercase tracking-[0.24em]">Background prefetch cron</p>
          </div>
          <p className="mt-3 max-w-3xl text-sm text-slate-300">
            This toggle only adds or removes the current Chantal trip from the shared cron list. The global cron on/off switch stays on the full cron admin page, while itinerary edits still wait for &quot;Save config&quot;.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <ToggleSwitch
            checked={cronEnabled}
            onToggle={handleCronToggle}
            label="Enable or disable syncing the Chantal trip into the shared cron list"
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
            {cronEnabled
              ? `Currently syncing ${currentTrip?.name ?? 'the selected trip'} into the shared cron list.`
              : 'This Chantal batch is currently excluded from the shared cron list.'}
          </div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-3 text-sm text-slate-200">
          <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Latest run</div>
          <div className="mt-1 font-semibold text-white">{formatDateTime(latestCronRun?.startedAt ?? null, locale)}</div>
          <div className="mt-1 text-xs text-slate-400">{latestCronRun ? latestCronRun.status : 'No runs yet'}</div>
        </div>
      </div>
    </section>
  );
}
