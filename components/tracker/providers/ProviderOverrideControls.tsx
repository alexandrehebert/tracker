'use client';

import { ExternalLink } from 'lucide-react';
import { useCallback, useState } from 'react';
import type { ProviderName } from '~/lib/server/providers';
import type { ProviderOverrideState, ProviderOverridesMap } from '~/lib/server/providers/overrides';

const PROVIDER_LABELS: Record<ProviderName, string> = {
  opensky: 'OpenSky',
  flightaware: 'FlightAware',
  aviationstack: 'Aviationstack',
  airlabs: 'AirLabs',
  aerodatabox: 'AeroDataBox',
};

const ALL_PROVIDERS: ProviderName[] = ['opensky', 'flightaware', 'aviationstack', 'airlabs', 'aerodatabox'];

type ProviderStatusTone = 'active' | 'disabled' | 'warning';

interface ProviderStatusSummary {
  label: string;
  detail: string;
  tone: ProviderStatusTone;
}

interface ProviderStatusSet {
  defaultStatus: ProviderStatusSummary;
  forceEnabledStatus: ProviderStatusSummary;
  forceDisabledStatus: ProviderStatusSummary;
}

interface ProviderMetricSummary {
  totalRequests: number;
  averageDurationMs: number | null;
  successCount: number;
  errorCount: number;
  callers: Array<{ label: string; count: number }>;
}

interface ProviderResourceLink {
  href: string;
  label: string;
}

interface ProviderCardData {
  provider: ProviderName;
  name: string;
  baseNote?: string;
  defaultNote?: string;
  connectionDetail?: string | null;
  connectionStatusLabel?: string | null;
  connectionTone?: ProviderStatusTone | null;
  extra?: string | null;
  debugHref?: string | null;
  resourceLinks?: ProviderResourceLink[];
  connectionLinks?: ProviderResourceLink[];
  metrics?: Partial<ProviderMetricSummary>;
}

const UNKNOWN_STATUS: ProviderStatusSummary = {
  label: 'Unknown',
  detail: 'Status will refresh with the next server render.',
  tone: 'warning',
};

const DEFAULT_PROVIDER_STATUSES: Record<ProviderName, ProviderStatusSet> = {
  opensky: {
    defaultStatus: UNKNOWN_STATUS,
    forceEnabledStatus: UNKNOWN_STATUS,
    forceDisabledStatus: UNKNOWN_STATUS,
  },
  flightaware: {
    defaultStatus: UNKNOWN_STATUS,
    forceEnabledStatus: UNKNOWN_STATUS,
    forceDisabledStatus: UNKNOWN_STATUS,
  },
  aviationstack: {
    defaultStatus: UNKNOWN_STATUS,
    forceEnabledStatus: UNKNOWN_STATUS,
    forceDisabledStatus: UNKNOWN_STATUS,
  },
  airlabs: {
    defaultStatus: UNKNOWN_STATUS,
    forceEnabledStatus: UNKNOWN_STATUS,
    forceDisabledStatus: UNKNOWN_STATUS,
  },
  aerodatabox: {
    defaultStatus: UNKNOWN_STATUS,
    forceEnabledStatus: UNKNOWN_STATUS,
    forceDisabledStatus: UNKNOWN_STATUS,
  },
};

const DEFAULT_PROVIDER_CARDS: ProviderCardData[] = ALL_PROVIDERS.map((provider) => ({
  provider,
  name: PROVIDER_LABELS[provider],
  baseNote: '',
  defaultNote: '',
  connectionDetail: null,
  connectionStatusLabel: null,
  connectionTone: null,
  extra: null,
  debugHref: null,
  resourceLinks: [],
  connectionLinks: [],
  metrics: {
    totalRequests: 0,
    averageDurationMs: null,
    successCount: 0,
    errorCount: 0,
    callers: [],
  },
}));

interface ProviderOverrideControlsProps {
  initialOverrides: ProviderOverridesMap;
  storageConfigured: boolean;
  providerStatuses?: Record<ProviderName, ProviderStatusSet>;
  providerCards?: ProviderCardData[];
}

function formatDuration(value: number | null): string {
  if (value == null || !Number.isFinite(value)) {
    return '—';
  }

  if (value < 1_000) {
    return `${Math.round(value)} ms`;
  }

  return `${(value / 1_000).toFixed(2)} s`;
}

function getOverrideOptionClass(optionState: ProviderOverrideState, isSelected: boolean): string {
  const baseClass = 'flex-1 rounded-xl border px-3 py-1.5 text-xs font-medium transition';

  if (optionState === 'enabled') {
    return `${baseClass} ${isSelected
      ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-50'
      : 'border-transparent bg-transparent text-slate-300 hover:border-emerald-400/20 hover:bg-emerald-500/10 hover:text-emerald-100'}`;
  }

  if (optionState === 'disabled') {
    return `${baseClass} ${isSelected
      ? 'border-rose-400/40 bg-rose-500/15 text-rose-50'
      : 'border-transparent bg-transparent text-slate-300 hover:border-rose-400/20 hover:bg-rose-500/10 hover:text-rose-100'}`;
  }

  return `${baseClass} ${isSelected
    ? 'border-sky-400/30 bg-sky-500/15 text-sky-50'
    : 'border-transparent bg-transparent text-slate-300 hover:border-sky-400/20 hover:bg-sky-500/10 hover:text-sky-100'}`;
}

function getRuntimeStatusBadgeClass(tone: ProviderStatusTone | null | undefined): string {
  if (tone === 'active') return 'border-emerald-400/40 bg-emerald-500/15 text-emerald-100';
  if (tone === 'disabled') return 'border-rose-400/40 bg-rose-500/15 text-rose-100';
  if (tone === 'warning') return 'border-amber-400/40 bg-amber-500/15 text-amber-100';
  return 'border-slate-400/40 bg-slate-500/10 text-slate-200';
}

function getDisplayedStatus(statusSet: ProviderStatusSet, state: ProviderOverrideState): ProviderStatusSummary {
  if (state === 'enabled') return statusSet.forceEnabledStatus;
  if (state === 'disabled') return statusSet.forceDisabledStatus;
  return statusSet.defaultStatus;
}

export function ProviderOverrideControls({
  initialOverrides,
  storageConfigured,
  providerStatuses = DEFAULT_PROVIDER_STATUSES,
  providerCards = DEFAULT_PROVIDER_CARDS,
}: ProviderOverrideControlsProps) {
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
    <section className="mt-6 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-white">Provider status</h2>
          <p className="mt-1 text-sm text-slate-300">
            Current status, quick controls, and recent request metrics for each provider.
          </p>
        </div>
        {!storageConfigured && (
          <span className="rounded-full border border-amber-400/40 bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-200">
            Requires MongoDB
          </span>
        )}
      </div>

      <p className="text-xs text-slate-400">
        Use the toggle in each card to keep the default behavior, force a provider on, or force it off. Changes take effect within 30 seconds on all server instances.
      </p>

      {error ? (
        <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-4">
        {providerCards.map((card) => {
          const state = overrides[card.provider];
          const statusSet = providerStatuses[card.provider] ?? DEFAULT_PROVIDER_STATUSES[card.provider];
          const status = getDisplayedStatus(statusSet, state);
          const isBusy = pending === card.provider;
          const metrics = {
            totalRequests: card.metrics?.totalRequests ?? 0,
            averageDurationMs: card.metrics?.averageDurationMs ?? null,
            successCount: card.metrics?.successCount ?? 0,
            errorCount: card.metrics?.errorCount ?? 0,
            callers: card.metrics?.callers ?? [],
          };

          return (
            <article key={card.provider} className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-[0_18px_50px_rgba(2,6,23,0.25)]">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-lg font-semibold text-white">{card.name}</h3>
                    {card.debugHref ? (
                      <a
                        href={card.debugHref}
                        className="inline-flex items-center rounded-full border border-sky-400/40 bg-sky-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-sky-100 transition hover:bg-sky-500/20"
                      >
                        DEBUG
                      </a>
                    ) : null}
                    {card.resourceLinks?.map((link) => (
                      <a
                        key={`${card.provider}-${link.href}`}
                        href={link.href}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-medium text-sky-200 transition hover:text-sky-100 hover:underline"
                      >
                        <span>{link.label}</span>
                        <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
                      </a>
                    ))}
                  </div>
                  <p className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-400">Current runtime state</p>
                </div>
                <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ${getRuntimeStatusBadgeClass(status.tone)}`}>
                  {status.label}
                </span>
              </div>

              <div className="mt-3 inline-flex w-full rounded-2xl border border-white/10 bg-slate-950/40 p-1">
                {[
                  { label: 'Default', value: null },
                  { label: 'Enable', value: 'enabled' as const },
                  { label: 'Disable', value: 'disabled' as const },
                ].map((option) => {
                  const isSelected = state === option.value;

                  return (
                    <button
                      key={`${card.provider}-${option.label}`}
                      type="button"
                      aria-pressed={isSelected}
                      disabled={isBusy || !storageConfigured}
                      onClick={() => {
                        if (state === option.value) {
                          return;
                        }

                        void applyOverride(card.provider, option.value);
                      }}
                      className={`${getOverrideOptionClass(option.value, isSelected)} disabled:cursor-not-allowed disabled:opacity-40`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
              {isBusy ? <p className="mt-2 text-[11px] text-slate-400">Applying…</p> : null}

              <div className="mt-3 rounded-2xl border border-white/10 bg-slate-950/40 p-3">
                <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400">Current status</p>
                <p className="mt-1 text-xs text-slate-300">{status.detail}</p>
              </div>

              {card.connectionDetail ? (
                <div className="mt-3 rounded-2xl border border-white/10 bg-slate-950/40 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400">OpenSky connection</p>
                    <div className="flex flex-wrap items-center gap-2">
                      {card.connectionLinks?.map((link) => (
                        <a
                          key={`${card.provider}-connection-${link.href}`}
                          href={link.href}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-sky-200 transition hover:text-sky-100 hover:underline"
                        >
                          <span>{link.label}</span>
                          <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
                        </a>
                      ))}
                      {card.connectionStatusLabel ? (
                        <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${getRuntimeStatusBadgeClass(card.connectionTone)}`}>
                          {card.connectionStatusLabel}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <p className="mt-1 text-xs text-slate-300">{card.connectionDetail}</p>
                </div>
              ) : null}

              {card.extra ? <p className="mt-2 text-xs text-slate-400">{card.extra}</p> : null}

              <div className="mt-4 grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
                <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2.5">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-slate-400">Requests</p>
                  <p className="mt-0.5 text-base font-semibold text-white">{metrics.totalRequests}</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2.5">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-slate-400">Avg duration</p>
                  <p className="mt-0.5 text-base font-semibold text-white">{formatDuration(metrics.averageDurationMs)}</p>
                </div>
                <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/5 px-3 py-2.5 text-emerald-100">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-emerald-200">Success</p>
                  <p className="mt-0.5 text-base font-semibold text-white">{metrics.successCount}</p>
                </div>
                <div className="rounded-xl border border-rose-400/20 bg-rose-500/5 px-3 py-2.5 text-rose-100">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-rose-200">Errors</p>
                  <p className="mt-0.5 text-base font-semibold text-white">{metrics.errorCount}</p>
                </div>
              </div>

              <div className="mt-4">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Callers</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(metrics.callers.length ? metrics.callers : [{ label: 'System', count: 0 }]).map((entry) => (
                    <span key={`${card.provider}-${entry.label}`} className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-slate-200">
                      {entry.label} · {entry.count}
                    </span>
                  ))}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
