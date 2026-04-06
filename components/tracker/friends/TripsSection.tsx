'use client';

import { Download, MapPin, Plus, Upload, Users } from 'lucide-react';
import { useFriendsConfig } from './FriendsConfigContext';

export function TripsSection() {
  const {
    trips,
    selectedTripId,
    setSelectedTripId,
    currentTripId,
    selectedTrip,
    currentTrip,
    jsonNotice,
    isSaving,
    isSavingCronToggle,
    fileInputRef,
    addTrip,
    setTripPendingRemovalId,
    updateSelectedTrip,
    handleImport,
    handleExport,
    handlePublishCurrentTrip,
  } = useFriendsConfig();

  return (
    <section className="rounded-3xl border border-white/10 bg-slate-950/55 p-4 backdrop-blur-sm sm:p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sky-200">
            <Users className="h-4 w-4" />
            <p className="text-xs uppercase tracking-[0.24em]">Group trips</p>
          </div>
          <p className="mt-3 max-w-3xl text-sm text-slate-300">
            Keep each destination in its own trip, quickly switch which one you are editing, and decide which trip should currently power the live `/chantal` page.
          </p>
        </div>

        <div className="flex w-full flex-col gap-2 lg:w-auto lg:min-w-[18rem]">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={handleImport}
          />
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-white/12 bg-slate-950/80 px-4 py-2 text-sm font-medium text-slate-100 transition hover:border-white/20 hover:bg-slate-900"
            >
              <Upload className="h-4 w-4" />
              Import
            </button>
            <button
              type="button"
              onClick={handleExport}
              className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-white/12 bg-slate-950/80 px-4 py-2 text-sm font-medium text-slate-100 transition hover:border-white/20 hover:bg-slate-900"
            >
              <Download className="h-4 w-4" />
              Export
            </button>
            <button
              type="button"
              onClick={addTrip}
              className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-white/12 bg-slate-950/80 px-4 py-2 text-sm font-medium text-slate-100 transition hover:border-white/20 hover:bg-slate-900 sm:col-span-2 lg:col-span-1 xl:col-span-2"
            >
              <Plus className="h-4 w-4" />
              Add trip
            </button>
          </div>

          {jsonNotice ? (
            <div
              className={`rounded-2xl border px-3 py-2 text-xs ${jsonNotice.type === 'success'
                ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-100'
                : 'border-rose-400/30 bg-rose-500/10 text-rose-100'}`}
            >
              {jsonNotice.text}
            </div>
          ) : null}
        </div>
      </div>

      {trips.length > 0 ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {trips.map((trip, index) => {
            const isSelected = trip.id === selectedTripId;
            const isCurrent = trip.id === currentTripId;

            return (
              <button
                key={trip.id}
                type="button"
                onClick={() => setSelectedTripId(trip.id)}
                className={`rounded-2xl border p-4 text-left transition ${isSelected
                  ? 'border-cyan-400/50 bg-cyan-500/10 shadow-lg shadow-cyan-950/10'
                  : 'border-white/10 bg-slate-950/70 hover:border-white/20 hover:bg-slate-900/80'}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-white">{trip.name || `Untitled trip ${index + 1}`}</div>
                    <p className="mt-1 text-xs text-slate-400">
                      {trip.friends.length} friend{trip.friends.length === 1 ? '' : 's'} • {trip.destinationAirport || 'No destination yet'}
                    </p>
                  </div>
                  {isCurrent ? (
                    <span className="rounded-full border border-emerald-400/40 bg-emerald-500/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-100">
                      Live
                    </span>
                  ) : null}
                </div>

                <p className={`mt-3 text-xs ${isSelected ? 'text-cyan-100' : 'text-slate-400'}`}>
                  {trip.isDemo
                    ? 'Built-in demo using TEST1, TEST2, and TEST3.'
                    : isSelected
                      ? 'Currently open below.'
                      : 'Tap to edit this trip.'}
                </p>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="mt-4 rounded-2xl border border-dashed border-white/10 bg-slate-950/35 p-5 text-sm text-slate-400">
          No trips yet. Add one to start building the next group journey.
        </div>
      )}

      {selectedTrip ? (
        <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,0.85fr)]">
          <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-4">
            <p className="text-xs uppercase tracking-[0.24em] text-sky-200">Trip details</p>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="md:col-span-2">
                <label className="mb-2 block text-xs font-medium uppercase tracking-[0.2em] text-slate-400">
                  Trip name
                </label>
                <input
                  value={selectedTrip.name}
                  onChange={(event) => {
                    const name = event.target.value;
                    updateSelectedTrip((trip) => ({ ...trip, name }));
                  }}
                  placeholder="Weekend in Lisbon"
                  className="w-full rounded-2xl border border-white/10 bg-slate-950/90 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-500/20"
                />
              </div>

              <div>
                <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.2em] text-slate-400">
                  <MapPin className="h-3.5 w-3.5" />
                  Meeting destination(s)
                </div>
                <input
                  value={selectedTrip.destinationAirport ?? ''}
                  onChange={(event) => {
                    const destinationAirport = event.target.value.toUpperCase();
                    updateSelectedTrip((trip) => ({ ...trip, destinationAirport }));
                  }}
                  placeholder="e.g. JFK, EWR, LGA"
                  maxLength={64}
                  className="w-full rounded-2xl border border-white/10 bg-slate-950/90 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-500/20"
                />
                <p className="mt-2 text-xs text-slate-400">
                  Match the airport codes used in each leg&apos;s &quot;To&quot; field, and separate alternatives with commas such as `JFK, EWR` or `MIA, FLL, PBI`.
                </p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-3 text-sm text-slate-300">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-400">How this is used</div>
                <p className="mt-2">
                  The meeting airport lets the Chantal map decide which legs belong to the outbound trip and which ones are part of the return.
                </p>
                <p className="mt-2 text-xs text-slate-400">
                  {selectedTrip.id === currentTripId
                    ? 'This trip is already the one shown live on `/chantal`.'
                    : 'This trip stays as a draft until you set it as current.'}
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-4">
            <p className="text-xs uppercase tracking-[0.24em] text-sky-200">Publishing</p>

            <div className="mt-3 space-y-3">
              <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-3 text-sm text-slate-200">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Shown right now on `/chantal`</div>
                <div className="mt-1 font-semibold text-white">{currentTrip?.name ?? '—'}</div>
                <div className="mt-1 text-xs text-slate-400">
                  {selectedTrip.id === currentTripId ? 'This trip is already live.' : 'Switch to this trip when you are ready — it updates `/chantal` immediately.'}
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  if (selectedTrip.id !== currentTripId) {
                    void handlePublishCurrentTrip(selectedTrip.id);
                  }
                }}
                disabled={selectedTrip.id === currentTripId || isSaving || isSavingCronToggle}
                className={`inline-flex w-full items-center justify-center rounded-full px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${selectedTrip.id === currentTripId
                  ? 'border border-emerald-400/40 bg-emerald-500/10 text-emerald-100'
                  : 'border border-sky-400/40 bg-sky-500/10 text-sky-100 hover:bg-sky-500/20'}`}
              >
                {selectedTrip.id === currentTripId ? 'Current on /chantal' : 'Set as current trip'}
              </button>

              {!selectedTrip.isDemo ? (
                <button
                  type="button"
                  onClick={() => setTripPendingRemovalId(selectedTrip.id)}
                  className="inline-flex w-full items-center justify-center rounded-full border border-rose-400/30 bg-rose-500/10 px-4 py-2 text-sm font-medium text-rose-100 transition hover:bg-rose-500/20"
                >
                  Remove this trip
                </button>
              ) : (
                <div className="rounded-2xl border border-sky-400/30 bg-sky-500/10 px-4 py-3 text-sm text-sky-100">
                  Built-in demo trip — handy for TEST1, TEST2, and TEST3 validation.
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
