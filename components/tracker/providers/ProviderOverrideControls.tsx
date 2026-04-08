'use client';

import { useState, useCallback } from 'react';
import type { ProviderName } from '~/lib/server/providers';
import type { ProviderOverrideState, ProviderOverridesMap } from '~/lib/server/providers/overrides';

const PROVIDER_LABELS: Record<ProviderName, string> = {
  opensky: 'OpenSky',
  flightaware: 'FlightAware',
  aviationstack: 'Aviationstack',
  aerodatabox: 'AeroDataBox',
};

const ALL_PROVIDERS: ProviderName[] = ['opensky', 'flightaware', 'aviationstack', 'aerodatabox'];

interface ProviderOverrideControlsProps {
  initialOverrides: ProviderOverridesMap;
  storageConfigured: boolean;
}

function getOverrideLabel(state: ProviderOverrideState): string {
  if (state === 'enabled') return 'Force enabled';
  if (state === 'disabled') return 'Force disabled';
  return 'Env default';
}

function getOverrideBadgeClass(state: ProviderOverrideState): string {
  if (state === 'enabled') return 'border-emerald-400/40 bg-emerald-500/15 text-emerald-100';
  if (state === 'disabled') return 'border-rose-400/40 bg-rose-500/15 text-rose-100';
  return 'border-slate-400/40 bg-slate-500/10 text-slate-300';
}

export function ProviderOverrideControls({ initialOverrides, storageConfigured }: ProviderOverrideControlsProps) {
  const [overrides, setOverrides] = useState<ProviderOverridesMap>(initialOverrides);
  const [pending, setPending] = useState<ProviderName | null>(null);
  const [error, setError] = useState<string | null>(null);

  const applyOverride = useCallback(async (provider: ProviderName, state: ProviderOverrideState) => {
    setPending(provider);
    setError(null);

    try {
      const response = await fetch('/api/tracker/providers/overrides', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, state }),
        cache: 'no-store',
      });

      const data = await response.json() as { overrides?: ProviderOverridesMap; error?: string };

      if (!response.ok) {
        throw new Error(data.error ?? 'Failed to update provider override.');
      }

      if (data.overrides) {
        setOverrides(data.overrides);
      }
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Failed to update provider override.');
    } finally {
      setPending(null);
    }
  }, []);

  return (
    <section className="mt-6 rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-[0_18px_50px_rgba(2,6,23,0.25)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-white">Provider admin controls</h2>
          <p className="mt-1 text-sm text-slate-300">
            Override environment variable settings to enable or disable individual providers at runtime.
            Changes take effect within 30 seconds on all server instances.
          </p>
        </div>
        {!storageConfigured && (
          <span className="rounded-full border border-amber-400/40 bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-200">
            Requires MongoDB
          </span>
        )}
      </div>

      {error ? (
        <div className="mt-4 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
          {error}
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {ALL_PROVIDERS.map((provider) => {
          const state = overrides[provider];
          const isBusy = pending === provider;

          return (
            <div key={provider} className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-white">{PROVIDER_LABELS[provider]}</span>
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${getOverrideBadgeClass(state)}`}>
                  {getOverrideLabel(state)}
                </span>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={isBusy || !storageConfigured || state === 'enabled'}
                  onClick={() => { void applyOverride(provider, 'enabled'); }}
                  className="rounded-full border border-emerald-400/40 bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-100 transition hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Force enable
                </button>
                <button
                  type="button"
                  disabled={isBusy || !storageConfigured || state === 'disabled'}
                  onClick={() => { void applyOverride(provider, 'disabled'); }}
                  className="rounded-full border border-rose-400/40 bg-rose-500/10 px-2.5 py-1 text-xs text-rose-100 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Force disable
                </button>
                {state !== null && (
                  <button
                    type="button"
                    disabled={isBusy || !storageConfigured}
                    onClick={() => { void applyOverride(provider, null); }}
                    className="rounded-full border border-slate-400/40 bg-slate-500/10 px-2.5 py-1 text-xs text-slate-300 transition hover:bg-slate-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Reset to env
                  </button>
                )}
              </div>

              {isBusy && (
                <p className="mt-2 text-[11px] text-slate-400">Applying…</p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
