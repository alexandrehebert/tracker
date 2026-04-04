import type { FlightSourceName } from '~/components/tracker/flight/types';

export type ProviderName = FlightSourceName;

const PROVIDER_DISABLE_ENV: Record<ProviderName, string> = {
  opensky: 'OPENSKY_DISABLED',
  flightaware: 'FLIGHTAWARE_DISABLED',
  aviationstack: 'AVIATIONSTACK_DISABLED',
};

export function isProviderEnabled(name: ProviderName): boolean {
  const disableKey = PROVIDER_DISABLE_ENV[name];
  const disableValue = process.env[disableKey]?.trim().toLowerCase();
  return disableValue !== '1' && disableValue !== 'true' && disableValue !== 'yes';
}

export function getEnabledProviders(): ProviderName[] {
  return (['opensky', 'flightaware', 'aviationstack'] as ProviderName[]).filter(isProviderEnabled);
}
