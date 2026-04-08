'use client';

import { useCallback, useEffect, type ReactNode } from 'react';
import { Link, useRouter } from '~/i18n/navigation';

interface ConfigDrawerShellProps {
  badge: string;
  title: string;
  description: string;
  fullPageHref: string;
  children: ReactNode;
}

export function ConfigDrawerShell({
  badge,
  title,
  description,
  fullPageHref,
  children,
}: ConfigDrawerShellProps) {
  const router = useRouter();

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const scrollY = window.scrollY;
    const { body } = document;
    const previousOverflow = body.style.overflow;
    const previousPosition = body.style.position;
    const previousTop = body.style.top;
    const previousWidth = body.style.width;

    body.style.overflow = 'hidden';
    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.width = '100%';

    return () => {
      body.style.overflow = previousOverflow;
      body.style.position = previousPosition;
      body.style.top = previousTop;
      body.style.width = previousWidth;
      window.scrollTo({ top: scrollY, behavior: 'auto' });
    };
  }, []);

  const closeDrawer = useCallback(() => {
    if (typeof window === 'undefined') {
      router.replace('/chantal/config', { scroll: false });
      return;
    }

    const currentUrl = window.location.pathname + window.location.search + window.location.hash;
    router.back();

    window.setTimeout(() => {
      const nextUrl = window.location.pathname + window.location.search + window.location.hash;

      if (nextUrl === currentUrl) {
        router.replace('/chantal/config', { scroll: false });
      }
    }, 120);
  }, [router]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/45 backdrop-blur-[1px]">
      <button
        type="button"
        onClick={closeDrawer}
        aria-label="Close admin drawer"
        className="min-w-0 flex-1 pointer-events-auto bg-transparent"
      >
        <span className="sr-only">Close admin drawer</span>
      </button>

      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="chantal-config-drawer-title"
        className="pointer-events-auto h-full w-full max-w-[min(94vw,60rem)] overflow-y-auto border-l border-white/10 bg-slate-950/95 shadow-[-20px_0_60px_rgba(15,23,42,0.45)]"
      >
        <div className="sticky top-0 z-10 border-b border-white/10 bg-slate-950/95 px-4 py-4 sm:px-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="max-w-2xl">
              <p className="text-[11px] uppercase tracking-[0.24em] text-sky-300">{badge}</p>
              <h2 id="chantal-config-drawer-title" className="mt-1 text-2xl font-semibold text-white">
                {title}
              </h2>
              <p className="mt-1 text-sm text-slate-300">{description}</p>
            </div>

            <div className="flex flex-wrap gap-2">
              <a
                href={fullPageHref}
                className="inline-flex items-center rounded-full border border-sky-400/40 bg-sky-500/10 px-3 py-1.5 text-sm text-sky-100 transition hover:bg-sky-500/20"
              >
                Open standalone page
              </a>
              <button
                type="button"
                onClick={closeDrawer}
                className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-slate-200 transition hover:border-sky-300/50 hover:bg-sky-500/10"
              >
                Close
              </button>
            </div>
          </div>
        </div>

        <div className="px-4 py-4 sm:px-5 sm:py-5">{children}</div>
      </aside>
    </div>
  );
}
