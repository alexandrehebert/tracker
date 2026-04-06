'use client';

import { X } from 'lucide-react';
import { useFriendsConfig } from './FriendsConfigContext';

export function TripRemovalModal() {
  const { tripPendingRemoval, setTripPendingRemovalId, setNotice, removeTrip } = useFriendsConfig();

  if (!tripPendingRemoval) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm"
      onClick={() => setTripPendingRemovalId(null)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Confirm trip removal"
        className="w-full max-w-md overflow-hidden rounded-3xl border border-rose-400/30 bg-slate-950/95 shadow-2xl shadow-rose-950/20"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-white/10 px-4 py-3">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-rose-200">Remove trip</p>
            <h3 className="mt-1 text-lg font-semibold text-white">{tripPendingRemoval.name || 'Untitled trip'}</h3>
          </div>
          <button
            type="button"
            onClick={() => setTripPendingRemovalId(null)}
            className="rounded-full border border-white/10 bg-slate-900/80 p-2 text-slate-200 transition hover:border-white/20 hover:bg-slate-800"
            aria-label="Close remove trip confirmation"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 px-4 py-4 text-sm text-slate-300">
          <p>
            Remove this trip from the editor? This only updates the local form until you click <span className="font-semibold text-white">Save config</span>.
          </p>
          <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-3 text-xs text-slate-300">
            <div>{tripPendingRemoval.friends.length} friend{tripPendingRemoval.friends.length === 1 ? '' : 's'} in this trip</div>
            <div className="mt-1">Meeting airport: {tripPendingRemoval.destinationAirport || 'Not set yet'}</div>
          </div>
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-white/10 px-4 py-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={() => setTripPendingRemovalId(null)}
            className="inline-flex items-center justify-center rounded-full border border-white/10 bg-slate-900/80 px-4 py-2 text-sm font-medium text-slate-100 transition hover:border-white/20 hover:bg-slate-900"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              const removedTripName = tripPendingRemoval.name || 'Trip';
              removeTrip(tripPendingRemoval.id);
              setTripPendingRemovalId(null);
              setNotice({
                type: 'success',
                text: `${removedTripName} removed locally. Click "Save config" to persist the change.`,
              });
            }}
            className="inline-flex items-center justify-center rounded-full border border-rose-400/30 bg-rose-500/10 px-4 py-2 text-sm font-medium text-rose-100 transition hover:bg-rose-500/20"
          >
            Remove trip
          </button>
        </div>
      </div>
    </div>
  );
}
