'use client';

import { useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTrackerLayout } from './contexts/TrackerLayoutContext';

interface TrackerSidebarDesktopProps {
  children: ReactNode;
  footer?: ReactNode;
}

export default function TrackerSidebarDesktop({ children, footer }: TrackerSidebarDesktopProps) {
  const { sidebarOpen, setSidebarOpen, sidebarRef, sidebarToggleRef } = useTrackerLayout();
  const [isPeekActive, setIsPeekActive] = useState(false);

  const desktopWrapperClass = 'z-40 absolute top-[5rem] right-3 flex w-[min(92vw,25rem)] xl:w-[min(40vw,30rem)] 2xl:w-[min(36vw,34rem)] flex-col gap-3';

  return (
    <div
      ref={sidebarRef}
      className={desktopWrapperClass}
      style={{
        transform: sidebarOpen
          ? 'translate3d(0, 0, 0)'
          : `translate3d(calc(100% - ${isPeekActive ? '1.2rem' : '1rem'}), 0, 0)`,
        transition: 'transform 280ms ease-out',
        willChange: 'transform',
      }}
      onClick={() => {
        if (!sidebarOpen) {
          setSidebarOpen(true);
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
      <aside className="relative h-fit max-h-[calc(100dvh-6.5rem)] rounded-3xl border border-white/12 bg-slate-950/88 shadow-[0_30px_90px_rgba(2,6,23,0.55)] backdrop-blur-md pointer-events-auto flex flex-col">
        <button
          ref={sidebarToggleRef}
          type="button"
          onClick={() => {
            setIsPeekActive(false);
            setSidebarOpen((current) => !current);
          }}
          onMouseEnter={() => {
            if (!sidebarOpen) {
              setIsPeekActive(true);
            }
          }}
          onMouseLeave={() => {
            setIsPeekActive(false);
          }}
          onFocus={() => {
            if (!sidebarOpen) {
              setIsPeekActive(true);
            }
          }}
          onBlur={() => {
            setIsPeekActive(false);
          }}
          className={`absolute -left-16 top-1/2 -translate-y-1/2 z-40 flex h-12 w-12 items-center justify-center rounded-full border border-white/12 bg-slate-950/85 text-slate-100 shadow-xl backdrop-blur-sm transition-[background-color,border-color,color,box-shadow,transform] duration-150 hover:bg-slate-900 hover:border-white/20 ${!sidebarOpen ? 'hover:scale-105 focus-visible:scale-105' : ''}`}
          aria-label={sidebarOpen ? 'Collapse tracker panel' : 'Expand tracker panel'}
        >
          {sidebarOpen ? <ChevronRight className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
        </button>
        <div className="flex flex-col gap-4 overflow-y-auto overscroll-contain p-4 transition-all duration-300">
          {children}
        </div>
      </aside>

      {footer ? (
        <div className="rounded-3xl border border-white/12 bg-slate-950/88 p-4 shadow-[0_20px_60px_rgba(2,6,23,0.45)] backdrop-blur-md pointer-events-auto">
          {footer}
        </div>
      ) : null}
    </div>
  );
}
