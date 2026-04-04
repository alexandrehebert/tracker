import type { Metadata } from 'next';
import { Analytics } from '@vercel/analytics/next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { routing } from '~/i18n/routing';
import { PwaInit } from '~/components/PwaInit';
import { GlobalRouteLoadingProvider } from '~/components/GlobalRouteLoadingProvider';

export const metadata: Metadata = {
  title: 'Flight Tracker',
  description: 'Track live aircraft on an interactive world map with reusable zoom controls and OpenSky data.',
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const RTL_LOCALES = ['ar', 'fa', 'he', 'ur'];

  if (!routing.locales.includes(locale as (typeof routing.locales)[number])) {
    notFound();
  }

  const messages = await getMessages();
  const direction = RTL_LOCALES.includes(locale) ? 'rtl' : 'ltr';

  return (
    <html lang={locale} dir={direction}>
      <body className={`${GeistSans.variable} ${GeistMono.variable} antialiased`}>
        <PwaInit />
        <NextIntlClientProvider messages={messages}>
          <GlobalRouteLoadingProvider>
            {children}
          </GlobalRouteLoadingProvider>
        </NextIntlClientProvider>
        <Analytics />
      </body>
    </html>
  );
}
