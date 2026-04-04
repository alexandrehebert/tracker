import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({
  locales: ['en', 'fr', 'it', 'es', 'de', 'pt', 'zh', 'ar'],
  defaultLocale: 'en',
});
