'use client';

import { Plus, Users } from 'lucide-react';
import { FriendsConfigProvider, useFriendsConfig } from './FriendsConfigContext';
import { CronSection } from './CronSection';
import { TripsSection } from './TripsSection';
import { SaveBar } from './SaveBar';
import { FriendCard } from './FriendCard';
import { TripRemovalModal } from './TripRemovalModal';
import { createDraftFriend } from '~/lib/utils/friendsConfigUtils';
import type { FriendsTrackerConfig } from '~/lib/friendsTracker';
import type { TrackerCronDashboard } from '~/lib/server/trackerCron';

function FriendsConfigInner() {
  const { friends, selectedTrip, updateSelectedTripFriends } = useFriendsConfig();

  return (
    <div className="space-y-6">
      <CronSection />
      <TripsSection />
      <SaveBar />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-slate-300">
          <Users className="h-4 w-4 text-sky-300" />
          <span>{friends.length} friends configured for {selectedTrip?.name ?? 'this trip'}</span>
        </div>
        <button
          type="button"
          onClick={() => updateSelectedTripFriends((currentFriends) => [...currentFriends, createDraftFriend()])}
          className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-slate-950/80 px-4 py-2 text-sm font-medium text-slate-100 transition hover:border-white/20 hover:bg-slate-900"
        >
          <Plus className="h-4 w-4" />
          Add friend
        </button>
      </div>

      {friends.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-white/10 bg-slate-950/35 p-8 text-center text-sm text-slate-400">
          No friends yet for {selectedTrip?.name ?? 'this trip'}. Create the first itinerary card to start populating the `/chantal` map.
        </div>
      ) : null}

      <div className="space-y-4">
        {friends.map((friend, friendIndex) => (
          <FriendCard key={friend.id} friend={friend} friendIndex={friendIndex} />
        ))}
      </div>

      <TripRemovalModal />
    </div>
  );
}

export function FriendsConfigClient({
  initialConfig,
  initialCronDashboard,
  initialDemoReferenceTime,
  initialAirportTimezones = initialConfig.airportTimezones ?? {},
  initialFlightAwareValidationEnabled = true,
  initialFlightAwareValidationNotice = null,
}: {
  initialConfig: FriendsTrackerConfig;
  initialCronDashboard: TrackerCronDashboard;
  initialDemoReferenceTime?: number;
  initialAirportTimezones?: Record<string, string>;
  initialFlightAwareValidationEnabled?: boolean;
  initialFlightAwareValidationNotice?: string | null;
}) {
  return (
    <FriendsConfigProvider
      initialConfig={initialConfig}
      initialCronDashboard={initialCronDashboard}
      initialDemoReferenceTime={initialDemoReferenceTime}
      initialAirportTimezones={initialAirportTimezones}
      initialFlightAwareValidationEnabled={initialFlightAwareValidationEnabled}
      initialFlightAwareValidationNotice={initialFlightAwareValidationNotice}
    >
      <FriendsConfigInner />
    </FriendsConfigProvider>
  );
}
