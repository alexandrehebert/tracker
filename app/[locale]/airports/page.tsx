import type { Metadata } from 'next';
import { Plane, Radar } from 'lucide-react';
import LanguageSwitcher from '~/components/LanguageSwitcher';
import { AirportsExplorer } from '~/components/airports/AirportsExplorer';
import { Link } from '~/i18n/navigation';
import { getWorldMapPayload } from '~/lib/server/worldMap';

export const dynamic = 'force-dynamic';

interface AirportsPageProps {
  params: Promise<{ locale: string }>;
}

function getCopy(locale: string) {
  if (locale === 'fr') {
    return {
      eyebrow: 'Annuaire mondial',
      title: 'Tous les aeroports sur une seule page.',
      description: 'Parcourez l’annuaire complet des aeroports et visualisez leurs emplacements directement sur la carte du monde.',
      backHome: 'Accueil',
      openTracker: 'Ouvrir le tracker',
    };
  }

  return {
    eyebrow: 'World directory',
    title: 'All airports on a single page.',
    description: 'Browse the complete airport directory and see each airport plotted directly on the world map.',
    backHome: 'Home',
    openTracker: 'Open tracker',
  };
}

export async function generateMetadata({ params }: AirportsPageProps): Promise<Metadata> {
  const { locale } = await params;
  const copy = getCopy(locale);

  return {
    title: `Flight Tracker | ${copy.title}`,
    description: copy.description,
    alternates: {
      canonical: `/${locale}/airports`,
    },
  };
}

export default async function AirportsPage({ params }: AirportsPageProps) {
  const { locale } = await params;
  const copy = getCopy(locale);
  const map = await getWorldMapPayload(locale);

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/"
              locale={locale}
              className="rounded-full border border-white/10 bg-slate-900/70 px-3 py-2 text-sm text-slate-200 transition hover:border-cyan-300/40 hover:text-cyan-100"
            >
              {copy.backHome}
            </Link>
            <Link
              href="/tracker"
              locale={locale}
              className="inline-flex items-center gap-2 rounded-full bg-cyan-500 px-3 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400"
            >
              <Radar className="h-4 w-4" />
              {copy.openTracker}
            </Link>
          </div>

          <LanguageSwitcher currentLocale={locale} />
        </div>

        <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-[0_20px_80px_rgba(2,6,23,0.45)] sm:p-6">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[0.68rem] uppercase tracking-[0.2em] text-slate-300">
            <Plane className="h-3.5 w-3.5 text-amber-300" />
            {copy.eyebrow}
          </div>
          <h1 className="mt-4 text-3xl font-semibold text-white sm:text-4xl">{copy.title}</h1>
          <p className="mt-3 max-w-3xl text-base leading-7 text-slate-300">{copy.description}</p>
        </section>

        <AirportsExplorer map={map} locale={locale} />
      </div>
    </main>
  );
}
