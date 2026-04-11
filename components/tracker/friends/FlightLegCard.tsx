'use client';

import { ArrowDown, ArrowUp, CalendarDays, CheckCircle2, ExternalLink, PlaneTakeoff, RefreshCw, Trash2 } from 'lucide-react';
import { useRef } from 'react';
import { useFriendsConfig } from './FriendsConfigContext';
import { AirportAutocomplete } from './AirportAutocomplete';
import { getAirportFieldKey, normalizeAirportCode } from '~/lib/utils/airportUtils';
import { fromDateTimeLocalValue, toDateTimeLocalValue } from '~/lib/utils/dateTimeLocal';
import { normalizeFlightRadarFlightNumber, openFlightRadarUrl } from '~/lib/utils/flightRadar';
import type { FriendFlightLeg } from '~/lib/friendsTracker';

interface FlightLegCardProps {
  friendId: string;
  leg: FriendFlightLeg;
  legIndex: number;
  totalLegs: number;
}

export function FlightLegCard({ friendId, leg, legIndex, totalLegs }: FlightLegCardProps) {
  const {
    locale,
    airportTimezones,
    hasHydrated,
    activeAirportField,
    airportSuggestions,
    flightValidationResults,
    refreshingLegIds,
    updateFriend,
    moveFriendFlight,
    forceRefreshFlightLeg,
    validateFlightLeg,
  } = useFriendsConfig();

  const departureTimezone = leg.departureTimezone ?? airportTimezones[normalizeAirportCode(leg.from)] ?? null;
  const arrivalTimezone = airportTimezones[normalizeAirportCode(leg.to)] ?? null;
  const fromFieldKey = getAirportFieldKey(friendId, leg.id, 'from');
  const toFieldKey = getAirportFieldKey(friendId, leg.id, 'to');
  const fromSuggestions = activeAirportField === fromFieldKey ? airportSuggestions : [];
  const toSuggestions = activeAirportField === toFieldKey ? airportSuggestions : [];
  const hasOpenSuggestions = fromSuggestions.length > 0 || toSuggestions.length > 0;
  const validationResult = flightValidationResults[leg.id];
  const departureInputRef = useRef<HTMLInputElement | null>(null);
  const arrivalInputRef = useRef<HTMLInputElement | null>(null);
  const hasAppliedValidation = leg.validatedFlight?.status === 'matched' || leg.validatedFlight?.status === 'warning';
  const isValidationLoading = validationResult?.status === 'loading';
  const isRouteRefreshLoading = Boolean(refreshingLegIds[leg.id]);
  const normalizedFlightNumber = normalizeFlightRadarFlightNumber(leg.flightNumber);
  const canForceRefresh = Boolean(normalizedFlightNumber || leg.resolvedIcao24?.trim());
  const showInlineValidationBanner = Boolean(
    validationResult
      && validationResult.status !== 'idle'
      && validationResult.status !== 'loading'
      && validationResult.status !== 'matched',
  );

  function formatValidationTimestamp(value: number | null): string | null {
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

  function updateLeg(updater: (l: FriendFlightLeg) => FriendFlightLeg) {
    updateFriend(friendId, (friend) => ({
      ...friend,
      flights: friend.flights.map((fl) => fl.id === leg.id ? updater(fl) : fl),
    }));
  }

  function openPicker(inputRef: { current: HTMLInputElement | null }) {
    const input = inputRef.current;
    if (!input) {
      return;
    }

    input.focus();

    if (typeof input.showPicker === 'function') {
      input.showPicker();
      return;
    }

    input.click();
  }

  return (
    <div className={`relative rounded-2xl border p-4 transition-colors ${hasAppliedValidation
      ? 'border-emerald-400/35 bg-emerald-500/10 shadow-lg shadow-emerald-950/10'
      : 'border-white/10 bg-slate-950/70'} ${hasOpenSuggestions ? 'z-30' : ''}`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-white">
          <PlaneTakeoff className={`h-4 w-4 ${hasAppliedValidation ? 'text-emerald-300' : 'text-sky-300'}`} />
          <span>Leg {legIndex + 1}</span>
          {hasAppliedValidation ? (
            <span className="rounded-full border border-emerald-400/35 bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-50">
              Validated
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            aria-label={`Move leg ${legIndex + 1} up`}
            disabled={legIndex === 0}
            onClick={() => moveFriendFlight(friendId, legIndex, -1)}
            className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-slate-900/80 px-2.5 py-1.5 text-xs font-medium text-slate-200 transition hover:border-white/20 hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <ArrowUp className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Up</span>
          </button>
          <button
            type="button"
            aria-label={`Move leg ${legIndex + 1} down`}
            disabled={legIndex === totalLegs - 1}
            onClick={() => moveFriendFlight(friendId, legIndex, 1)}
            className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-slate-900/80 px-2.5 py-1.5 text-xs font-medium text-slate-200 transition hover:border-white/20 hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <ArrowDown className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Down</span>
          </button>
          <button
            type="button"
            aria-label={`${hasAppliedValidation ? 'Validated' : 'Validate'} flight for leg ${legIndex + 1}`}
            onClick={() => {
              void validateFlightLeg(friendId, leg.id);
            }}
            className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-medium transition ${hasAppliedValidation
              ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-50 hover:bg-emerald-500/20'
              : 'border-sky-400/30 bg-sky-500/10 text-sky-100 hover:bg-sky-500/20'}`}
          >
            {hasAppliedValidation ? (
              <CheckCircle2 className="h-3.5 w-3.5" />
            ) : (
              <RefreshCw className={`h-3.5 w-3.5 ${isValidationLoading ? 'animate-spin' : ''}`} />
            )}
            {isValidationLoading ? 'Validating…' : hasAppliedValidation ? 'Validated' : 'Validate flight'}
          </button>
          <button
            type="button"
            aria-label={`Force refresh route for leg ${legIndex + 1}`}
            title="Run a targeted refresh for this flight to try seeding route and track data"
            disabled={!canForceRefresh || isRouteRefreshLoading}
            onClick={() => {
              void forceRefreshFlightLeg(friendId, leg.id);
            }}
            className="inline-flex items-center gap-1 rounded-full border border-violet-400/30 bg-violet-500/10 px-3 py-1.5 text-xs font-medium text-violet-100 transition hover:bg-violet-500/20 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRouteRefreshLoading ? 'animate-spin' : ''}`} />
            {isRouteRefreshLoading ? 'Refreshing…' : 'Force refresh route'}
          </button>
          <button
            type="button"
            onClick={() => {
              updateFriend(friendId, (friend) => ({
                ...friend,
                flights: friend.flights.filter((fl) => fl.id !== leg.id),
              }));
            }}
            className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-slate-900/80 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:border-white/20 hover:bg-slate-900"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Remove leg
          </button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="mb-2 block text-xs font-medium uppercase tracking-[0.2em] text-slate-400">Flight number</label>
          <div className="relative">
            <input
              aria-label={`Flight number for leg ${legIndex + 1}`}
              value={leg.flightNumber}
              onChange={(event) => {
                const flightNumber = event.target.value;
                updateLeg((l) => ({ ...l, flightNumber, validatedFlight: null }));
              }}
              placeholder="AF123"
              className="w-full rounded-2xl border border-white/10 bg-slate-950/90 px-3 py-2 pr-11 text-sm text-slate-100 outline-none transition focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-500/20"
            />
            {normalizedFlightNumber ? (
              <button
                type="button"
                aria-label={`Open ${normalizedFlightNumber} on Flightradar24`}
                title={`Open ${normalizedFlightNumber} on Flightradar24`}
                onClick={() => openFlightRadarUrl(normalizedFlightNumber)}
                className="absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-slate-300 transition hover:bg-slate-900/80 hover:text-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/30"
              >
                <ExternalLink className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        </div>
        <div className="lg:col-span-3">
          <label className="mb-2 block text-xs font-medium uppercase tracking-[0.2em] text-slate-400">Note</label>
          <input
            value={leg.note ?? ''}
            onChange={(event) => {
              const note = event.target.value;
              updateLeg((l) => ({ ...l, note }));
            }}
            placeholder="Connection in AMS"
            className="w-full rounded-2xl border border-white/10 bg-slate-950/90 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-500/20"
          />
        </div>
        <div className="relative">
          <label className="mb-2 block text-xs font-medium uppercase tracking-[0.2em] text-slate-400">From</label>
          <AirportAutocomplete
            fieldKey={fromFieldKey}
            value={leg.from ?? ''}
            placeholder="CDG"
            aria-label={`From airport for leg ${legIndex + 1}`}
            listboxLabel={`Departure airport suggestions for leg ${legIndex + 1}`}
            legId={leg.id}
            onChange={(from) => {
              const nextDepartureTimezone = airportTimezones[normalizeAirportCode(from)] ?? null;
              updateLeg((l) => ({ ...l, from, departureTimezone: nextDepartureTimezone, validatedFlight: null }));
            }}
            onSelectAirport={(code, timezone) => {
              updateLeg((l) => ({ ...l, from: code, departureTimezone: timezone, validatedFlight: null }));
            }}
          />
        </div>
        <div>
          <label className="mb-2 block text-xs font-medium uppercase tracking-[0.2em] text-slate-400">Estimated departure</label>
          <div className="relative">
            <input
              ref={departureInputRef}
              type="datetime-local"
              aria-label={`Estimated departure for leg ${legIndex + 1}`}
              value={hasHydrated ? toDateTimeLocalValue(leg.departureTime, departureTimezone) : ''}
              onChange={(event) => {
                const departureTime = fromDateTimeLocalValue(event.target.value, departureTimezone);
                updateLeg((l) => ({ ...l, departureTime, validatedFlight: null }));
              }}
              className="w-full rounded-2xl border border-white/10 bg-slate-950/90 px-3 py-2 pr-11 text-sm text-slate-100 outline-none transition focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-500/20"
              aria-busy={!hasHydrated}
            />
            {hasHydrated ? (
              <button
                type="button"
                aria-label={`Open date picker for leg ${legIndex + 1}`}
                title="Open date picker"
                onClick={() => openPicker(departureInputRef)}
                className="absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-slate-300 transition hover:bg-slate-900/80 hover:text-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/30"
              >
                <CalendarDays className="h-4 w-4" />
              </button>
            ) : null}
            {!hasHydrated ? (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 animate-pulse rounded-2xl border border-white/10 bg-slate-900/70"
              />
            ) : null}
          </div>
          <p className={`mt-1.5 text-xs ${departureTimezone ? 'text-slate-500' : leg.from ? 'text-amber-200/80' : 'text-slate-500'}`}>
            {departureTimezone
              ? `Uses ${departureTimezone} for ${normalizeAirportCode(leg.from)}.`
              : leg.from
                ? `Timezone for ${normalizeAirportCode(leg.from)} is unavailable, so this field falls back to your local time.`
                : 'Enter the local time at the departure airport for accurate display and cron timing.'}
          </p>
        </div>
        <div className="relative">
          <label className="mb-2 block text-xs font-medium uppercase tracking-[0.2em] text-slate-400">To</label>
          <AirportAutocomplete
            fieldKey={toFieldKey}
            value={leg.to ?? ''}
            placeholder="LIS"
            aria-label={`To airport for leg ${legIndex + 1}`}
            listboxLabel={`Arrival airport suggestions for leg ${legIndex + 1}`}
            legId={leg.id}
            onChange={(to) => {
              updateLeg((l) => ({ ...l, to, validatedFlight: null }));
            }}
            onSelectAirport={(code) => {
              updateLeg((l) => ({ ...l, to: code, validatedFlight: null }));
            }}
          />
        </div>
        <div>
          <label className="mb-2 block text-xs font-medium uppercase tracking-[0.2em] text-slate-400">Estimated arrival</label>
          <div className="relative">
            <input
              ref={arrivalInputRef}
              type="datetime-local"
              aria-label={`Estimated arrival for leg ${legIndex + 1}`}
              value={hasHydrated ? toDateTimeLocalValue(leg.arrivalTime ?? leg.validatedFlight?.matchedArrivalTime ?? '', arrivalTimezone) : ''}
              onChange={(event) => {
                const arrivalTime = fromDateTimeLocalValue(event.target.value, arrivalTimezone);
                updateLeg((l) => ({ ...l, arrivalTime: arrivalTime || null, validatedFlight: null }));
              }}
              className="w-full rounded-2xl border border-white/10 bg-slate-950/90 px-3 py-2 pr-11 text-sm text-slate-100 outline-none transition focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-500/20"
              aria-busy={!hasHydrated}
            />
            {hasHydrated ? (
              <button
                type="button"
                aria-label={`Open arrival date picker for leg ${legIndex + 1}`}
                title="Open arrival date picker"
                onClick={() => openPicker(arrivalInputRef)}
                className="absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-slate-300 transition hover:bg-slate-900/80 hover:text-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/30"
              >
                <CalendarDays className="h-4 w-4" />
              </button>
            ) : null}
            {!hasHydrated ? (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 animate-pulse rounded-2xl border border-white/10 bg-slate-900/70"
              />
            ) : null}
          </div>
          <p className="mt-1.5 text-xs text-slate-500">
            {arrivalTimezone
              ? `Optional: uses ${arrivalTimezone} for ${normalizeAirportCode(leg.to)}.`
              : leg.to
                ? `Optional: timezone for ${normalizeAirportCode(leg.to)} is unavailable, so this field falls back to your local time.`
                : 'Optional: enter the local arrival time when you know it, or leave it blank.'}
          </p>
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
              updateLeg((l) => ({ ...l, resolvedIcao24: null, lastResolvedAt: null, validatedFlight: null }));
            }}
            className="rounded-full border border-white/10 bg-slate-900/80 px-2.5 py-1 font-medium text-slate-200 transition hover:border-white/20 hover:bg-slate-900"
          >
            Clear lock
          </button>
        </div>
      ) : null}

      {showInlineValidationBanner && validationResult ? (
        <div className={`mt-3 rounded-2xl border px-3 py-2 text-xs ${validationResult.status === 'warning'
          ? 'border-amber-400/35 bg-amber-500/10 text-amber-100'
          : validationResult.status === 'skipped'
            ? 'border-slate-400/25 bg-slate-900/70 text-slate-200'
            : 'border-rose-400/35 bg-rose-500/10 text-rose-100'}`}
        >
          <p className="font-semibold">
            {validationResult.status === 'warning'
              ? 'Provider match needs review'
              : validationResult.status === 'skipped'
                ? 'Validation skipped'
                : validationResult.status === 'not-found'
                  ? 'No live match found'
                  : 'Validation error'}
          </p>
          <p className="mt-1">{validationResult.message}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {validationResult.providerLabel ? (
              <span className="rounded-full border border-white/15 bg-slate-950/40 px-2 py-1">
                Source: {validationResult.providerLabel}
              </span>
            ) : null}
            {validationResult.matchedRoute ? (
              <span className="rounded-full border border-white/15 bg-slate-950/40 px-2 py-1">
                Route: {validationResult.matchedRoute}
              </span>
            ) : null}
            {validationResult.departureDeltaMinutes != null ? (
              <span className="rounded-full border border-white/15 bg-slate-950/40 px-2 py-1">
                Delta: {validationResult.departureDeltaMinutes > 0 ? '+' : ''}{validationResult.departureDeltaMinutes} min
              </span>
            ) : null}
            {formatValidationTimestamp(validationResult.matchedArrivalTime) ? (
              <span className="rounded-full border border-white/15 bg-slate-950/40 px-2 py-1">
                Arrival: {formatValidationTimestamp(validationResult.matchedArrivalTime)} UTC
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
