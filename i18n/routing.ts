import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({
  locales: ['en', 'fr', 'it', 'es', 'de', 'pt', 'zh', 'ar'] as const,
  defaultLocale: 'en',
});

export type AppLocale = (typeof routing.locales)[number];

export function isValidLocale(locale: string): locale is AppLocale {
  return routing.locales.includes(locale as AppLocale);
}

export function getSafeLocale(locale: string | null | undefined): AppLocale {
  return locale && isValidLocale(locale) ? locale : routing.defaultLocale;
}
