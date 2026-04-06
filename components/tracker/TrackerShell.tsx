'use client';

import { useEffect, useState, type ReactNode } from 'react';
import TrackerBackground from './TrackerBackground';
import TrackerSidebarDesktop from './TrackerSidebarDesktop';
import TrackerSidebarMobile from './TrackerSidebarMobile';
import { useTrackerLayout } from './contexts/TrackerLayoutContext';

interface TrackerShellProps {
  mapContent: ReactNode;
  sidebarContent: ReactNode;
  sidebarFooter?: ReactNode;
  topBar?: ReactNode;
  isLoading?: boolean;
  loadingContent?: ReactNode;
  showBackgroundGrid?: boolean;
}

function SidebarSwitcher({ content, footer }: { content: ReactNode; footer?: ReactNode }) {
  const { isMobile, layoutReady } = useTrackerLayout();
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  if (!hydrated || !layoutReady) return null;

  return isMobile
    ? <TrackerSidebarMobile>{content}</TrackerSidebarMobile>
    : <TrackerSidebarDesktop footer={footer}>{content}</TrackerSidebarDesktop>;
}

export default function TrackerShell({
  mapContent,
  sidebarContent,
  sidebarFooter,
  topBar,
  isLoading = false,
  loadingContent,
  showBackgroundGrid = false,
}: TrackerShellProps) {
  return (
    <div className="relative h-full w-full overflow-hidden bg-[#071a31] text-slate-100">
      <TrackerBackground showGrid={showBackgroundGrid} />
      {topBar ?? null}
      <div className={`transition-opacity duration-700 ${isLoading ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
        {mapContent}
      </div>
      <div
        className={`absolute inset-0 z-50 flex items-center justify-center bg-slate-950/80 transition-opacity duration-700 ${isLoading ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
      >
        {loadingContent}
      </div>
      <div className={`block transition-opacity duration-700 ${isLoading ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
        <SidebarSwitcher content={sidebarContent} footer={sidebarFooter} />
      </div>
    </div>
  );
}
