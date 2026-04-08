import { notFound } from 'next/navigation';
import { Link } from '~/i18n/navigation';
import { isValidLocale } from '~/i18n/routing';
import { getProviderDisabledReason } from '~/lib/server/providers';
import {
  formatProviderCallerLabel,
  getProvidersDashboard,
  type ProviderRequestLogEntry,
} from '~/lib/server/providers/observability';
import { isAeroDataBoxConfigured } from '~/lib/server/providers/aerodatabox';
import { isAviationstackConfigured } from '~/lib/server/providers/aviationstack';
import { isFlightAwareConfigured } from '~/lib/server/providers/flightaware';
import { getOpenSkyTokenStatus, isOpenSkyConfigured } from '~/lib/server/providers/opensky';

export const dynamic = 'force-dynamic';

interface TrackerProvidersPageProps {
  params: Promise<{ locale: string }>;
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

export default async function TrackerProvidersPage({ params }: TrackerProvidersPageProps) {
  const { locale } = await params;

  if (!isValidLocale(locale)) {
    notFound();
  }

  const [dashboard, openSkyTokenStatus] = await Promise.all([
    getProvidersDashboard(250),
    getOpenSkyTokenStatus(),
  ]);

  const providerStates = [
    {
      name: 'OpenSky',
      configured: isOpenSkyConfigured(),
      note: getProviderDisabledReason('opensky')
        ?? (isOpenSkyConfigured()
          ? (openSkyTokenStatus.hasToken
            ? `Token ${openSkyTokenStatus.cacheSource} cache is ready.`
            : 'Configured, but no cached token is currently stored.')
          : 'Missing OpenSky credentials or proxy configuration.'),
      extra: openSkyTokenStatus.hasToken && openSkyTokenStatus.expiresAt
        ? `Token expires: ${formatDateTime(new Date(openSkyTokenStatus.expiresAt).toISOString())}`
        : null,
    },
    {
      name: 'FlightAware',
      configured: isFlightAwareConfigured(),
      note: getProviderDisabledReason('flightaware')
        ?? (isFlightAwareConfigured()
          ? 'FlightAware AeroAPI is enabled.'
          : 'Missing `FLIGHT_AWARE_API_KEY` / `FLIGHTAWARE_API_KEY`.'),
      extra: null,
    },
    {
      name: 'Aviationstack',
      configured: isAviationstackConfigured(),
      note: getProviderDisabledReason('aviationstack')
        ?? (isAviationstackConfigured()
          ? 'Aviationstack is enabled.'
          : 'Missing `AVIATION_STACK_API_KEY` / `AVIATIONSTACK_ACCESS_KEY`.'),
      extra: null,
    },
    {
      name: 'AeroDataBox',
      configured: isAeroDataBoxConfigured(),
      note: getProviderDisabledReason('aerodatabox')
        ?? (isAeroDataBoxConfigured()
          ? 'AeroDataBox is enabled for on-demand validation lookups.'
          : 'Missing `AERODATABOX_RAPIDAPI_KEY` / RapidAPI credentials.'),
      extra: null,
    },
  ];

  return (
    <div className="min-h-[100dvh] bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-wrap gap-3">
          <Link
            href="/tracker"
            className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-slate-200 transition hover:border-sky-300/50 hover:bg-sky-500/10"
          >
            ← Back to tracker
          </Link>
          <Link
            href="/tracker/cron"
            className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-slate-200 transition hover:border-sky-300/50 hover:bg-sky-500/10"
          >
            Open cron admin
          </Link>
          <Link
            href="/tracker/debug"
            className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-slate-200 transition hover:border-sky-300/50 hover:bg-sky-500/10"
          >
            OpenSky debug page
          </Link>
        </div>

        <div className="mt-5">
          <p className="text-xs uppercase tracking-[0.24em] text-sky-300">Provider observability</p>
          <h1 className="mt-2 text-3xl font-semibold text-white">Aviation provider metrics & logs</h1>
          <p className="mt-2 max-w-4xl text-sm text-slate-300">
            Review request counts, caller attribution, and redacted request/response logs for the external aviation providers.
            Logs are stored in MongoDB whenever `MONGODB_URI` is configured.
          </p>
        </div>

        <div className={`mt-6 rounded-3xl border p-5 text-sm ${dashboard.mongoConfigured
          ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-50'
          : 'border-amber-400/30 bg-amber-500/10 text-amber-50'}`}>
          <p className="font-semibold text-white">MongoDB provider logging</p>
          <p className="mt-2">
            {dashboard.mongoConfigured
              ? `Logging is active. This page is currently summarizing the latest ${dashboard.logWindowSize} provider events.`
              : 'MongoDB is not configured yet, so request logs cannot be persisted. Set `MONGODB_URI` to start collecting them.'}
          </p>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
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

        <section className="mt-6 space-y-4">
          <div>
            <h2 className="text-xl font-semibold text-white">Provider status</h2>
            <p className="mt-1 text-sm text-slate-300">Configuration health and recent request metrics for each provider.</p>
          </div>

          <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-4">
            {providerStates.map((providerState) => {
              const metrics = dashboard.providers.find((provider) => provider.label === providerState.name) ?? null;

              return (
                <article key={providerState.name} className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-[0_18px_50px_rgba(2,6,23,0.25)]">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-semibold text-white">{providerState.name}</h3>
                      <p className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-400">
                        {providerState.configured ? 'Configured' : 'Needs attention'}
                      </p>
                    </div>
                    <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ${providerState.configured
                      ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-100'
                      : 'border-amber-400/40 bg-amber-500/10 text-amber-100'}`}>
                      {providerState.configured ? 'ready' : 'check'}
                    </span>
                  </div>

                  <p className="mt-3 text-sm text-slate-300">{providerState.note}</p>
                  {providerState.extra ? <p className="mt-2 text-xs text-slate-400">{providerState.extra}</p> : null}

                  <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                      <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Requests</p>
                      <p className="mt-1 text-lg font-semibold text-white">{metrics?.totalRequests ?? 0}</p>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                      <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Avg duration</p>
                      <p className="mt-1 text-lg font-semibold text-white">{formatDuration(metrics?.averageDurationMs ?? null)}</p>
                    </div>
                    <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/5 p-3 text-emerald-100">
                      <p className="text-xs uppercase tracking-[0.18em] text-emerald-200">Success</p>
                      <p className="mt-1 text-lg font-semibold text-white">{metrics?.successCount ?? 0}</p>
                    </div>
                    <div className="rounded-2xl border border-rose-400/20 bg-rose-500/5 p-3 text-rose-100">
                      <p className="text-xs uppercase tracking-[0.18em] text-rose-200">Errors</p>
                      <p className="mt-1 text-lg font-semibold text-white">{metrics?.errorCount ?? 0}</p>
                    </div>
                  </div>

                  <div className="mt-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Callers</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(metrics?.callers.length ? metrics.callers : [{ caller: 'system', count: 0 }]).map((entry) => (
                        <span key={`${providerState.name}-${entry.caller}`} className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-slate-200">
                          {formatProviderCallerLabel(entry.caller)} · {entry.count}
                        </span>
                      ))}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section className="mt-6 rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-[0_18px_50px_rgba(2,6,23,0.25)]">
          <h2 className="text-xl font-semibold text-white">Caller breakdown</h2>
          <p className="mt-1 text-sm text-slate-300">Who is using the providers in the latest captured window.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {dashboard.overview.callers.length > 0 ? dashboard.overview.callers.map((caller) => (
              <span key={caller.caller} className="rounded-full border border-sky-400/30 bg-sky-500/10 px-3 py-1.5 text-sm text-sky-100">
                {formatProviderCallerLabel(caller.caller)} · {caller.count}
              </span>
            )) : <span className="text-sm text-slate-400">No provider calls have been logged yet.</span>}
          </div>
        </section>

        <section className="mt-6 space-y-4">
          <div>
            <h2 className="text-xl font-semibold text-white">Recent request logs</h2>
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
      </div>
    </div>
  );
}
