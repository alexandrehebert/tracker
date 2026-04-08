export function normalizeFlightRadarFlightNumber(value: string | null | undefined): string | null {
  const normalized = value?.trim().toUpperCase().replace(/\s+/g, '') ?? '';
  return normalized.length > 0 ? normalized : null;
}

export function buildFlightRadarUrl(flightNumber: string | null | undefined): string | null {
  const normalizedFlightNumber = normalizeFlightRadarFlightNumber(flightNumber);
  return normalizedFlightNumber
    ? `https://www.flightradar24.com/${encodeURIComponent(normalizedFlightNumber)}`
    : null;
}

export function openFlightRadarUrl(flightNumber: string | null | undefined): void {
  if (typeof window === 'undefined') {
    return;
  }

  const url = buildFlightRadarUrl(flightNumber);
  if (!url) {
    return;
  }

  window.open(url, '_blank', 'noopener,noreferrer');
}
