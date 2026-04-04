'use client';

import { createContext, useContext, type ReactNode, type RefObject } from 'react';
import type { ZoomTransform } from 'd3-zoom';

export interface TrackerMapContextValue {
  svgRef: RefObject<SVGSVGElement | null>;
  mapTransform: ZoomTransform;
  zoomBy: (factor: number) => void;
  resetZoom: () => void;
  focusBounds?: (bounds: { x: number; y: number; width: number; height: number }) => void;
  isAtMinZoom?: boolean;
  isAtMaxZoom?: boolean;
}

const TrackerMapContext = createContext<TrackerMapContextValue | null>(null);

export function TrackerMapProvider({
  value,
  children,
}: {
  value: TrackerMapContextValue;
  children: ReactNode;
}) {
  return <TrackerMapContext.Provider value={value}>{children}</TrackerMapContext.Provider>;
}

export function useTrackerMap(): TrackerMapContextValue {
  const context = useContext(TrackerMapContext);
  if (!context) {
    throw new Error('useTrackerMap must be used within a TrackerMapProvider');
  }
  return context;
}
