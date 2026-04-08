'use client';

import { useEffect, useRef, useState } from 'react';
import { Save, RefreshCw } from 'lucide-react';
import { useFriendsConfig } from './FriendsConfigContext';
import { formatDateTime } from '~/lib/utils/dateTimeLocal';

function shouldCountLegForValidation(leg: {
  flightNumber?: string | null;
  departureTime?: string | null;
  arrivalTime?: string | null;
  from?: string | null;
  to?: string | null;
  resolvedIcao24?: string | null;
}): boolean {
  return [leg.flightNumber, leg.departureTime, leg.arrivalTime, leg.from, leg.to, leg.resolvedIcao24]
    .some((value) => typeof value === 'string' && value.trim().length > 0);
}

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
    handleCancelPendingChanges,
    handleSave,
  } = useFriendsConfig();

  const saveBarRef = useRef<HTMLElement | null>(null);
  const [isPinned, setIsPinned] = useState(false);

  useEffect(() => {
    const updatePinnedState = () => {
      const nextPinnedState = (saveBarRef.current?.getBoundingClientRect().top ?? 1) <= 0;
      setIsPinned((currentState) => (currentState === nextPinnedState ? currentState : nextPinnedState));
    };

    updatePinnedState();
    window.addEventListener('scroll', updatePinnedState, { passive: true });
    window.addEventListener('resize', updatePinnedState);

    return () => {
      window.removeEventListener('scroll', updatePinnedState);
      window.removeEventListener('resize', updatePinnedState);
    };
  }, []);

  const reviewableLegs = selectedTrip?.friends.flatMap((friend) => friend.flights.filter((leg) => shouldCountLegForValidation(leg))) ?? [];
  const matchedLiveCount = reviewableLegs.filter((leg) => leg.validatedFlight?.status === 'matched').length;
  const warningLiveCount = reviewableLegs.filter((leg) => leg.validatedFlight?.status === 'warning').length;
  const unresolvedLiveCount = Math.max(reviewableLegs.length - matchedLiveCount - warningLiveCount, 0);
  const saveBarToneClass = hasValidationErrors
    ? 'border-rose-400/35 bg-rose-500/10 shadow-rose-950/20'
    : hasPendingChanges
      ? 'border-slate-700 bg-slate-900 shadow-slate-950/30'
      : notice?.type === 'success'
        ? 'border-emerald-400/30 bg-emerald-500/10 shadow-emerald-950/15'
        : 'border-white/10 bg-slate-950/90 shadow-slate-950/25';
  const saveButtonToneClass = hasPendingChanges
    ? 'bg-amber-300 text-slate-950 hover:bg-amber-200'
    : 'bg-cyan-500 text-slate-950 hover:bg-cyan-400';
  const stickyStateClass = isPinned
    ? 'rounded-t-none border-t-0 shadow-2xl'
    : 'rounded-2xl';

  return (
    <section
      ref={saveBarRef}
      className={`sticky top-0 z-20 border p-3 shadow-lg backdrop-blur transition-[border-radius,box-shadow,colors] ${saveBarToneClass} ${stickyStateClass}`}
    >
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

          {reviewableLegs.length > 0 ? (
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
          {hasPendingChanges ? (
            <button
              type="button"
              onClick={handleCancelPendingChanges}
              className="inline-flex w-full items-center justify-center gap-2 whitespace-nowrap rounded-full border border-white/15 bg-slate-950/70 px-4 py-2 text-sm font-medium text-slate-100 transition hover:border-white/25 hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-60 md:w-auto"
              disabled={isSaving || isSavingCronToggle}
            >
              Cancel
            </button>
          ) : null}
          <button
            type="button"
            onClick={handleSave}
            className={`inline-flex w-full items-center justify-center gap-2 whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 md:w-auto ${saveButtonToneClass}`}
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
