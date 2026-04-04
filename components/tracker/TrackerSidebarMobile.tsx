'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useTrackerLayout } from './contexts/TrackerLayoutContext';

interface TrackerSidebarMobileProps {
  children: ReactNode;
}

export default function TrackerSidebarMobile({ children }: TrackerSidebarMobileProps) {
  const { sidebarOpen, setSidebarOpen, sidebarRef, sidebarToggleRef, topBarRef } = useTrackerLayout();
  const [suppressCollapsedPreview, setSuppressCollapsedPreview] = useState(false);
  const [sidebarMaxHeight, setSidebarMaxHeight] = useState('calc(100dvh - 6rem - max(0.75rem, env(safe-area-inset-bottom)))');

  useEffect(() => {
    const updateSidebarMaxHeight = () => {
      const topBarBottom = topBarRef.current?.getBoundingClientRect().bottom ?? 72;
      const reservedTopSpace = Math.max(88, Math.ceil(topBarBottom + 12));
      setSidebarMaxHeight(`calc(100dvh - ${reservedTopSpace}px - max(0.75rem, env(safe-area-inset-bottom)))`);
    };

    updateSidebarMaxHeight();

    if (typeof window === 'undefined') {
      return undefined;
    }

    const resizeObserver = typeof ResizeObserver === 'undefined' || !topBarRef.current
      ? null
      : new ResizeObserver(() => {
        updateSidebarMaxHeight();
      });

    if (resizeObserver && topBarRef.current) {
      resizeObserver.observe(topBarRef.current);
    }

    window.addEventListener('resize', updateSidebarMaxHeight);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', updateSidebarMaxHeight);
    };
  }, [topBarRef]);

  return (
    <div
      ref={sidebarRef}
      className={
        `fixed left-3 right-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40 flex flex-col items-center transition-all duration-300` +
        (sidebarOpen
          ? ' translate-y-0 opacity-100 pointer-events-auto'
          : ` translate-y-[90%] opacity-100 pointer-events-auto ${suppressCollapsedPreview ? '' : 'hover:translate-y-[86%] focus-visible:translate-y-[86%]'}`)
      }
      style={{ boxSizing: 'border-box' }}
      onClick={() => {
        if (!sidebarOpen) {
          setSuppressCollapsedPreview(false);
          setSidebarOpen(true);
        }
      }}
      onMouseLeave={() => {
        if (!sidebarOpen && suppressCollapsedPreview) {
          setSuppressCollapsedPreview(false);
        }
      }}
      role={!sidebarOpen ? 'button' : undefined}
      tabIndex={!sidebarOpen ? 0 : -1}
      onKeyDown={!sidebarOpen ? (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          setSidebarOpen(true);
        }
      } : undefined}
      aria-label={!sidebarOpen ? 'Expand tracker panel' : undefined}
    >
      <button
        ref={sidebarToggleRef}
        type="button"
        onClick={() => {
          const willOpen = !sidebarOpen;
          setSuppressCollapsedPreview(!willOpen);
          setSidebarOpen(willOpen);
        }}
        className={`absolute left-1/2 -top-12 z-50 flex h-10 w-10 -translate-x-1/2 items-center justify-center rounded-full border border-white/12 bg-slate-950/85 text-slate-100 shadow-xl backdrop-blur-sm transition-[background-color,border-color,color,box-shadow,transform] duration-150 hover:bg-slate-900 hover:border-white/20 ${!sidebarOpen ? 'hover:scale-105 focus-visible:scale-105' : ''}`}
        aria-label={sidebarOpen ? 'Collapse tracker panel' : 'Expand tracker panel'}
      >
        {sidebarOpen ? <ChevronDown className="h-5 w-5" /> : <ChevronUp className="h-5 w-5" />}
      </button>
      <div className="relative w-full">
        <aside
          className="flex h-auto min-h-0 w-full flex-col rounded-b-3xl rounded-t-3xl border border-white/12 bg-slate-950/88 shadow-[0_30px_90px_rgba(2,6,23,0.55)] backdrop-blur-md pointer-events-auto"
          style={{ maxHeight: sidebarMaxHeight }}
        >
          <div className="flex min-h-0 flex-col gap-4 overflow-y-auto overscroll-contain p-4 transition-all duration-300">
            {children}
          </div>
        </aside>
      </div>
    </div>
  );
}
