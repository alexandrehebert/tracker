'use client';

import { ArrowDown, ArrowUp, PlaneTakeoff, Trash2 } from 'lucide-react';
import { useFriendsConfig } from './FriendsConfigContext';
import { AirportAutocomplete } from './AirportAutocomplete';
import { getAirportFieldKey, normalizeAirportCode } from '~/lib/utils/airportUtils';
import { createDraftLeg } from '~/lib/utils/friendsConfigUtils';
import { fromDateTimeLocalValue, toDateTimeLocalValue } from '~/lib/utils/dateTimeLocal';
import type { FriendFlightLeg } from '~/lib/friendsTracker';

interface FlightLegCardProps {
  friendId: string;
  leg: FriendFlightLeg;
  legIndex: number;
  totalLegs: number;
}

export function FlightLegCard({ friendId, leg, legIndex, totalLegs }: FlightLegCardProps) {
  const { airportTimezones, hasHydrated, activeAirportField, airportSuggestions, updateFriend, moveFriendFlight } = useFriendsConfig();

  const departureTimezone = leg.departureTimezone ?? airportTimezones[normalizeAirportCode(leg.from)] ?? null;
  const fromFieldKey = getAirportFieldKey(friendId, leg.id, 'from');
  const toFieldKey = getAirportFieldKey(friendId, leg.id, 'to');

  const fromSuggestions = activeAirportField === fromFieldKey ? airportSuggestions : [];
  const toSuggestions = activeAirportField === toFieldKey ? airportSuggestions : [];
  const hasOpenSuggestions = fromSuggestions.length > 0 || toSuggestions.length > 0;

  function updateLeg(updater: (l: FriendFlightLeg) => FriendFlightLeg) {
    updateFriend(friendId, (friend) => ({
      ...friend,
      flights: friend.flights.map((fl) => fl.id === leg.id ? updater(fl) : fl),
    }));
  }

  return (
    <div className={`relative rounded-2xl border border-white/10 bg-slate-950/70 p-4 ${hasOpenSuggestions ? 'z-30' : 'z-0'}`}>
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
            onClick={() => {
              updateFriend(friendId, (friend) => ({
                ...friend,
                flights: friend.flights.length > 1
                  ? friend.flights.filter((fl) => fl.id !== leg.id)
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
              updateLeg((l) => ({ ...l, flightNumber }));
            }}
            placeholder="AF123"
            className="w-full rounded-2xl border border-white/10 bg-slate-950/90 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-500/20"
          />
        </div>
        <div className="xl:col-span-1">
          <label className="mb-2 block text-xs font-medium uppercase tracking-[0.2em] text-slate-400">Estimated departure</label>
          <div className="relative">
            <input
              type="datetime-local"
              aria-label={`Estimated departure for leg ${legIndex + 1}`}
              value={hasHydrated ? toDateTimeLocalValue(leg.departureTime, departureTimezone) : ''}
              onChange={(event) => {
                const departureTime = fromDateTimeLocalValue(event.target.value, departureTimezone);
                updateLeg((l) => ({ ...l, departureTime }));
              }}
              className="w-full rounded-2xl border border-white/10 bg-slate-950/90 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-500/20"
              aria-busy={!hasHydrated}
            />
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
              updateLeg((l) => ({ ...l, from, departureTimezone: nextDepartureTimezone }));
            }}
            onSelectAirport={(code, timezone) => {
              updateLeg((l) => ({ ...l, from: code, departureTimezone: timezone }));
            }}
          />
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
              updateLeg((l) => ({ ...l, to }));
            }}
            onSelectAirport={(code) => {
              updateLeg((l) => ({ ...l, to: code }));
            }}
          />
        </div>
        <div>
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
      </div>

      {leg.resolvedIcao24 ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-300">
          <span className="rounded-full border border-cyan-400/30 bg-cyan-500/10 px-2.5 py-1 text-cyan-100">
            Locked ICAO24: {leg.resolvedIcao24}
          </span>
          <button
            type="button"
            onClick={() => {
              updateLeg((l) => ({ ...l, resolvedIcao24: null, lastResolvedAt: null }));
            }}
            className="rounded-full border border-white/10 bg-slate-900/80 px-2.5 py-1 font-medium text-slate-200 transition hover:border-white/20 hover:bg-slate-900"
          >
            Clear lock
          </button>
        </div>
      ) : null}
    </div>
  );
}
