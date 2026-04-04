'use client';

import { useEffect, useMemo, useState } from 'react';
import { Globe2, LoaderCircle, MapPin, Search } from 'lucide-react';
import type { AirportDirectoryResponse, AirportMapEntry } from '~/components/tracker/flight/types';
import type { WorldMapPayload } from '~/lib/server/worldMap';

const DEFAULT_VISIBLE_ROWS = 200;
const FILTER_MARKER_LIMIT = 250;

function getCopy(locale: string) {
  if (locale === 'fr') {
    return {
      searchPlaceholder: 'Rechercher un aeroport, une ville, un pays ou un code…',
      mapTitle: 'Carte mondiale des aeroports',
      mapDescription: 'Tous les aeroports connus avec coordonnees sont traces sur la carte ci-dessous.',
      listTitle: 'Liste des aeroports',
      loading: 'Chargement de l’annuaire des aeroports…',
      errorFallback: 'Impossible de charger l’annuaire des aeroports pour le moment.',
      noResults: 'Aucun aeroport ne correspond a cette recherche.',
      showMore: 'Afficher plus',
      totalLabel: 'Total',
      mappedLabel: 'Sur la carte',
      countriesLabel: 'Pays',
      showingLabel: 'affiches',
      selectedLabel: 'Aeroport selectionne',
      locationFallback: 'Localisation indisponible',
      timezoneLabel: 'Fuseau',
      coordinatesLabel: 'Coordonnees',
      locationLabel: 'Lieu',
      updatedLabel: 'Mis a jour',
    };
  }

  return {
    searchPlaceholder: 'Search an airport, city, country, or code…',
    mapTitle: 'World airport map',
    mapDescription: 'All known airports with coordinates are plotted on the map below.',
    listTitle: 'Airport list',
    loading: 'Loading the airport directory…',
    errorFallback: 'Unable to load the airport directory right now.',
    noResults: 'No airports match this search.',
    showMore: 'Show more',
    totalLabel: 'Total',
    mappedLabel: 'Mapped',
    countriesLabel: 'Countries',
    showingLabel: 'shown',
    selectedLabel: 'Selected airport',
    locationFallback: 'Location unavailable',
    timezoneLabel: 'Timezone',
    coordinatesLabel: 'Coordinates',
    locationLabel: 'Location',
    updatedLabel: 'Updated',
  };
}

function getAirportKey(airport: AirportMapEntry): string {
  return airport.icao || airport.iata || airport.code;
}

function formatAirportCodes(airport: AirportMapEntry): string {
  const codes = [airport.iata, airport.icao, airport.code].filter(
    (value, index, values): value is string => Boolean(value) && values.indexOf(value) === index,
  );

  return codes.length ? codes.join(' • ') : '—';
}

function formatAirportLocation(airport: AirportMapEntry, fallback: string): string {
  const parts = [airport.city, airport.country].filter(Boolean);
  return parts.length ? parts.join(', ') : fallback;
}

function buildAirportSearchValue(airport: AirportMapEntry): string {
  return [
    airport.code,
    airport.iata,
    airport.icao,
    airport.name,
    airport.city,
    airport.country,
    airport.timezone,
  ]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join(' ')
    .toLowerCase();
}

function buildMarkerPath(airports: AirportMapEntry[]): string {
  return airports
    .filter((airport) => airport.x != null && airport.y != null)
    .map((airport) => {
      const x = airport.x!.toFixed(2);
      const y = airport.y!.toFixed(2);
      return `M ${x} ${y} m -1.15 0 a 1.15 1.15 0 1 0 2.3 0 a 1.15 1.15 0 1 0 -2.3 0`;
    })
    .join(' ');
}

export function AirportsExplorer({ map, locale }: { map: WorldMapPayload; locale: string }) {
  const copy = useMemo(() => getCopy(locale), [locale]);
  const [payload, setPayload] = useState<AirportDirectoryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [visibleCount, setVisibleCount] = useState(DEFAULT_VISIBLE_ROWS);
  const [selectedAirportKey, setSelectedAirportKey] = useState<string | null>(null);

  useEffect(() => {
    let isCancelled = false;

    void (async () => {
      try {
        const response = await fetch('/api/airports', { cache: 'force-cache' });
        const nextPayload = await response.json() as AirportDirectoryResponse & { error?: string };

        if (!response.ok) {
          throw new Error(nextPayload.error || copy.errorFallback);
        }

        if (isCancelled) {
          return;
        }

        setPayload(nextPayload);
        setSelectedAirportKey(nextPayload.airports[0] ? getAirportKey(nextPayload.airports[0]) : null);
        setError(null);
      } catch (caughtError) {
        if (!isCancelled) {
          setError(caughtError instanceof Error ? caughtError.message : copy.errorFallback);
        }
      }
    })();

    return () => {
      isCancelled = true;
    };
  }, [copy.errorFallback]);

  useEffect(() => {
    setVisibleCount(DEFAULT_VISIBLE_ROWS);
  }, [search]);

  const airports = payload?.airports ?? [];
  const formatter = useMemo(() => new Intl.NumberFormat(locale), [locale]);

  const filteredAirports = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    if (!normalizedSearch) {
      return airports;
    }

    return airports.filter((airport) => buildAirportSearchValue(airport).includes(normalizedSearch));
  }, [airports, search]);

  useEffect(() => {
    if (!filteredAirports.length) {
      setSelectedAirportKey(null);
      return;
    }

    const hasCurrentSelection = selectedAirportKey
      ? filteredAirports.some((airport) => getAirportKey(airport) === selectedAirportKey)
      : false;

    if (!hasCurrentSelection) {
      setSelectedAirportKey(getAirportKey(filteredAirports[0]!));
    }
  }, [filteredAirports, selectedAirportKey]);

  const selectedAirport = useMemo(() => {
    return filteredAirports.find((airport) => getAirportKey(airport) === selectedAirportKey) ?? filteredAirports[0] ?? null;
  }, [filteredAirports, selectedAirportKey]);

  const visibleAirports = useMemo(() => {
    return filteredAirports.slice(0, visibleCount);
  }, [filteredAirports, visibleCount]);

  const mappedAirports = useMemo(() => {
    return airports.filter((airport) => airport.x != null && airport.y != null);
  }, [airports]);

  const highlightedAirports = useMemo(() => {
    const matches = filteredAirports
      .filter((airport) => airport.x != null && airport.y != null)
      .slice(0, FILTER_MARKER_LIMIT);

    if (selectedAirport && selectedAirport.x != null && selectedAirport.y != null) {
      const selectedKey = getAirportKey(selectedAirport);
      if (!matches.some((airport) => getAirportKey(airport) === selectedKey)) {
        matches.push(selectedAirport);
      }
    }

    return matches;
  }, [filteredAirports, selectedAirport]);

  const backgroundMarkerPath = useMemo(() => buildMarkerPath(mappedAirports), [mappedAirports]);

  const countryCount = useMemo(() => {
    return new Set(
      airports
        .map((airport) => airport.country)
        .filter((country): country is string => typeof country === 'string' && country.trim().length > 0),
    ).size;
  }, [airports]);

  const updatedAt = payload?.fetchedAt
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(payload.fetchedAt)
    : null;

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
      <section className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
            <p className="text-xs uppercase tracking-[0.24em] text-slate-400">{copy.totalLabel}</p>
            <p className="mt-2 text-2xl font-semibold text-white">{formatter.format(payload?.total ?? 0)}</p>
          </div>
          <div className="rounded-2xl border border-cyan-400/20 bg-cyan-500/10 p-4">
            <p className="text-xs uppercase tracking-[0.24em] text-cyan-100/80">{copy.mappedLabel}</p>
            <p className="mt-2 text-2xl font-semibold text-cyan-50">{formatter.format(payload?.mapped ?? 0)}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
            <p className="text-xs uppercase tracking-[0.24em] text-slate-400">{copy.countriesLabel}</p>
            <p className="mt-2 text-2xl font-semibold text-white">{formatter.format(countryCount)}</p>
          </div>
        </div>

        <div className="overflow-hidden rounded-3xl border border-white/10 bg-slate-950/70 shadow-[0_20px_80px_rgba(2,6,23,0.45)]">
          <div className="border-b border-white/10 px-4 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-white">{copy.mapTitle}</h2>
                <p className="mt-1 text-sm text-slate-300">{copy.mapDescription}</p>
              </div>
              {updatedAt ? (
                <div className="rounded-full border border-white/10 bg-slate-900/80 px-3 py-1 text-xs text-slate-300">
                  {copy.updatedLabel} {updatedAt}
                </div>
              ) : null}
            </div>

            <label className="mt-4 flex items-center gap-2 rounded-2xl border border-white/10 bg-slate-900/80 px-3 py-2.5 text-sm text-slate-300">
              <Search className="h-4 w-4 text-cyan-200" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={copy.searchPlaceholder}
                className="w-full bg-transparent outline-none placeholder:text-slate-500"
              />
            </label>
          </div>

          <div className="relative">
            <svg
              viewBox={`0 0 ${map.viewBox.width} ${map.viewBox.height}`}
              preserveAspectRatio="xMidYMid meet"
              className="h-[420px] w-full bg-slate-950"
              role="img"
              aria-label={copy.mapTitle}
            >
              <rect x="0" y="0" width={map.viewBox.width} height={map.viewBox.height} fill="#020617" />

              <g>
                {map.countries.map((country) => (
                  <path
                    key={country.code}
                    d={country.path}
                    fill="#081120"
                    stroke="rgba(148, 163, 184, 0.22)"
                    strokeWidth="0.8"
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
              </g>

              {backgroundMarkerPath ? (
                <path d={backgroundMarkerPath} fill="rgba(34, 211, 238, 0.35)" opacity="0.85" />
              ) : null}

              {highlightedAirports.map((airport) => {
                const isSelected = selectedAirport ? getAirportKey(airport) === getAirportKey(selectedAirport) : false;

                return airport.x != null && airport.y != null ? (
                  <g key={getAirportKey(airport)}>
                    <circle cx={airport.x} cy={airport.y} r={isSelected ? 6.5 : 2.6} fill={isSelected ? '#f59e0b' : '#67e8f9'} opacity={isSelected ? 1 : 0.75} />
                    {isSelected ? <circle cx={airport.x} cy={airport.y} r={12} fill="rgba(245, 158, 11, 0.16)" /> : null}
                  </g>
                ) : null;
              })}
            </svg>

            {!payload && !error ? (
              <div className="absolute inset-0 flex items-center justify-center gap-2 bg-slate-950/70 text-sm text-slate-200 backdrop-blur-sm">
                <LoaderCircle className="h-4 w-4 animate-spin text-cyan-200" />
                {copy.loading}
              </div>
            ) : null}
          </div>

          {selectedAirport ? (
            <div className="border-t border-white/10 px-4 py-4 text-sm text-slate-200">
              <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-[0.22em] text-cyan-100/80">
                <MapPin className="h-3.5 w-3.5" />
                {copy.selectedLabel}
              </div>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                <div>
                  <div className="font-semibold text-white">{selectedAirport.name ?? selectedAirport.code}</div>
                  <div className="text-xs text-cyan-100/90">{formatAirportCodes(selectedAirport)}</div>
                </div>
                <div>
                  <div className="text-slate-400">{copy.coordinatesLabel}</div>
                  <div>
                    {selectedAirport.latitude != null && selectedAirport.longitude != null
                      ? `${selectedAirport.latitude.toFixed(3)}, ${selectedAirport.longitude.toFixed(3)}`
                      : '—'}
                  </div>
                </div>
                <div>
                  <div className="text-slate-400">{copy.timezoneLabel}</div>
                  <div>{selectedAirport.timezone ?? '—'}</div>
                </div>
                <div>
                  <div className="text-slate-400">{copy.locationLabel}</div>
                  <div>{formatAirportLocation(selectedAirport, copy.locationFallback)}</div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <aside className="overflow-hidden rounded-3xl border border-white/10 bg-slate-950/70 shadow-[0_20px_80px_rgba(2,6,23,0.45)]">
        <div className="border-b border-white/10 px-4 py-4">
          <div className="flex items-center gap-2 text-cyan-100">
            <Globe2 className="h-4 w-4" />
            <h2 className="text-lg font-semibold text-white">{copy.listTitle}</h2>
          </div>
          <p className="mt-1 text-sm text-slate-300">
            {formatter.format(visibleAirports.length)} / {formatter.format(filteredAirports.length)} {copy.showingLabel}
          </p>
        </div>

        {error ? (
          <div className="m-4 rounded-2xl border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-50">
            {error}
          </div>
        ) : null}

        <div className="max-h-[740px] space-y-2 overflow-auto p-3">
          {visibleAirports.map((airport) => {
            const airportKey = getAirportKey(airport);
            const isSelected = airportKey === selectedAirportKey;

            return (
              <button
                key={airportKey}
                type="button"
                onClick={() => setSelectedAirportKey(airportKey)}
                className={`w-full rounded-2xl border px-3 py-3 text-left transition ${
                  isSelected
                    ? 'border-cyan-400/40 bg-cyan-500/10 text-cyan-50'
                    : 'border-white/10 bg-slate-900/70 text-slate-200 hover:border-white/20 hover:bg-slate-900'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium text-white">{airport.name ?? airport.code}</div>
                    <div className="mt-1 text-xs text-cyan-100/90">{formatAirportCodes(airport)}</div>
                  </div>
                  <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] text-slate-300">
                    {airport.country ?? '—'}
                  </span>
                </div>
                <div className="mt-2 text-sm text-slate-300">{formatAirportLocation(airport, copy.locationFallback)}</div>
                <div className="mt-1 text-xs text-slate-400">{airport.timezone ?? '—'}</div>
              </button>
            );
          })}

          {payload && !filteredAirports.length ? (
            <div className="rounded-2xl border border-dashed border-white/10 px-3 py-6 text-center text-sm text-slate-400">
              {copy.noResults}
            </div>
          ) : null}
        </div>

        {filteredAirports.length > visibleAirports.length ? (
          <div className="border-t border-white/10 p-3">
            <button
              type="button"
              onClick={() => setVisibleCount((current) => current + DEFAULT_VISIBLE_ROWS)}
              className="w-full rounded-full border border-white/10 bg-slate-900 px-3 py-2 text-sm font-medium text-slate-100 transition hover:border-cyan-300/40 hover:text-cyan-100"
            >
              {copy.showMore}
            </button>
          </div>
        ) : null}
      </aside>
    </div>
  );
}
