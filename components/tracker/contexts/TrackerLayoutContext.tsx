'use client';

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useIsMobile } from '../hooks/useIsMobile';

interface TrackerLayoutContextValue {
  isMobile: boolean;
  layoutReady: boolean;
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean | ((current: boolean) => boolean)) => void;
  sidebarRef: RefObject<HTMLDivElement | null>;
  sidebarToggleRef: RefObject<HTMLButtonElement | null>;
  topBarRef: RefObject<HTMLDivElement | null>;
}

const TrackerLayoutContext = createContext<TrackerLayoutContextValue | null>(null);

export function TrackerLayoutProvider({ children }: { children: ReactNode }) {
  const { isMobile, isResolved } = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const sidebarRef = useRef<HTMLDivElement | null>(null);
  const sidebarToggleRef = useRef<HTMLButtonElement | null>(null);
  const topBarRef = useRef<HTMLDivElement | null>(null);
  const sidebarInitialisedRef = useRef(false);

  useEffect(() => {
    if (!isResolved || sidebarInitialisedRef.current) {
      return;
    }

    setSidebarOpen(!isMobile);
    sidebarInitialisedRef.current = true;
  }, [isMobile, isResolved]);

  const value = useMemo<TrackerLayoutContextValue>(() => ({
    isMobile,
    layoutReady: isResolved,
    sidebarOpen,
    setSidebarOpen,
    sidebarRef,
    sidebarToggleRef,
    topBarRef,
  }), [isMobile, isResolved, sidebarOpen]);

  return <TrackerLayoutContext.Provider value={value}>{children}</TrackerLayoutContext.Provider>;
}

export function useTrackerLayout(): TrackerLayoutContextValue {
  const context = useContext(TrackerLayoutContext);
  if (!context) {
    throw new Error('useTrackerLayout must be used within a TrackerLayoutProvider');
  }
  return context;
}
