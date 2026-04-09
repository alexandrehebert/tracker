'use client';

import { useEffect, useState } from 'react';
import { MapPin, X } from 'lucide-react';
import type { AirportDetails, FlightMapAirportMarker } from '~/components/tracker/flight/types';

interface AirportDetailsModalProps {
  airport: FlightMapAirportMarker;
  onClose: () => void;
}

function formatAirportCodes(details: AirportDetails): string {
  const codes = [details.iata, details.icao, details.code].filter(
    (value, index, values): value is string => Boolean(value) && values.indexOf(value) === index,
  );

  return codes.length ? codes.join(' · ') : '—';
}

function formatCoordinates(latitude: number | null, longitude: number | null): string {
  if (latitude == null || longitude == null) {
    return '—';
  }

  return `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
}

export function AirportDetailsModal({ airport, onClose }: AirportDetailsModalProps) {
  const [details, setDetails] = useState<AirportDetails | null>(null);

  useEffect(() => {
    let isCancelled = false;

    void (async () => {
      try {
        const response = await fetch(`/api/airports?codes=${encodeURIComponent(airport.code)}`, {
          cache: 'force-cache',
        });

        if (!response.ok || isCancelled) {
          return;
        }

        const payload = await response.json() as { airports?: AirportDetails[] };
        if (!isCancelled && payload.airports?.[0]) {
          setDetails(payload.airports[0]);
        }
      } catch {
        // silently fail — basic info from the marker is still shown
      }
    })();

    return () => {
      isCancelled = true;
    };
  }, [airport.code]);

  const name = details?.name ?? airport.label;
  const codes = details ? formatAirportCodes(details) : airport.code;
  const city = details?.city ?? null;
  const country = details?.country ?? null;
  const timezone = details?.timezone ?? null;
  const latitude = details?.latitude ?? airport.latitude;
  const longitude = details?.longitude ?? airport.longitude;

  const location = [city, country].filter(Boolean).join(', ') || null;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto bg-slate-950/80 p-4 pt-12 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Airport details: ${name}`}
        className="w-full max-w-md overflow-hidden rounded-3xl border border-purple-400/25 bg-slate-950/97 shadow-2xl shadow-slate-950/40"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-white/10 px-4 py-3">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-purple-300">Airport</p>
            <h3 className="mt-0.5 text-base font-semibold text-white">{name}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/10 bg-slate-900/80 p-2 text-slate-200 transition hover:border-white/20 hover:bg-slate-800"
            aria-label="Close airport details"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 px-4 py-4">
          <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Codes</p>
                <p className="mt-1 font-semibold text-cyan-100">{codes}</p>
              </div>
              {location ? (
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Location</p>
                  <p className="mt-1 text-slate-200">{location}</p>
                </div>
              ) : null}
              {timezone ? (
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Timezone</p>
                  <p className="mt-1 text-slate-200">{timezone}</p>
                </div>
              ) : null}
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Coordinates</p>
                <p className="mt-1 text-slate-200">{formatCoordinates(latitude, longitude)}</p>
              </div>
            </div>
          </div>

          {latitude != null && longitude != null ? (
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-slate-900/60 px-3 py-2.5 text-sm text-slate-200 transition hover:border-white/20 hover:bg-slate-800"
            >
              <MapPin className="h-4 w-4 text-purple-300" />
              View on map
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}
