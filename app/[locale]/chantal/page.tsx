import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import FriendsTrackerClient from '~/components/tracker/friends/FriendsTrackerClient';
import { isValidLocale } from '~/i18n/routing';
import { readFriendsTrackerConfig } from '~/lib/server/friendsTracker';
import { getWorldMapPayload } from '~/lib/server/worldMap';

export const dynamic = 'force-dynamic';

interface ChantalPageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: 'Chantal Friends Tracker',
    description: 'Track the whole crew on one shared map, including connections and completed flight legs.',
  };
}

export default async function ChantalPage({ params }: ChantalPageProps) {
  const { locale } = await params;

  if (!isValidLocale(locale)) {
    notFound();
  }

  const [map, initialConfig] = await Promise.all([
    getWorldMapPayload(locale),
    readFriendsTrackerConfig(),
  ]);

  return (
    <div className="h-[100dvh] w-full overflow-hidden bg-slate-950 text-slate-100">
      <FriendsTrackerClient map={map} initialConfig={initialConfig} />
    </div>
  );
}
