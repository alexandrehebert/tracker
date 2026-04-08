import { notFound } from 'next/navigation';
import { FriendsConfigClient } from '~/components/tracker/friends/FriendsConfigClient';
import { Link } from '~/i18n/navigation';
import { isValidLocale } from '~/i18n/routing';
import { readFriendsTrackerConfigWithAirportTimezones } from '~/lib/server/friendsTracker';
import { getTrackerCronDashboard } from '~/lib/server/trackerCron';
import { getEnabledProviders } from '~/lib/server/providers';

export const dynamic = 'force-dynamic';

interface ChantalConfigPageProps {
  params: Promise<{ locale: string }>;
}

export default async function ChantalConfigPage({ params }: ChantalConfigPageProps) {
  const { locale } = await params;

  if (!isValidLocale(locale)) {
    notFound();
  }

  const demoReferenceTime = Date.now();
  const enabledValidationProviders = getEnabledProviders();
  const isFlightAwareValidationEnabled = enabledValidationProviders.length > 0;
  const flightAwareValidationNotice = isFlightAwareValidationEnabled
    ? null
    : 'All flight validation providers are currently disabled by the provider flags.';

  const [initialConfig, initialCronDashboard] = await Promise.all([
    readFriendsTrackerConfigWithAirportTimezones(),
    getTrackerCronDashboard(5),
  ]);

  return (
    <div className="min-h-[100dvh] bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-wrap gap-3">
          <Link
            href="/chantal"
            className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-slate-200 transition hover:border-sky-300/50 hover:bg-sky-500/10"
          >
            ← Back to Chantal map
          </Link>
          <Link
            href="/tracker/cron"
            aria-haspopup="dialog"
            scroll={false}
            className="inline-flex items-center rounded-full border border-violet-400/40 bg-violet-500/10 px-3 py-1.5 text-sm text-violet-100 transition hover:bg-violet-500/20"
          >
            Cron
          </Link>
          <Link
            href="/tracker/providers"
            aria-haspopup="dialog"
            scroll={false}
            className="inline-flex items-center rounded-full border border-emerald-400/40 bg-emerald-500/10 px-3 py-1.5 text-sm text-emerald-100 transition hover:bg-emerald-500/20"
          >
            Providers
          </Link>
        </div>

        <div className="mt-5">
          <p className="text-xs uppercase tracking-[0.24em] text-sky-300">Friends config</p>
          <h1 className="mt-2 text-3xl font-semibold text-white">Crew itinerary setup</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-300">
            Add each friend, their flight numbers, and any connections. Saving here also syncs the shared tracker cron list,
            while the cron toggle below now saves its enabled state immediately. Use the buttons above to open the cron or
            provider admin in a right-side drawer without leaving this setup view.
          </p>
        </div>

        <div className="mt-6">
          <FriendsConfigClient
            initialConfig={initialConfig}
            initialCronDashboard={initialCronDashboard}
            initialDemoReferenceTime={demoReferenceTime}
            initialFlightAwareValidationEnabled={isFlightAwareValidationEnabled}
            initialFlightAwareValidationNotice={flightAwareValidationNotice}
          />
        </div>
      </div>
    </div>
  );
}
