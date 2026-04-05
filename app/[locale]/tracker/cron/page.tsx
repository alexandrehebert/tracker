import { notFound } from 'next/navigation';
import { TrackerCronAdminClient } from '~/components/tracker/cron/TrackerCronAdminClient';
import { Link } from '~/i18n/navigation';
import { isValidLocale } from '~/i18n/routing';
import { getTrackerCronDashboard } from '~/lib/server/trackerCron';

export const dynamic = 'force-dynamic';

interface TrackerCronPageProps {
  params: Promise<{ locale: string }>;
}

export default async function TrackerCronPage({ params }: TrackerCronPageProps) {
  const { locale } = await params;

  if (!isValidLocale(locale)) {
    notFound();
  }

  const dashboard = await getTrackerCronDashboard(100);

  return (
    <div className="min-h-[100dvh] bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <Link
          href="/tracker"
          className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-slate-200 transition hover:border-sky-300/50 hover:bg-sky-500/10"
        >
          ← Back to tracker
        </Link>

        <div className="mt-5">
          <p className="text-xs uppercase tracking-[0.24em] text-sky-300">Tracker admin</p>
          <h1 className="mt-2 text-3xl font-semibold text-white">Cron flight prefetch</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-300">
            Manage the list of flights that Vercel refreshes every 15 minutes, keep the config in MongoDB,
            and review the full execution history for each cron run.
          </p>
        </div>

        <div className="mt-6">
          <TrackerCronAdminClient initialDashboard={dashboard} />
        </div>
      </div>
    </div>
  );
}
