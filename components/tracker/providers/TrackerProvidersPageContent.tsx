import { getProviderDisabledReason, type ProviderName } from '~/lib/server/providers';
import {
  formatProviderCallerLabel,
  getProvidersDashboard,
  type ProviderRequestLogEntry,
} from '~/lib/server/providers/observability';
import { hasAeroDataBoxCredentials } from '~/lib/server/providers/aerodatabox';
import { hasAviationstackCredentials } from '~/lib/server/providers/aviationstack';
import { hasFlightAwareCredentials } from '~/lib/server/providers/flightaware';
import {
  getOpenSkyConnectionConfig,
  getOpenSkyTokenStatus,
  hasOpenSkyConfiguration,
} from '~/lib/server/providers/opensky';
import {
  isProviderOverridesStorageConfigured,
  readProviderOverrides,
  type ProviderOverrideState,
} from '~/lib/server/providers/overrides';
import { ProviderOverrideControls } from './ProviderOverrideControls';

interface TrackerProvidersPageContentProps {
  showIntro?: boolean;
}

function formatDateTime(value: string | null): string {
  if (!value) {
    return '—';
  }

  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return value;
  }

  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'medium',
    timeZone: 'UTC',
  }).format(parsed);
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

function formatJson(value: unknown): string {
  if (value == null) {
    return '—';
  }

  return JSON.stringify(value, null, 2);
}

function getLogTone(status: ProviderRequestLogEntry['status']): string {
  switch (status) {
    case 'success':
      return 'border-emerald-400/40 bg-emerald-500/10 text-emerald-100';
    case 'error':
      return 'border-rose-400/40 bg-rose-500/10 text-rose-100';
    case 'cached':
      return 'border-violet-400/40 bg-violet-500/10 text-violet-100';
    case 'no-data':
      return 'border-amber-400/40 bg-amber-500/10 text-amber-100';
    case 'skipped':
    default:
      return 'border-slate-400/40 bg-slate-500/10 text-slate-100';
  }
}

function getRuntimeStatusSummary({
  providerLabel,
  configured,
  overrideState,
  disabledReason,
}: {
  providerLabel: string;
  configured: boolean;
  overrideState: ProviderOverrideState;
  disabledReason: string | null;
}): {
  label: string;
  detail: string;
  tone: 'active' | 'disabled' | 'warning';
} {
  if (overrideState === 'disabled') {
    return {
      label: 'Disabled',
      detail: `${providerLabel} is disabled by the admin override.`,
      tone: 'disabled',
    };
  }

  if (disabledReason) {
    return {
      label: 'Disabled',
      detail: disabledReason,
      tone: 'disabled',
    };
  }

  if (!configured) {
    return {
      label: 'Disabled',
      detail: `${providerLabel} is disabled until its credentials or connection settings are configured.`,
      tone: 'disabled',
    };
  }

  if (overrideState === 'enabled') {
    return {
      label: 'Enabled',
      detail: `${providerLabel} is enabled by the admin override.`,
      tone: 'active',
    };
  }

  return {
    label: 'Enabled',
    detail: `${providerLabel} is enabled with the default environment behavior.`,
    tone: 'active',
  };
}

export async function TrackerProvidersPageContent({ showIntro = true }: TrackerProvidersPageContentProps) {
  const [dashboard, openSkyTokenStatus, providerOverrides] = await Promise.all([
    getProvidersDashboard(250),
    getOpenSkyTokenStatus(),
    readProviderOverrides(),
  ]);

  const openSkyConnectionConfig = getOpenSkyConnectionConfig();
  const openSkyConfigured = hasOpenSkyConfiguration();
  const flightAwareConfigured = hasFlightAwareCredentials();
  const aviationstackConfigured = hasAviationstackCredentials();
  const aeroDataBoxConfigured = hasAeroDataBoxCredentials();

  const providerStates = [
    {
      provider: 'opensky' as ProviderName,
      name: 'OpenSky',
      configured: openSkyConfigured,
      overrideState: providerOverrides.opensky,
      baseNote: openSkyConfigured
        ? (openSkyTokenStatus.hasToken
          ? `Token ${openSkyTokenStatus.cacheSource} cache is ready.`
          : 'Configured, but no cached token is currently stored.')
        : 'Missing OpenSky credentials or proxy configuration.',
      connectionDetail: openSkyConnectionConfig.proxyEnabled
        ? `Proxy enabled${openSkyConnectionConfig.proxyBaseUrl ? ` via ${openSkyConnectionConfig.proxyBaseUrl}` : ''}.${openSkyConnectionConfig.proxySecretConfigured ? ' Shared-secret protection is configured.' : ''}`
        : 'Proxy disabled. This deployment connects directly to the OpenSky auth and API endpoints.',
      extra: openSkyTokenStatus.hasToken && openSkyTokenStatus.expiresAt
        ? `Token expires: ${formatDateTime(new Date(openSkyTokenStatus.expiresAt).toISOString())}`
        : null,
    },
    {
      provider: 'flightaware' as ProviderName,
      name: 'FlightAware',
      configured: flightAwareConfigured,
      overrideState: providerOverrides.flightaware,
      baseNote: flightAwareConfigured
        ? 'FlightAware AeroAPI is enabled.'
        : 'Missing `FLIGHT_AWARE_API_KEY` / `FLIGHTAWARE_API_KEY`.',
      extra: null,
      connectionDetail: null,
    },
    {
      provider: 'aviationstack' as ProviderName,
      name: 'Aviationstack',
      configured: aviationstackConfigured,
      overrideState: providerOverrides.aviationstack,
      baseNote: aviationstackConfigured
        ? 'Aviationstack is enabled.'
        : 'Missing `AVIATION_STACK_API_KEY` / `AVIATIONSTACK_ACCESS_KEY`.',
      extra: null,
      connectionDetail: null,
    },
    {
      provider: 'aerodatabox' as ProviderName,
      name: 'AeroDataBox',
      configured: aeroDataBoxConfigured,
      overrideState: providerOverrides.aerodatabox,
      baseNote: aeroDataBoxConfigured
        ? 'AeroDataBox is enabled for on-demand validation lookups.'
        : 'Missing `AERODATABOX_RAPIDAPI_KEY` / RapidAPI credentials.',
      extra: null,
      connectionDetail: null,
    },
  ].map((providerState) => {
    const defaultDisabledReason = getProviderDisabledReason(providerState.provider);
    const statusSet = {
      defaultStatus: getRuntimeStatusSummary({
        providerLabel: providerState.name,
        configured: providerState.configured,
        overrideState: null,
        disabledReason: defaultDisabledReason,
      }),
      forceEnabledStatus: getRuntimeStatusSummary({
        providerLabel: providerState.name,
        configured: providerState.configured,
        overrideState: 'enabled',
        disabledReason: null,
      }),
      forceDisabledStatus: getRuntimeStatusSummary({
        providerLabel: providerState.name,
        configured: providerState.configured,
        overrideState: 'disabled',
        disabledReason: null,
      }),
    };

    const currentStatus = providerState.overrideState === 'enabled'
      ? statusSet.forceEnabledStatus
      : providerState.overrideState === 'disabled'
        ? statusSet.forceDisabledStatus
        : statusSet.defaultStatus;

    return {
      ...providerState,
      statusSet,
      note: providerState.overrideState === 'disabled'
        ? statusSet.forceDisabledStatus.detail
        : providerState.overrideState === 'enabled'
          ? providerState.baseNote
          : defaultDisabledReason ?? providerState.baseNote,
      currentStatus,
    };
  });

  const providerStatusMap = Object.fromEntries(
    providerStates.map((providerState) => [providerState.provider, providerState.statusSet]),
  ) as Record<ProviderName, {
    defaultStatus: { label: string; detail: string; tone: 'active' | 'disabled' | 'warning' };
    forceEnabledStatus: { label: string; detail: string; tone: 'active' | 'disabled' | 'warning' };
    forceDisabledStatus: { label: string; detail: string; tone: 'active' | 'disabled' | 'warning' };
  }>;

  const providerCards = providerStates.map((providerState) => {
    const metrics = dashboard.providers.find((provider) => provider.label === providerState.name) ?? null;

    return {
      provider: providerState.provider,
      name: providerState.name,
      baseNote: providerState.baseNote,
      defaultNote: providerState.note,
      connectionDetail: providerState.connectionDetail,
      connectionStatusLabel: providerState.connectionDetail
        ? (openSkyConnectionConfig.proxyEnabled ? 'Proxy enabled' : 'Proxy off')
        : null,
      connectionTone: providerState.connectionDetail
        ? (openSkyConnectionConfig.proxyEnabled ? 'active' as const : 'warning' as const)
        : null,
      extra: providerState.extra,
      debugHref: providerState.provider === 'opensky' ? '/tracker/debug' : null,
      metrics: {
        totalRequests: metrics?.totalRequests ?? 0,
        averageDurationMs: metrics?.averageDurationMs ?? null,
        successCount: metrics?.successCount ?? 0,
        errorCount: metrics?.errorCount ?? 0,
        callers: (metrics?.callers.length ? metrics.callers : [{ caller: 'system', count: 0 }]).map((entry) => ({
          label: formatProviderCallerLabel(entry.caller),
          count: entry.count,
        })),
      },
    };
  });

  return (
    <>
      {showIntro ? (
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-sky-300">Provider observability</p>
          <h1 className="mt-2 text-3xl font-semibold text-white">Aviation provider metrics & logs</h1>
          <p className="mt-2 max-w-4xl text-sm text-slate-300">
            Review request counts, caller attribution, and redacted request/response logs for the external aviation providers.
            Logs are stored in MongoDB whenever `MONGODB_URI` is configured.
          </p>
        </div>
      ) : null}

      <div className={`${showIntro ? 'mt-6 ' : ''}rounded-3xl border p-5 text-sm ${dashboard.mongoConfigured
        ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-50'
        : 'border-amber-400/30 bg-amber-500/10 text-amber-50'}`}>
        <p className="font-semibold text-white">MongoDB provider logging</p>
        <p className="mt-2">
          {dashboard.mongoConfigured
            ? `Logging is active. This page is currently summarizing the latest ${dashboard.logWindowSize} provider events.`
            : 'MongoDB is not configured yet, so request logs cannot be persisted. Set `MONGODB_URI` to start collecting them.'}
        </p>
      </div>

      <ProviderOverrideControls
        initialOverrides={providerOverrides}
        storageConfigured={isProviderOverridesStorageConfigured()}
        providerStatuses={providerStatusMap}
        providerCards={providerCards}
      />

      <section className="mt-6 space-y-4">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-sky-300">Logs</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">Provider logs & activity</h2>
          <p className="mt-1 text-sm text-slate-300">Recent request volume, caller activity, and detailed provider logs.</p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Logged requests</p>
            <p className="mt-2 text-2xl font-semibold text-white">{dashboard.overview.totalRequests}</p>
            <p className="mt-1 text-xs text-slate-300">Recent provider request window</p>
          </div>
          <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 p-4 text-rose-100">
            <p className="text-xs uppercase tracking-[0.2em] text-rose-200">Errors</p>
            <p className="mt-2 text-2xl font-semibold text-white">{dashboard.overview.errorCount}</p>
            <p className="mt-1 text-xs text-rose-100/80">Failures and rate-limit responses</p>
          </div>
          <div className="rounded-2xl border border-sky-400/30 bg-sky-500/10 p-4 text-sky-100">
            <p className="text-xs uppercase tracking-[0.2em] text-sky-200">Active callers</p>
            <p className="mt-2 text-2xl font-semibold text-white">{dashboard.overview.callers.length}</p>
            <p className="mt-1 text-xs text-sky-100/80">Cron, on-demand, config, and more</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Latest request</p>
            <p className="mt-2 text-sm font-semibold text-white">{formatDateTime(dashboard.overview.latestRequestAt)}</p>
            <p className="mt-1 text-xs text-slate-300">UTC</p>
          </div>
        </div>

        <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-[0_18px_50px_rgba(2,6,23,0.25)]">
          <h3 className="text-xl font-semibold text-white">Caller breakdown</h3>
          <p className="mt-1 text-sm text-slate-300">Who is using the providers in the latest captured window.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {dashboard.overview.callers.length > 0 ? dashboard.overview.callers.map((caller) => (
              <span key={caller.caller} className="rounded-full border border-sky-400/30 bg-sky-500/10 px-3 py-1.5 text-sm text-sky-100">
                {formatProviderCallerLabel(caller.caller)} · {caller.count}
              </span>
            )) : <span className="text-sm text-slate-400">No provider calls have been logged yet.</span>}
          </div>
        </div>

        <div>
          <h3 className="text-xl font-semibold text-white">Recent request logs</h3>
          <p className="mt-1 text-sm text-slate-300">Each entry stores the provider, caller, request parameters, and the redacted response summary.</p>
        </div>

        {dashboard.recentLogs.length === 0 ? (
          <div className="rounded-3xl border border-white/10 bg-white/5 p-5 text-sm text-slate-300">
            No provider traffic has been logged yet. Use the tracker, cron admin, or configuration validation flow to populate this view.
          </div>
        ) : (
          <div className="space-y-3">
            {dashboard.recentLogs.map((log) => (
              <details key={log.id} className="rounded-3xl border border-white/10 bg-slate-900/70 p-4 shadow-[0_12px_35px_rgba(2,6,23,0.18)]">
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 text-sm text-slate-200">
                  <span className="font-semibold text-white">{formatDateTime(log.createdAt)}</span>
                  <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-xs uppercase tracking-[0.14em] text-slate-200">
                    {log.provider}
                  </span>
                  <span className="rounded-full border border-sky-400/30 bg-sky-500/10 px-2 py-0.5 text-xs text-sky-100">
                    {formatProviderCallerLabel(log.caller)}
                  </span>
                  <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold uppercase tracking-[0.14em] ${getLogTone(log.status)}`}>
                    {log.status}
                  </span>
                  <span className="text-slate-400">{log.operation}</span>
                  <span className="text-slate-500">· {formatDuration(log.durationMs)}</span>
                </summary>

                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Request</p>
                    <pre className="mt-2 max-h-80 overflow-auto rounded-2xl border border-white/10 bg-slate-950 p-3 text-xs text-slate-100">{formatJson(log.request)}</pre>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Response</p>
                    <pre className="mt-2 max-h-80 overflow-auto rounded-2xl border border-white/10 bg-slate-950 p-3 text-xs text-slate-100">{formatJson({
                      response: log.response,
                      metadata: log.metadata,
                      error: log.error,
                      source: log.source,
                    })}</pre>
                  </div>
                </div>
              </details>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
