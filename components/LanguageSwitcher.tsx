'use client';

import { useGlobalRouteLoading } from '~/components/GlobalRouteLoadingProvider';
import { Link, usePathname, useRouter } from '~/i18n/navigation';
import { routing } from '~/i18n/routing';

interface LanguageSwitcherProps {
  currentLocale: string;
}

export default function LanguageSwitcher({ currentLocale }: LanguageSwitcherProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { startRouteLoading } = useGlobalRouteLoading();
  const locales = routing.locales;
  const currentPath = pathname || '/';

  function handleLocaleChange(locale: string) {
    if (locale === currentLocale) {
      return;
    }

    startRouteLoading();
    router.replace(currentPath, { locale });
  }

  return (
    <>
      <div className="relative flex items-center rounded-full border border-white/10 bg-white/5 px-3 py-1 backdrop-blur-sm md:hidden">
        <label htmlFor="language-switcher" className="sr-only">
          Select language
        </label>
        <select
          id="language-switcher"
          value={currentLocale}
          onChange={(event) => handleLocaleChange(event.target.value)}
          className="appearance-none bg-transparent pr-5 text-xs font-medium uppercase tracking-wider text-slate-100 focus:outline-none"
        >
          {locales.map((locale) => (
            <option key={locale} value={locale}>
              {locale}
            </option>
          ))}
        </select>
        <svg
          className="pointer-events-none absolute right-2 h-3 w-3 text-slate-300"
          viewBox="0 0 12 12"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>

      <div className="hidden items-center gap-1 rounded-full border border-white/10 bg-white/5 p-1 backdrop-blur-sm md:flex">
        {locales.map((locale) => (
          <Link
            key={locale}
            href={currentPath}
            locale={locale}
            className={`rounded-full px-3 py-1 text-xs font-medium uppercase tracking-wider transition ${
              currentLocale === locale
                ? 'bg-amber-300 text-slate-950'
                : 'text-slate-300 hover:text-white'
            }`}
            aria-current={currentLocale === locale ? 'true' : undefined}
          >
            {locale}
          </Link>
        ))}
      </div>
    </>
  );
}
