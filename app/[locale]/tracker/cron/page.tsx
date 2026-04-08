import { notFound } from 'next/navigation';
import { TrackerCronPageContent } from '~/components/tracker/cron/TrackerCronPageContent';
import { Link } from '~/i18n/navigation';
import { isValidLocale } from '~/i18n/routing';

export const dynamic = 'force-dynamic';

interface TrackerCronPageProps {
  params: Promise<{ locale: string }>;
}

export default async function TrackerCronPage({ params }: TrackerCronPageProps) {
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
            href="/tracker/providers"
            className="inline-flex items-center rounded-full border border-emerald-400/40 bg-emerald-500/10 px-3 py-1.5 text-sm text-emerald-100 transition hover:bg-emerald-500/20"
          >
            Provider metrics
          </Link>
        </div>

        <div className="mt-5">
          <TrackerCronPageContent />
        </div>
      </div>
    </div>
  );
}
