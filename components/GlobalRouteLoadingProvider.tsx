'use client';

import { Map as MapIcon } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

interface GlobalRouteLoadingContextValue {
  startRouteLoading: () => void;
}

const GlobalRouteLoadingContext = createContext<GlobalRouteLoadingContextValue | null>(null);

const MAX_OVERLAY_MS = 15000;

export function GlobalRouteLoadingProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isRouteLoading, setIsRouteLoading] = useState(false);
  const timeoutRef = useRef<number | null>(null);

  const clearLoadingTimeout = useCallback(() => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const startRouteLoading = useCallback(() => {
    setIsRouteLoading(true);
    clearLoadingTimeout();
    timeoutRef.current = window.setTimeout(() => {
      timeoutRef.current = null;
      setIsRouteLoading(false);
    }, MAX_OVERLAY_MS);
  }, [clearLoadingTimeout]);

  useEffect(() => {
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
  }), [startRouteLoading]);

  return (
    <GlobalRouteLoadingContext.Provider value={value}>
      {children}
      <div
        className={`fixed inset-0 z-[300] flex items-center justify-center bg-slate-950/80 transition-opacity duration-700 ${isRouteLoading ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
        aria-hidden="true"
      >
        <MapIcon className="animate-spin text-sky-400" size={64} strokeWidth={2.5} />
      </div>
    </GlobalRouteLoadingContext.Provider>
  );
}

export function useGlobalRouteLoading() {
  const context = useContext(GlobalRouteLoadingContext);
  if (!context) {
    throw new Error('useGlobalRouteLoading must be used within GlobalRouteLoadingProvider');
  }
  return context;
}