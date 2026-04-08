import { TrackerCronAdminClient } from './TrackerCronAdminClient';
import { getCurrentTripConfig } from '~/lib/friendsTracker';
import { readFriendsTrackerConfig } from '~/lib/server/friendsTracker';
import { getTrackerCronDashboard } from '~/lib/server/trackerCron';

interface TrackerCronPageContentProps {
  showIntro?: boolean;
}

export async function TrackerCronPageContent({ showIntro = true }: TrackerCronPageContentProps) {
  const [dashboard, chantalConfig] = await Promise.all([
    getTrackerCronDashboard(100),
    readFriendsTrackerConfig(),
  ]);
  const currentTrip = getCurrentTripConfig(chantalConfig);
  const initialDashboard = {
    ...dashboard,
    chantalCronEnabled: chantalConfig.cronEnabled !== false,
    chantalCurrentTripName: currentTrip?.name ?? null,
  };

  return (
    <>
      {showIntro ? (
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-sky-300">Tracker admin</p>
          <h1 className="mt-2 text-3xl font-semibold text-white">Cron flight prefetch</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-300">
            Manage the manual tracker list and the `/chantal` batch separately, keep the config in MongoDB,
            and review the full execution history for each cron run.
          </p>
        </div>
      ) : null}

      <div className={showIntro ? 'mt-6' : ''}>
        <TrackerCronAdminClient initialDashboard={initialDashboard} />
      </div>
    </>
  );
}
