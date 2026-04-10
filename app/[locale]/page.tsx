import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Globe2, Plane, Radar, Route, Sparkles, Users } from 'lucide-react';
import LanguageSwitcher from '~/components/LanguageSwitcher';
import { HeroSection } from '~/components/landing/HeroSection';
import { StatsSection } from '~/components/landing/StatsSection';
import { MapSection } from '~/components/landing/MapSection';
import { Link } from '~/i18n/navigation';
import { isValidLocale } from '~/i18n/routing';
import { getWorldMapPayload } from '~/lib/server/worldMap';
import { buildSmoothRoutePath } from '~/lib/utils/routePath';

interface HomePageProps {
  params: Promise<{ locale: string }>;
}

function getCopy(locale: string) {
  if (locale === 'fr') {
    return {
      eyebrow: 'Suivi aerien',
      heroTitle: 'Suivez des vols en direct sur une carte mondiale interactive.',
      heroDescription: 'Entrez un callsign ou un ICAO24 pour afficher la route, la position actuelle, l’historique recent et les principales informations de vol dans une interface reutilisant toute la qualite visuelle du stack existant.',
      primaryCta: 'Ouvrir le tracker',
      secondaryCta: 'Explorer les aeroports',
      chantalCta: 'Carte Chantal',
      metrics: [
        { label: 'Carte', value: '2D', helper: 'zoomable et pinchable' },
        { label: 'Refresh', value: '60s', helper: 'mise a jour auto' },
        { label: 'Source', value: 'OpenSky', helper: 'donnees live' },
        { label: 'Mode', value: 'Multi-vols', helper: 'plusieurs identifiants' },
      ],
      mapEyebrow: 'Apercu live',
      mapHeading: 'Visualisez l’origine, la trajectoire et la position courante.',
      mapDescription: 'Le tableau de bord affiche les avions suivis sur la meme carte du monde interactive, avec un panneau laterale pour les details utiles.',
      mapSidebarTitle: 'Exemple de suivi',
      mapSidebarStatus: 'AFR / UAE / JPN / USA',
      statsEyebrow: 'Fonctionnalites',
      statsHeading: 'Un socle proprement recycle pour le tracking.',
      statsDescription: 'Le projet conserve le shell, la navigation multilingue et le comportement de zoom tout en retirant les traces actives du jeu d’origine.',
      featureCards: [
        { title: 'Recherche flexible', body: 'Callsign, numero de vol ou ICAO24 dans un seul champ.' },
        { title: 'Carte reactive', body: 'Pan, zoom, reset et focus automatique sur la trajectoire suivie.' },
        { title: 'Historique recent', body: 'Affichage du chemin et des derniers points disponibles.' },
        { title: 'Infos utiles', body: 'Vitesse, altitude, cap, pays d’origine et timestamps.' },
      ],
      footer: 'Flight Tracker · donnees live cartographiees proprement.',
    };
  }

  return {
    eyebrow: 'Flight tracker',
    heroTitle: 'Track live flights on an interactive world map.',
    heroDescription: 'Enter a callsign or ICAO24 to display the route, current position, recent history, and flight details in a polished interface built on the same strong visual stack.',
    primaryCta: 'Open tracker',
    secondaryCta: 'Browse airports',
    chantalCta: "Chantal's map",
    metrics: [
      { label: 'Map', value: '2D', helper: 'zoomable and pinchable' },
      { label: 'Refresh', value: '60s', helper: 'automatic polling' },
      { label: 'Source', value: 'OpenSky', helper: 'live aircraft data' },
      { label: 'Mode', value: 'Multi-flight', helper: 'track several IDs' },
    ],
    mapEyebrow: 'Live preview',
    mapHeading: 'See the origin, route history, and current position together.',
    mapDescription: 'The dashboard plots tracked aircraft on the same interactive world map while the side panel surfaces the most relevant live flight details.',
    mapSidebarTitle: 'Tracking preview',
    mapSidebarStatus: 'AFR / UAE / JPN / USA',
    statsEyebrow: 'Capabilities',
    statsHeading: 'A clean tracker built from the shared stack.',
    statsDescription: 'The project keeps the responsive shell, locale switching, and zoom interactions while removing active traces of the original geography game.',
    featureCards: [
      { title: 'Flexible lookup', body: 'Search by callsign, flight number, or ICAO24 in a single field.' },
      { title: 'Reactive map', body: 'Pan, zoom, reset, and auto-focus on the selected flight path.' },
      { title: 'Recent history', body: 'Draw the route and recent recorded track points from OpenSky.' },
      { title: 'Useful details', body: 'Speed, altitude, heading, origin country, and timestamps.' },
    ],
    footer: 'Flight Tracker · live flight data on a reusable map stack.',
  };
}

function buildPreviewRoute(points: Array<{ x: number; y: number }>): string {
  return buildSmoothRoutePath(points);
}

function MetricCard({ label, value, helper }: { label: string; value: string; helper: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center rounded-2xl border border-white/10 bg-white/5 p-4 text-center shadow-[0_18px_60px_rgba(2,6,23,0.35)] backdrop-blur-sm lg:aspect-square lg:rounded-xl lg:p-3">
      <p className="text-[0.65rem] uppercase tracking-[0.24em] text-slate-400">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-white lg:mt-1.5 lg:text-xl">{value}</p>
      <p className="mt-1 text-sm text-slate-400 lg:text-xs">{helper}</p>
    </div>
  );
}

function SectionEyebrow({ icon: Icon, children }: { icon?: typeof Sparkles; children: string }) {
  return (
    <div className="inline-flex self-start items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[0.68rem] font-medium uppercase tracking-[0.2em] text-slate-300 backdrop-blur-sm">
      {Icon ? <Icon className="h-3.5 w-3.5 text-amber-300" /> : null}
      {children}
    </div>
  );
}

function FeatureCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-slate-800/90 bg-slate-900/55 p-3">
      <p className="text-sm font-semibold text-slate-100">{title}</p>
      <p className="mt-1 text-sm leading-6 text-slate-400">{body}</p>
    </div>
  );
}

export async function generateMetadata({ params }: HomePageProps): Promise<Metadata> {
  const { locale } = await params;

  if (!isValidLocale(locale)) {
    notFound();
  }

  const copy = getCopy(locale);

  return {
    title: `Flight Tracker | ${copy.eyebrow}`,
    description: copy.heroDescription,
    alternates: {
      canonical: `/${locale}`,
    },
    openGraph: {
      type: 'website',
      siteName: 'Flight Tracker',
      locale: locale === 'fr' ? 'fr_FR' : 'en_US',
      title: `Flight Tracker | ${copy.eyebrow}`,
      description: copy.heroDescription,
      url: `/${locale}`,
    },
    twitter: {
      card: 'summary',
      title: `Flight Tracker | ${copy.eyebrow}`,
      description: copy.heroDescription,
    },
  };
}

export default async function HomePage({ params }: HomePageProps) {
  const { locale } = await params;

  if (!isValidLocale(locale)) {
    notFound();
  }

  const copy = getCopy(locale);
  const map = await getWorldMapPayload(locale);
  const currentYear = new Date().getFullYear();

  const routeStops = ['FR', 'AE', 'JP', 'US']
    .map((code) => map.countries.find((country) => country.code.toUpperCase() === code)?.centroid)
    .filter((point): point is { x: number; y: number } => Boolean(point));
  const routePath = buildPreviewRoute(routeStops);
  const highlightedCodes = new Set(['FR', 'AE', 'JP', 'US', 'GB', 'IT']);

  return (
    <main className="relative min-h-screen overflow-hidden bg-slate-950 text-slate-100">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-80"
        style={{
          backgroundImage: [
            'radial-gradient(circle at 12% 14%, rgba(56, 189, 248, 0.18), transparent 32%)',
            'radial-gradient(circle at 86% 18%, rgba(251, 191, 36, 0.16), transparent 26%)',
            'radial-gradient(circle at 50% 78%, rgba(34, 197, 94, 0.10), transparent 28%)',
          ].join(','),
        }}
      />

      <div className="relative mx-auto flex w-full max-w-7xl flex-col gap-12 px-6 py-10 sm:px-8 lg:px-12 lg:py-14">
        <div className="flex items-center justify-between opacity-0 animate-fade-in-down">
          <SectionEyebrow icon={Plane}>Flight Tracker</SectionEyebrow>
          <LanguageSwitcher currentLocale={locale} />
        </div>

        <HeroSection
          title={copy.heroTitle}
          description={copy.heroDescription}
          cta={
            <div className="flex flex-wrap items-center gap-3">
              <Link
                href="/tracker"
                locale={locale}
                className="inline-flex items-center gap-2 rounded-full bg-cyan-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400"
              >
                <Radar className="h-4 w-4" />
                {copy.primaryCta}
              </Link>
              <Link
                href="/airports"
                locale={locale}
                className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-300 backdrop-blur-sm transition hover:border-cyan-300/40 hover:text-cyan-100"
              >
                {copy.secondaryCta}
              </Link>
              <Link
                href="/chantal"
                locale={locale}
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-300 backdrop-blur-sm transition hover:border-amber-300/40 hover:text-amber-100"
              >
                <Users className="h-4 w-4" />
                {copy.chantalCta}
              </Link>
            </div>
          }
          metrics={
            <>
              {copy.metrics.map((item) => (
                <MetricCard key={item.label} label={item.label} value={item.value} helper={item.helper} />
              ))}
            </>
          }
        />

        <MapSection
          eyebrow={<SectionEyebrow icon={Route}>{copy.mapEyebrow}</SectionEyebrow>}
          heading={copy.mapHeading}
          description={copy.mapDescription}
          sidebarPosition="right"
          sidebarContent={
            <>
              <div className="border-b border-slate-800 px-3 py-2.5">
                <p className="text-[9px] uppercase tracking-[0.2em] text-slate-400">{copy.mapSidebarTitle}</p>
                <p className="mt-1 text-sm font-semibold text-slate-100">AXN402</p>
                <p className="mt-1 text-[11px] text-slate-500">{copy.mapSidebarStatus}</p>
              </div>
              <div className="space-y-2 p-3 text-xs text-slate-300">
                <div className="rounded-lg border border-cyan-400/25 bg-cyan-500/10 p-2">Origin • France</div>
                <div className="rounded-lg border border-white/10 bg-slate-900/55 p-2">Current • 10,900 m • 812 km/h</div>
                <div className="rounded-lg border border-white/10 bg-slate-900/55 p-2">History • route points and live state</div>
              </div>
            </>
          }
        >
          <svg aria-hidden="true" className="absolute inset-0 h-full w-full" viewBox={`0 0 ${map.viewBox.width} ${map.viewBox.height}`} preserveAspectRatio="xMidYMid slice">
            <rect x="0" y="0" width={map.viewBox.width} height={map.viewBox.height} fill="rgba(2,6,23,0.74)" />
            <g>
              {map.countries.map((country) => (
                <path
                  key={country.code}
                  d={country.path}
                  fill={highlightedCodes.has(country.code.toUpperCase()) ? 'rgba(34,211,238,0.18)' : 'rgba(15,23,42,0.62)'}
                  stroke={highlightedCodes.has(country.code.toUpperCase()) ? 'rgba(103,232,249,0.5)' : 'rgba(148,163,184,0.24)'}
                  strokeWidth="0.8"
                />
              ))}
            </g>

            {routeStops.length > 1 ? (
              <path
                d={routePath}
                fill="none"
                stroke="rgba(56,189,248,0.88)"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ filter: 'drop-shadow(0 0 10px rgba(56,189,248,0.45))' }}
              />
            ) : null}

            {routeStops.map((point, index) => (
              <g key={`preview-stop-${index}`}>
                <circle cx={point.x} cy={point.y} r={index === routeStops.length - 1 ? 5.5 : 4.2} fill={index === routeStops.length - 1 ? '#22d3ee' : '#f59e0b'} />
                <circle cx={point.x} cy={point.y} r={index === routeStops.length - 1 ? 10 : 7} fill={index === routeStops.length - 1 ? 'rgba(34,211,238,0.18)' : 'rgba(245,158,11,0.16)'} />
              </g>
            ))}
          </svg>
        </MapSection>

        <StatsSection
          eyebrow={<SectionEyebrow icon={Globe2}>{copy.statsEyebrow}</SectionEyebrow>}
          heading={copy.statsHeading}
          description={copy.statsDescription}
          content={
            <div className="grid gap-3 sm:grid-cols-2">
              {copy.featureCards.map((item) => (
                <FeatureCard key={item.title} title={item.title} body={item.body} />
              ))}
            </div>
          }
        />

        <footer className="opacity-0 animate-fade-in-up py-2 text-center text-sm text-slate-400">
          <p>{copy.footer}</p>
          <p className="mt-2 text-xs text-slate-500">© {currentYear} Flight Tracker</p>
        </footer>
      </div>
    </main>
  );
}