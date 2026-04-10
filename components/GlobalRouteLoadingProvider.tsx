'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

interface GlobalRouteLoadingContextValue {
  startRouteLoading: () => void;
  stopRouteLoading: () => void;
}

const noop = () => {};

const GlobalRouteLoadingContext = createContext<GlobalRouteLoadingContextValue>({
  startRouteLoading: noop,
  stopRouteLoading: noop,
});

const MAX_LOADING_MS = 15000;

function isClientSideNavigationClick(event: MouseEvent): boolean {
  return event.button === 0
    && !event.metaKey
    && !event.altKey
    && !event.ctrlKey
    && !event.shiftKey;
}

function shouldStartLoadingForClick(event: MouseEvent): boolean {
  if (!isClientSideNavigationClick(event) || !(event.target instanceof Element)) {
    return false;
  }

  const anchor = event.target.closest('a[href]');
  if (!(anchor instanceof HTMLAnchorElement)) {
    return false;
  }

  if ((anchor.target && anchor.target !== '_self') || anchor.hasAttribute('download') || anchor.dataset.noRouteLoader === 'true') {
    return false;
  }

  const href = anchor.getAttribute('href');
  if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) {
    return false;
  }

  const nextUrl = new URL(anchor.href, window.location.href);
  const currentUrl = new URL(window.location.href);

  if (nextUrl.origin !== currentUrl.origin) {
    return false;
  }

  return nextUrl.pathname !== currentUrl.pathname || nextUrl.search !== currentUrl.search;
}

export function GlobalRouteLoadingProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isRouteLoading, setIsRouteLoading] = useState(false);
  const timeoutRef = useRef<number | null>(null);
  const activeLoadCountRef = useRef(0);

  const clearLoadingTimeout = useCallback(() => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const startRouteLoading = useCallback(() => {
    activeLoadCountRef.current += 1;
    setIsRouteLoading(true);
    clearLoadingTimeout();
    timeoutRef.current = window.setTimeout(() => {
      timeoutRef.current = null;
      activeLoadCountRef.current = 0;
      setIsRouteLoading(false);
    }, MAX_LOADING_MS);
  }, [clearLoadingTimeout]);

  const stopRouteLoading = useCallback(() => {
    activeLoadCountRef.current = Math.max(0, activeLoadCountRef.current - 1);

    if (activeLoadCountRef.current === 0) {
      clearLoadingTimeout();
      setIsRouteLoading(false);
    }
  }, [clearLoadingTimeout]);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return undefined;
    }

    const handleDocumentClick = (event: MouseEvent) => {
      if (shouldStartLoadingForClick(event)) {
        startRouteLoading();
      }
    };

    document.addEventListener('click', handleDocumentClick);
    return () => {
      document.removeEventListener('click', handleDocumentClick);
    };
  }, [startRouteLoading]);

  useEffect(() => {
    activeLoadCountRef.current = 0;
    setIsRouteLoading(false);
    clearLoadingTimeout();
  }, [pathname, searchParams, clearLoadingTimeout]);

  useEffect(() => {
    return () => {
      clearLoadingTimeout();
    };
  }, [clearLoadingTimeout]);

  const value = useMemo<GlobalRouteLoadingContextValue>(() => ({
    startRouteLoading,
    stopRouteLoading,
  }), [startRouteLoading, stopRouteLoading]);

  return (
    <GlobalRouteLoadingContext.Provider value={value}>
      {children}
      <div
        className={`pointer-events-none fixed inset-x-0 top-0 z-[400] transition-opacity duration-150 ${isRouteLoading ? 'opacity-100' : 'opacity-0'}`}
        aria-live="polite"
        aria-atomic="true"
      >
        {isRouteLoading ? (
          <div
            role="status"
            aria-label="Loading page"
            className="relative h-1 overflow-hidden bg-sky-400/10 shadow-[0_0_18px_rgba(56,189,248,0.22)]"
          >
            <div className="route-loading-indeterminate absolute inset-y-0 w-1/3 min-w-24 bg-gradient-to-r from-sky-400/0 via-sky-300 to-cyan-200/0" />
          </div>
        ) : null}
      </div>
    </GlobalRouteLoadingContext.Provider>
  );
}

export function useGlobalRouteLoading() {
  return useContext(GlobalRouteLoadingContext);
}