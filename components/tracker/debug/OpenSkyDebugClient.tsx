'use client';

import { useLocale } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import type { OpenSkyDebugReport } from '~/lib/server/openskyDebug';

function isErrorResponse(value: unknown): value is { error: string } {
  return typeof value === 'object' && value !== null && 'error' in value && typeof value.error === 'string';
}

function isOpenSkyDebugReport(value: unknown): value is OpenSkyDebugReport {
  return typeof value === 'object'
    && value !== null
    && 'reportVersion' in value
    && 'checks' in value
    && 'dns' in value;
}

async function readApiPayload<T>(response: Response): Promise<T | { error: string }> {
  const text = await response.text();
  if (!text) {
    return {} as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    return {
      error: text.trim() || `Request failed with status ${response.status}.`,
    };
  }
}

function getCheckTone(ok: boolean): string {
  return ok
    ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-100'
    : 'border-rose-400/40 bg-rose-500/10 text-rose-100';
}

export function OpenSkyDebugClient() {
  const locale = useLocale();
  const [report, setReport] = useState<OpenSkyDebugReport | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCopying, setIsCopying] = useState(false);
  const [notice, setNotice] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  const dateTimeFormatter = useMemo(() => new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'medium',
    timeZone: 'UTC',
  }), [locale]);

  async function runDiagnostics() {
    setIsLoading(true);
    setNotice(null);

    try {
      const response = await fetch('/api/tracker/debug/opensky', { cache: 'no-store' });
      const payload: unknown = await readApiPayload<OpenSkyDebugReport>(response);

      if (!response.ok || isErrorResponse(payload) || !isOpenSkyDebugReport(payload)) {
        throw new Error(isErrorResponse(payload) ? payload.error : 'Unable to run the OpenSky debug diagnostics.');
      }

      setReport(payload);
      setNotice({
        type: payload.warnings.length > 0 ? 'info' : 'success',
        text: payload.warnings.length > 0
          ? `Diagnostics finished with ${payload.warnings.length} warning(s).`
          : 'Diagnostics finished successfully.',
      });
    } catch (error) {
      setNotice({
        type: 'error',
        text: error instanceof Error ? error.message : 'Unable to run the OpenSky debug diagnostics.',
      });
    } finally {
      setIsLoading(false);
    }
  }

  async function copyReport() {
    if (!report) {
      setNotice({ type: 'error', text: 'Run the diagnostics first so there is a report to copy.' });
      return;
    }

    setIsCopying(true);
    setNotice(null);

    try {
      const serialized = JSON.stringify(report, null, 2);
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(serialized);
        setNotice({ type: 'success', text: 'Debug report copied to clipboard.' });
      } else {
        setNotice({ type: 'info', text: 'Clipboard access is unavailable here. Copy the JSON manually from the box below.' });
      }
    } catch (error) {
      setNotice({
        type: 'error',
        text: error instanceof Error ? error.message : 'Unable to copy the debug report.',
      });
    } finally {
      setIsCopying(false);
    }
  }

  useEffect(() => {
    void runDiagnostics();
  }, []);

  const authCheck = report?.checks.find((check) => check.name === 'auth-token') ?? null;
  const apiCheck = report?.checks.find((check) => check.name === 'api-authenticated') ?? null;

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-sky-400/30 bg-sky-500/10 p-5 text-sm text-sky-50">
        <p className="font-semibold text-white">This page runs live diagnostics from the same Vercel Node runtime as the OpenSky calls.</p>
        <p className="mt-2 text-sky-100">
          It captures routing headers, DNS resolution, auth/API request results, and timeout details. Secrets and full tokens are redacted so you can paste the JSON report back here.
        </p>
      </div>

      {notice ? (
        <div className={`rounded-2xl border px-4 py-3 text-sm ${notice.type === 'success'
          ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-100'
          : notice.type === 'error'
            ? 'border-rose-400/40 bg-rose-500/10 text-rose-100'
            : 'border-sky-400/40 bg-sky-500/10 text-sky-100'}`}>
          {notice.text}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => void runDiagnostics()}
          disabled={isLoading}
          className="inline-flex items-center justify-center rounded-full bg-sky-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-sky-400 disabled:cursor-wait disabled:opacity-70"
        >
          {isLoading ? 'Running diagnostics…' : 'Run diagnostics again'}
        </button>
        <button
          type="button"
          onClick={() => void copyReport()}
          disabled={isLoading || isCopying || !report}
          className="inline-flex items-center justify-center rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-100 transition hover:border-sky-300/60 hover:bg-sky-500/10 disabled:cursor-wait disabled:opacity-70"
        >
          {isCopying ? 'Copying…' : 'Copy JSON report'}
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Generated (UTC)</p>
          <p className="mt-2 text-sm font-semibold text-white">{report ? dateTimeFormatter.format(report.generatedAtMs) : '—'}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Vercel region</p>
          <p className="mt-2 text-sm font-semibold text-white">{report?.runtime.vercelRegion ?? '—'}</p>
          <p className="mt-1 text-xs text-slate-300">Env: {report?.runtime.vercelEnv ?? '—'}</p>
        </div>
        <div className={`rounded-2xl border p-4 ${authCheck ? getCheckTone(authCheck.ok) : 'border-white/10 bg-white/5 text-slate-100'}`}>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-300">Auth request</p>
          <p className="mt-2 text-sm font-semibold">{authCheck ? (authCheck.ok ? 'Reachable' : 'Failing') : '—'}</p>
          <p className="mt-1 text-xs opacity-80">{authCheck ? `${authCheck.durationMs} ms` : '—'}</p>
        </div>
        <div className={`rounded-2xl border p-4 ${apiCheck ? getCheckTone(apiCheck.ok) : 'border-white/10 bg-white/5 text-slate-100'}`}>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-300">Authenticated API</p>
          <p className="mt-2 text-sm font-semibold">{apiCheck ? (apiCheck.ok ? 'Reachable' : 'Failing') : '—'}</p>
          <p className="mt-1 text-xs opacity-80">{apiCheck ? `${apiCheck.durationMs} ms` : '—'}</p>
        </div>
      </div>

      {report?.warnings.length ? (
        <section className="rounded-3xl border border-amber-400/40 bg-amber-500/10 p-5">
          <h2 className="text-lg font-semibold text-amber-50">Warnings</h2>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-amber-100">
            {report.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {report ? (
        <section className="space-y-4 rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-[0_18px_50px_rgba(2,6,23,0.25)]">
          <div>
            <h2 className="text-lg font-semibold text-white">OpenSky checks</h2>
            <p className="mt-1 text-sm text-slate-300">Each item below is a real request made from the current runtime.</p>
          </div>

          <div className="space-y-3">
            {report.checks.map((check) => (
              <div key={check.name} className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-white">{check.name}</p>
                    <p className="mt-1 text-xs text-slate-400">{check.description}</p>
                  </div>
                  <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ${getCheckTone(check.ok)}`}>
                    {check.ok ? 'ok' : 'issue'}
                  </span>
                </div>
                <p className="mt-3 text-xs text-slate-300">{check.request.method} {check.request.url || '—'} · {check.durationMs} ms</p>
                {check.response ? (
                  <p className="mt-1 text-xs text-slate-400">HTTP {check.response.status ?? '—'} {check.response.statusText ?? ''}</p>
                ) : null}
                {check.error ? (
                  <p className="mt-2 rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">{check.error}</p>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-[0_18px_50px_rgba(2,6,23,0.25)]">
        <h2 className="text-lg font-semibold text-white">Raw JSON report</h2>
        <p className="mt-1 text-sm text-slate-300">Copy this block and send it back here once the page has finished running.</p>
        <pre className="mt-4 max-h-[70dvh] overflow-auto rounded-2xl border border-white/10 bg-slate-950 p-4 text-xs text-slate-100">{report ? JSON.stringify(report, null, 2) : 'Waiting for diagnostics…'}</pre>
      </section>
    </div>
  );
}
