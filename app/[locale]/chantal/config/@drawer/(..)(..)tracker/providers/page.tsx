import { ConfigDrawerShell } from '~/components/tracker/friends/ConfigDrawerShell';
import { TrackerProvidersPageContent } from '~/components/tracker/providers/TrackerProvidersPageContent';

export const dynamic = 'force-dynamic';

export default function ChantalConfigProvidersDrawerPage() {
  return (
    <ConfigDrawerShell
      badge="Chantal quick admin"
      title="Provider observability"
      description="Inspect provider health and recent request logs without navigating away from the Chantal config page."
      fullPageHref="/tracker/providers"
    >
      <TrackerProvidersPageContent showIntro={false} />
    </ConfigDrawerShell>
  );
}
