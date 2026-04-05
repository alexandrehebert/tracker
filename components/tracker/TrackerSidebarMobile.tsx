'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useTrackerLayout } from './contexts/TrackerLayoutContext';

interface TrackerSidebarMobileProps {
  children: ReactNode;
}

export default function TrackerSidebarMobile({ children }: TrackerSidebarMobileProps) {
  const { sidebarOpen, setSidebarOpen, sidebarRef, sidebarToggleRef, topBarRef } = useTrackerLayout();
  const [sidebarMaxHeight, setSidebarMaxHeight] = useState('calc(100dvh - 7.5rem - max(1rem, env(safe-area-inset-bottom)))');
  const [isPeekActive, setIsPeekActive] = useState(false);

  const openSidebar = () => {
    setSidebarOpen(true);
  };

  const closeSidebar = () => {
    setSidebarOpen(false);
  };

  useEffect(() => {
    const updateSidebarMaxHeight = () => {
      const topBarBottom = topBarRef.current?.getBoundingClientRect().bottom ?? 72;
      const reservedTopSpace = Math.max(112, Math.ceil(topBarBottom + 28));
      setSidebarMaxHeight(`calc(100dvh - ${reservedTopSpace}px - max(1rem, env(safe-area-inset-bottom)))`);
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
    <>
      <button
        type="button"
        onClick={closeSidebar}
        className={`fixed inset-0 z-[45] bg-slate-950/45 transition-opacity duration-300 ${sidebarOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
        aria-label="Close tracker panel"
        tabIndex={sidebarOpen ? 0 : -1}
      />
      <div
        ref={sidebarRef}
        className="fixed left-3 right-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-50 flex flex-col items-center opacity-100 pointer-events-auto"
        style={{
          boxSizing: 'border-box',
          transform: sidebarOpen
            ? 'translate3d(0, 0, 0)'
            : `translate3d(0, calc(100% - ${isPeekActive ? '1.5rem' : '1.25rem'}), 0)`,
          transition: 'transform 280ms ease-out',
          willChange: 'transform',
        }}
        onClick={() => {
          if (!sidebarOpen) {
            openSidebar();
          }
        }}
        role={!sidebarOpen ? 'button' : undefined}
        tabIndex={!sidebarOpen ? 0 : -1}
        onKeyDown={!sidebarOpen ? (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openSidebar();
          }
        } : undefined}
        aria-label={!sidebarOpen ? 'Expand tracker panel' : undefined}
      >
        <button
          ref={sidebarToggleRef}
          type="button"
          onClick={() => {
            setIsPeekActive(false);

            if (sidebarOpen) {
              closeSidebar();
              return;
            }

            openSidebar();
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
    </>
  );
}
