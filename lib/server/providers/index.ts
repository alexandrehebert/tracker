import type { FlightSourceName } from '~/components/tracker/flight/types';
import { getCachedProviderOverrides } from './overrides';

export type ProviderName = FlightSourceName;

export const ALL_PROVIDERS = ['opensky', 'flightaware', 'aviationstack', 'aerodatabox'] as const satisfies readonly ProviderName[];
const PROVIDER_DISABLE_ENV: Record<ProviderName, string> = {
  opensky: 'OPENSKY_DISABLED',
  flightaware: 'FLIGHTAWARE_DISABLED',
  aviationstack: 'AVIATIONSTACK_DISABLED',
  aerodatabox: 'AERODATABOX_DISABLED',
};
const PROVIDER_LABELS: Record<ProviderName, string> = {
  opensky: 'OpenSky',
  flightaware: 'FlightAware',
  aviationstack: 'Aviationstack',
  aerodatabox: 'AeroDataBox',
};
const ENABLED_PROVIDER_ENV_KEYS = ['ENABLED_API_PROVIDERS', 'TRACKER_ENABLED_PROVIDERS'] as const;
const DISABLED_PROVIDER_ENV_KEYS = ['DISABLED_API_PROVIDERS', 'TRACKER_DISABLED_PROVIDERS'] as const;
const TRUTHY_ENV_VALUES = new Set(['1', 'true', 'yes', 'on']);

function isTruthyEnvValue(value: string | undefined): boolean {
  return TRUTHY_ENV_VALUES.has(value?.trim().toLowerCase() ?? '');
}

function parseProviderList(value: string | undefined): Set<ProviderName> | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (normalized === '*' || normalized === 'all') {
    return new Set(ALL_PROVIDERS);
  }

  if (normalized === 'none' || normalized === 'off' || normalized === 'false' || normalized === '0') {
    return new Set<ProviderName>();
  }

  const allowed = new Set<ProviderName>();

  for (const entry of normalized.split(/[\s,]+/)) {
    if ((ALL_PROVIDERS as readonly string[]).includes(entry)) {
      allowed.add(entry as ProviderName);
    }
  }

  return allowed;
}

function getConfiguredEnvValue(keys: readonly string[]): { key: string; value: string } | null {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) {
      return { key, value };
    }
  }

  return null;
}

export function getProviderDisabledReason(name: ProviderName): string | null {
  const providerDisableKey = PROVIDER_DISABLE_ENV[name];
  if (isTruthyEnvValue(process.env[providerDisableKey])) {
    return `${PROVIDER_LABELS[name]} provider is disabled by \`${providerDisableKey}\`.`;
  }

  const enabledProvidersConfig = getConfiguredEnvValue(ENABLED_PROVIDER_ENV_KEYS);
  const explicitlyEnabledProviders = enabledProvidersConfig ? parseProviderList(enabledProvidersConfig.value) : null;
  if (enabledProvidersConfig && explicitlyEnabledProviders && !explicitlyEnabledProviders.has(name)) {
    return `${PROVIDER_LABELS[name]} provider is disabled by \`${enabledProvidersConfig.key}\`.`;
  }

  const disabledProvidersConfig = getConfiguredEnvValue(DISABLED_PROVIDER_ENV_KEYS);
  const explicitlyDisabledProviders = disabledProvidersConfig ? parseProviderList(disabledProvidersConfig.value) : null;
  if (disabledProvidersConfig && explicitlyDisabledProviders?.has(name)) {
    return `${PROVIDER_LABELS[name]} provider is disabled by \`${disabledProvidersConfig.key}\`.`;
  }

  return null;
}

export async function getProviderDisabledReasonAsync(name: ProviderName): Promise<string | null> {
  const overrides = await getCachedProviderOverrides();
  const override = overrides[name];

  if (override === 'disabled') {
    return `${PROVIDER_LABELS[name]} provider is disabled via the admin control panel.`;
  }

  if (override === 'enabled') {
    return null;
  }

  return getProviderDisabledReason(name);
}

export function isProviderEnabled(name: ProviderName): boolean {
  return getProviderDisabledReason(name) == null;
}

export async function isProviderEnabledAsync(name: ProviderName): Promise<boolean> {
  return (await getProviderDisabledReasonAsync(name)) == null;
}

export function getEnabledProviders(): ProviderName[] {
  return [...ALL_PROVIDERS].filter(isProviderEnabled);
}

export function getProviderLabel(name: ProviderName): string {
  return PROVIDER_LABELS[name];
}
