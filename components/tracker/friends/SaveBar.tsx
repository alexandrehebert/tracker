'use client';

import { RefreshCw, Save } from 'lucide-react';
import { useFriendsConfig } from './FriendsConfigContext';
import { formatDateTime } from '~/lib/utils/dateTimeLocal';

export function SaveBar() {
  const {
    locale,
    notice,
    hasPendingChanges,
    isSaving,
    isSavingCronToggle,
    lastSavedAt,
    selectedTrip,
    currentTrip,
    handleSave,
  } = useFriendsConfig();

  return (
    <section className="sticky top-3 z-20 rounded-2xl border border-white/10 bg-slate-950/90 p-3 shadow-lg shadow-slate-950/25 backdrop-blur">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="space-y-2">
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
              ? 'Changes stay local until you click Save config. Saving also syncs the selected live trip, meeting airport, and shared cron identifiers used by the tracker.'
              : 'All changes are already saved. Make any edit to enable Save config.')}
          </p>

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
  );
}
