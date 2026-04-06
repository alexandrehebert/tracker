'use client';

import { LocateFixed, Minus, Plus } from 'lucide-react';
import { useTrackerMap } from './contexts/TrackerMapContext';

export default function TrackerZoomControls() {
  const { zoomBy, resetZoom, isAtMinZoom = false, isAtMaxZoom = false } = useTrackerMap();

  const zoomButtonClass =
    'inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/12 bg-slate-950/80 p-2 text-slate-100 shadow backdrop-blur-sm transition-[background-color,border-color,color,box-shadow,opacity] duration-150';
  const enabledZoomButtonClass = 'hover:bg-slate-900 hover:border-white/20';
  const disabledZoomButtonClass = 'cursor-not-allowed opacity-45';

  return (
    <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-white/12 bg-slate-950/40 p-1 backdrop-blur-sm">
      <button
        type="button"
        disabled={isAtMaxZoom}
        onClick={() => zoomBy(1.25)}
        className={`${zoomButtonClass} ${isAtMaxZoom ? disabledZoomButtonClass : enabledZoomButtonClass}`}
        aria-label="Zoom in"
      >
        <Plus className="h-5 w-5" />
      </button>
      <button
        type="button"
        disabled={isAtMinZoom}
        onClick={() => zoomBy(0.8)}
        className={`${zoomButtonClass} ${isAtMinZoom ? disabledZoomButtonClass : enabledZoomButtonClass}`}
        aria-label="Zoom out"
      >
        <Minus className="h-5 w-5" />
      </button>
      <button
        type="button"
        onClick={resetZoom}
        className="inline-flex h-9 w-9 items-center justify-center gap-1 rounded-full border border-white/12 bg-slate-950/80 p-2 text-slate-100 shadow backdrop-blur-sm transition-[background-color,border-color,color,box-shadow] duration-150 hover:bg-slate-900 hover:border-white/20 lg:w-auto lg:px-3"
        aria-label="Reset view"
      >
        <LocateFixed className="h-5 w-5" />
        <span className="hidden lg:inline">Reset</span>
      </button>
    </div>
  );
}
