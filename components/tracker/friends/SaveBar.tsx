'use client';

import { Save, RefreshCw } from 'lucide-react';
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
    validationIssues,
    hasValidationErrors,
    flightValidationResults,
    handleSave,
  } = useFriendsConfig();

  const liveValidationResults = selectedTrip?.friends.flatMap((friend) => friend.flights.map((leg) => flightValidationResults[leg.id])).filter(Boolean) ?? [];
  const matchedLiveCount = liveValidationResults.filter((result) => result?.status === 'matched').length;
  const warningLiveCount = liveValidationResults.filter((result) => result?.status === 'warning').length;
  const unresolvedLiveCount = liveValidationResults.filter((result) => result?.status === 'not-found' || result?.status === 'error').length;

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
              ? 'Trip edits stay local until you click Save config, but switching the live trip saves immediately. Saving also syncs the meeting airport and shared cron identifiers used by the tracker.'
              : 'All changes are already saved. Make any edit to enable Save config.')}
          </p>

          {hasValidationErrors ? (
            <div className="rounded-2xl border border-amber-400/35 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
              <p className="font-semibold">Fix {validationIssues.length} validation issue{validationIssues.length === 1 ? '' : 's'} before saving:</p>
              <ul className="mt-1 space-y-0.5 text-amber-50/90">
                {validationIssues.slice(0, 3).map((issue) => (
                  <li key={issue.id}>• {issue.message}</li>
                ))}
              </ul>
              {validationIssues.length > 3 ? <p className="mt-1 text-amber-100/80">+ {validationIssues.length - 3} more issue(s)</p> : null}
            </div>
          ) : null}

          {liveValidationResults.length > 0 ? (
            <div className="rounded-2xl border border-sky-400/25 bg-sky-500/10 px-3 py-2 text-xs text-sky-100">
              <p className="font-semibold">Flight provider validation</p>
              <p className="mt-1 text-sky-50/90">
                {matchedLiveCount} matched • {warningLiveCount} warning{warningLiveCount === 1 ? '' : 's'} • {unresolvedLiveCount} unresolved
              </p>
            </div>
          ) : null}

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

        <div className="flex w-full flex-col gap-2 md:w-auto">
          <button
            type="button"
            onClick={handleSave}
            className="inline-flex w-full items-center justify-center gap-2 whitespace-nowrap rounded-full bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-60 md:w-auto"
            disabled={!hasPendingChanges || hasValidationErrors || isSaving || isSavingCronToggle}
          >
            {isSaving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {isSaving ? 'Saving…' : 'Save config'}
          </button>
        </div>
      </div>
    </section>
  );
}
