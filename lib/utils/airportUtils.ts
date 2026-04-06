import type { AirportDirectoryResponse } from '~/components/tracker/flight/types';

export function normalizeAirportCode(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

export function getAirportFieldKey(friendId: string, legId: string, field: 'from' | 'to'): string {
  return `${friendId}:${legId}:${field}`;
}

export function getAirportSuggestionCode(airport: AirportDirectoryResponse['airports'][number]): string {
  return normalizeAirportCode(airport.iata ?? airport.icao ?? airport.code);
}

export function formatAirportSuggestionLabel(airport: AirportDirectoryResponse['airports'][number]): string {
  const code = getAirportSuggestionCode(airport);
  const label = airport.name ?? airport.city ?? airport.country ?? 'Unknown airport';
  return `${code} — ${label}`;
}
