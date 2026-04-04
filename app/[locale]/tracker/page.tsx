import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import FlightTrackerClient from '~/components/tracker/flight/FlightTrackerClient';
import { isValidLocale } from '~/i18n/routing';
import { getWorldMapPayload } from '~/lib/server/worldMap';

export const dynamic = 'force-dynamic';

interface TrackerPageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: 'Flight Tracker',
    description: 'Track live flights on a responsive interactive world map with live OpenSky data.',
  };
}

export default async function TrackerPage({ params }: TrackerPageProps) {
  const { locale } = await params;

  if (!isValidLocale(locale)) {
    notFound();
  }

  const map = await getWorldMapPayload(locale);

  return (
    <div className="h-[100dvh] w-full overflow-hidden bg-slate-950 text-slate-100">
      <FlightTrackerClient map={map} />
    </div>
  );
}
