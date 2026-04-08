import { TrackerCronPageContent } from '~/components/tracker/cron/TrackerCronPageContent';
import { ConfigDrawerShell } from '~/components/tracker/friends/ConfigDrawerShell';

export const dynamic = 'force-dynamic';

export default function ChantalConfigCronDrawerPage() {
  return (
    <ConfigDrawerShell
      badge="Chantal quick admin"
      title="Cron flight prefetch"
      description="Review and update the shared cron dashboard without leaving the crew itinerary setup page."
      fullPageHref="/tracker/cron"
    >
      <TrackerCronPageContent showIntro={false} />
    </ConfigDrawerShell>
  );
}
