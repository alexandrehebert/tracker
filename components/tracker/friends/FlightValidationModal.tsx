'use client';

import { Check, RefreshCw, X } from 'lucide-react';
import {
  useFriendsConfig,
  type FlightValidationModalCandidate,
  type FlightValidationProviderId,
} from './FriendsConfigContext';

function formatTimestampMs(value: number | null, locale: string): string | null {
  if (value == null || !Number.isFinite(value)) {
    return null;
  }

  return new Date(value).toLocaleString(locale, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  });
}

interface CandidateCardProps {
  candidate: FlightValidationModalCandidate;
  locale: string;
  onApply: () => void;
}

const TIMING_WARNING_THRESHOLD_MINUTES = 180;

const VALIDATION_PROVIDER_OPTIONS: Array<{
  id: FlightValidationProviderId;
  label: string;
  description: string;
}> = [
  {
    id: 'tracker',
    label: 'Tracker search',
    description: 'Live and recent telemetry already known by the tracker.',
  },
  {
    id: 'flightaware',
    label: 'FlightAware',
    description: 'Premium airline schedule and equipment lookup.',
  },
  {
    id: 'aviationstack',
    label: 'Aviationstack',
    description: 'Scheduled flight metadata and route details.',
  },
  {
    id: 'airlabs',
    label: 'AirLabs',
    description: 'Live flight status, schedule, and aircraft metadata.',
  },
  {
    id: 'aerodatabox',
    label: 'AeroDataBox',
    description: 'On-demand RapidAPI lookup for manual validation.',
  },
];

function CandidateCard({ candidate, locale, onApply }: CandidateCardProps) {
  const hasDelta = candidate.departureDeltaMinutes != null;
  const isLargeTimeDelta = hasDelta && Math.abs(candidate.departureDeltaMinutes ?? 0) > TIMING_WARNING_THRESHOLD_MINUTES;

  const statusColor = candidate.status === 'warning' || isLargeTimeDelta
    ? 'border-amber-400/30 bg-amber-500/5'
    : 'border-emerald-400/25 bg-emerald-500/5';

  const departureText = formatTimestampMs(candidate.matchedDepartureTime, locale);
  const arrivalText = formatTimestampMs(candidate.matchedArrivalTime, locale);

  return (
    <div className={`rounded-2xl border p-3 ${statusColor}`}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="rounded-full border border-white/15 bg-slate-900/70 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-100">
          {candidate.providerLabel}
        </span>
        <button
          type="button"
          onClick={onApply}
          className="inline-flex items-center gap-1.5 rounded-full border border-cyan-400/40 bg-cyan-500/15 px-3 py-1.5 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-500/25"
        >
          <Check className="h-3.5 w-3.5" />
          Apply
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5 text-xs text-slate-300">
        {candidate.matchedFlightNumber ? (
          <span className="rounded-full border border-white/10 bg-slate-900/60 px-2.5 py-1">
            Flight: {candidate.matchedFlightNumber}
          </span>
        ) : null}
        {candidate.matchedRoute ? (
          <span className="rounded-full border border-white/10 bg-slate-900/60 px-2.5 py-1">
            Route: {candidate.matchedRoute}
          </span>
        ) : null}
        {departureText ? (
          <span className="rounded-full border border-white/10 bg-slate-900/60 px-2.5 py-1">
            Dep: {departureText} UTC
          </span>
        ) : null}
        {arrivalText ? (
          <span className="rounded-full border border-white/10 bg-slate-900/60 px-2.5 py-1">
            Arr: {arrivalText} UTC
          </span>
        ) : null}
        {candidate.matchedIcao24 ? (
          <span className="rounded-full border border-cyan-400/25 bg-cyan-500/10 px-2.5 py-1 text-cyan-100">
            ICAO24: {candidate.matchedIcao24}
          </span>
        ) : null}
        {hasDelta ? (
          <span className={`rounded-full border px-2.5 py-1 ${isLargeTimeDelta ? 'border-amber-400/30 bg-amber-500/10 text-amber-100' : 'border-white/10 bg-slate-900/60'}`}>
            Δ {(candidate.departureDeltaMinutes ?? 0) > 0 ? '+' : ''}{candidate.departureDeltaMinutes} min
          </span>
        ) : null}
      </div>

      {candidate.message ? (
        <p className="mt-2 text-[11px] text-slate-400">{candidate.message}</p>
      ) : null}
    </div>
  );
}

export function FlightValidationModal() {
  const {
    locale,
    validationModal,
    closeValidationModal,
    applyValidationCandidate,
    runValidationModal,
    toggleValidationProvider,
    flightValidationResults,
    availableValidationProviders,
  } = useFriendsConfig();

  if (!validationModal) {
    return null;
  }

  const { identifier, legId, status, selectedProviders, candidates, message } = validationModal;
  const isLoading = status === 'loading';
  const selectedProviderCount = Object.values(selectedProviders).filter(Boolean).length;
  const availableProviderOptions = VALIDATION_PROVIDER_OPTIONS.filter((option) => availableValidationProviders[option.id]);
  const currentValidation = flightValidationResults[legId];
  const hasCurrentValidation = Boolean(
    currentValidation
      && currentValidation.status !== 'idle'
      && currentValidation.status !== 'loading',
  );

  return (
    <div
      className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto bg-slate-950/80 p-4 pt-12 backdrop-blur-sm"
      onClick={closeValidationModal}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Validate flight ${identifier}`}
        className="w-full max-w-2xl overflow-hidden rounded-3xl border border-sky-400/25 bg-slate-950/97 shadow-2xl shadow-slate-950/40"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-white/10 px-4 py-3">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-sky-200">Validate flight</p>
            <h3 className="mt-0.5 text-base font-semibold text-white">{identifier}</h3>
          </div>
          <button
            type="button"
            onClick={closeValidationModal}
            className="rounded-full border border-white/10 bg-slate-900/80 p-2 text-slate-200 transition hover:border-white/20 hover:bg-slate-800"
            aria-label="Close flight validation"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-4 py-4">
          <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-200">Select provider(s)</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {availableProviderOptions.map((option) => {
                const isSelected = selectedProviders[option.id];
                return (
                  <button
                    key={option.id}
                    type="button"
                    aria-pressed={isSelected}
                    aria-label={`Select provider ${option.label}`}
                    onClick={() => toggleValidationProvider(option.id)}
                    className={`rounded-2xl border px-3 py-2 text-left transition ${isSelected
                      ? 'border-cyan-400/40 bg-cyan-500/10 text-cyan-50'
                      : 'border-white/10 bg-slate-950/70 text-slate-300 hover:border-white/20 hover:bg-slate-900'}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold">{option.label}</span>
                      {isSelected ? <Check className="h-4 w-4" /> : null}
                    </div>
                    <p className="mt-1 text-[11px] opacity-85">{option.description}</p>
                  </button>
                );
              })}
            </div>

            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-slate-400">
                {availableProviderOptions.length === 0
                  ? 'No validation providers are currently enabled.'
                  : selectedProviderCount > 0
                    ? `${selectedProviderCount} provider${selectedProviderCount === 1 ? '' : 's'} selected.`
                    : 'Select at least one enabled provider before running validation.'}
              </p>
              <button
                type="button"
                onClick={() => {
                  void runValidationModal();
                }}
                disabled={isLoading || selectedProviderCount === 0 || availableProviderOptions.length === 0}
                className="inline-flex items-center justify-center gap-2 rounded-full border border-cyan-400/40 bg-cyan-500/15 px-4 py-2 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
                {isLoading ? 'Running…' : 'Run validation'}
              </button>
            </div>
          </div>

          {hasCurrentValidation && currentValidation ? (
            <div className={`rounded-2xl border px-4 py-3 text-sm ${currentValidation.status === 'matched'
              ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-50'
              : currentValidation.status === 'warning'
                ? 'border-amber-400/35 bg-amber-500/10 text-amber-100'
                : currentValidation.status === 'skipped'
                  ? 'border-slate-400/25 bg-slate-900/70 text-slate-200'
                  : 'border-rose-400/35 bg-rose-500/10 text-rose-100'}`}>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] opacity-90">Current leg status</p>
              <p className="mt-1 font-semibold">
                {currentValidation.status === 'matched'
                  ? 'Schedule match confirmed'
                  : currentValidation.status === 'warning'
                    ? 'Provider match needs review'
                    : currentValidation.status === 'skipped'
                      ? 'Validation skipped'
                      : currentValidation.status === 'not-found'
                        ? 'No live match found'
                        : 'Validation error'}
              </p>
              <p className="mt-1 text-xs opacity-90">{currentValidation.message}</p>
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                {currentValidation.providerLabel ? (
                  <span className="rounded-full border border-white/15 bg-slate-950/40 px-2 py-1">
                    Source: {currentValidation.providerLabel}
                  </span>
                ) : null}
                {currentValidation.matchedIcao24 ? (
                  <span className="rounded-full border border-white/15 bg-slate-950/40 px-2 py-1">
                    ICAO24: {currentValidation.matchedIcao24}
                  </span>
                ) : null}
                {currentValidation.matchedRoute ? (
                  <span className="rounded-full border border-white/15 bg-slate-950/40 px-2 py-1">
                    Route: {currentValidation.matchedRoute}
                  </span>
                ) : null}
                {currentValidation.departureDeltaMinutes != null ? (
                  <span className="rounded-full border border-white/15 bg-slate-950/40 px-2 py-1">
                    Delta: {currentValidation.departureDeltaMinutes > 0 ? '+' : ''}{currentValidation.departureDeltaMinutes} min
                  </span>
                ) : null}
                {formatTimestampMs(currentValidation.matchedArrivalTime, locale) ? (
                  <span className="rounded-full border border-white/15 bg-slate-950/40 px-2 py-1">
                    Arrival: {formatTimestampMs(currentValidation.matchedArrivalTime, locale)} UTC
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}

          {isLoading ? (
            <div className="flex items-center gap-3 rounded-2xl border border-sky-400/20 bg-sky-500/8 px-4 py-4 text-sm text-sky-100">
              <RefreshCw className="h-4 w-4 shrink-0 animate-spin" />
              <span>Checking providers for {identifier}…</span>
            </div>
          ) : candidates.length > 0 ? (
            <div className="space-y-3">
              <p className="text-xs text-slate-400">
                {candidates.length === 1
                  ? '1 provider match found. Review the details and click Apply to attach it to this leg.'
                  : `${candidates.length} provider matches found, sorted by best fit. Review and click Apply on the correct one.`}
              </p>
              {candidates.map((candidate, index) => (
                <CandidateCard
                  key={`${candidate.providerLabel}-${index}`}
                  candidate={candidate}
                  locale={locale}
                  onApply={() => applyValidationCandidate(candidate)}
                />
              ))}
            </div>
          ) : message ? (
            <div className={`rounded-2xl border px-4 py-3 text-sm ${status === 'error'
              ? 'border-rose-400/30 bg-rose-500/10 text-rose-100'
              : status === 'setup'
                ? 'border-slate-400/20 bg-slate-900/60 text-slate-300'
                : 'border-slate-400/20 bg-slate-900/60 text-slate-300'}`}>
              <p className="font-semibold">{status === 'error' ? 'Validation error' : status === 'setup' ? 'Choose providers' : 'No provider match found'}</p>
              <p className="mt-1 text-xs opacity-90">{message}</p>
            </div>
          ) : null}
        </div>

        <div className="flex justify-end border-t border-white/10 px-4 py-3">
          <button
            type="button"
            onClick={closeValidationModal}
            className="inline-flex items-center justify-center rounded-full border border-white/10 bg-slate-900/80 px-4 py-2 text-sm font-medium text-slate-100 transition hover:border-white/20 hover:bg-slate-900"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
