import { notFound } from 'next/navigation';
import { OpenSkyDebugClient } from '~/components/tracker/debug/OpenSkyDebugClient';
import { Link } from '~/i18n/navigation';
import { isValidLocale } from '~/i18n/routing';

export const dynamic = 'force-dynamic';

interface TrackerDebugPageProps {
  params: Promise<{ locale: string }>;
}

export default async function TrackerDebugPage({ params }: TrackerDebugPageProps) {
  const { locale } = await params;

  if (!isValidLocale(locale)) {
    notFound();
  }

  return (
    <div className="min-h-[100dvh] bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
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
            href="/tracker/providers"
            className="inline-flex items-center rounded-full border border-emerald-400/40 bg-emerald-500/10 px-3 py-1.5 text-sm text-emerald-100 transition hover:bg-emerald-500/20"
          >
            Provider metrics
          </Link>
        </div>

        <div className="mt-5">
          <p className="text-xs uppercase tracking-[0.24em] text-sky-300">Tracker debug</p>
          <h1 className="mt-2 text-3xl font-semibold text-white">OpenSky network diagnostics</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-300">
            Use this page on Vercel to capture the runtime environment, routing headers, DNS results,
            and real auth/API checks against OpenSky. It is meant to be copied and shared back for troubleshooting.
          </p>
        </div>

        <div className="mt-6">
          <OpenSkyDebugClient />
        </div>
      </div>
    </div>
  );
}
