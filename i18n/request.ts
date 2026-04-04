import { getRequestConfig } from 'next-intl/server';
import { getSafeLocale } from './routing';

export default getRequestConfig(async ({ requestLocale }) => {
  const locale = getSafeLocale(await requestLocale);

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default as Record<string, unknown>,
  };
});
