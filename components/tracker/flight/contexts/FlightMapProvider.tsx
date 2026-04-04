'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { select } from 'd3-selection';
import 'd3-transition';
import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from 'd3-zoom';
import { DESKTOP_DEFAULT_MAP_TRANSFORM } from '../../constants';
import { useTrackerLayout } from '../../contexts/TrackerLayoutContext';
import { TrackerMapProvider } from '../../contexts/TrackerMapContext';

const MIN_FLAT_MAP_ZOOM = 1;
const MAX_FLAT_MAP_ZOOM = 12;
const TRACKER_VIEWBOX = { width: 1000, height: 560 };

interface BoundsRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function FlightMapProvider({ children }: { children: ReactNode }) {
  const { isMobile, sidebarOpen } = useTrackerLayout();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const zoomBehaviorRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const getDefaultMapTransform = useCallback(() => {
    return isMobile ? zoomIdentity : DESKTOP_DEFAULT_MAP_TRANSFORM;
  }, [isMobile]);

  const defaultTransformRef = useRef<ZoomTransform>(DESKTOP_DEFAULT_MAP_TRANSFORM);
  const mapTransformRef = useRef<ZoomTransform>(DESKTOP_DEFAULT_MAP_TRANSFORM);
  const [mapTransform, setMapTransform] = useState<ZoomTransform>(DESKTOP_DEFAULT_MAP_TRANSFORM);

  useEffect(() => {
    defaultTransformRef.current = getDefaultMapTransform();
    if (!svgRef.current || !zoomBehaviorRef.current) {
      return;
    }

    select(svgRef.current)
      .transition()
      .duration(220)
      .call(zoomBehaviorRef.current.transform, defaultTransformRef.current);
  }, [getDefaultMapTransform]);

  useEffect(() => {
    const svgElement = svgRef.current;
    if (!svgElement) {
      return;
    }

    const svgSelection = select(svgElement);
    const behavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([MIN_FLAT_MAP_ZOOM, MAX_FLAT_MAP_ZOOM])
      .on('zoom', (event: { transform: ZoomTransform }) => {
        mapTransformRef.current = event.transform;
        setMapTransform(event.transform);
      });

    const preventBrowserZoomAtMax = (event: WheelEvent) => {
      const zoomingIn = event.deltaY < 0;
      const atOrAboveMax = mapTransformRef.current.k >= MAX_FLAT_MAP_ZOOM - 0.001;

      if ((event.ctrlKey || event.metaKey) && zoomingIn && atOrAboveMax) {
        event.preventDefault();
      }
    };

    const preventGestureZoom = (event: Event) => {
      const atOrAboveMax = mapTransformRef.current.k >= MAX_FLAT_MAP_ZOOM - 0.001;
      if (atOrAboveMax) {
        event.preventDefault();
      }
    };

    zoomBehaviorRef.current = behavior;
    defaultTransformRef.current = getDefaultMapTransform();
    mapTransformRef.current = defaultTransformRef.current;
    setMapTransform(defaultTransformRef.current);

    svgSelection.call(behavior);
    svgSelection.call(behavior.transform, defaultTransformRef.current);
    svgElement.addEventListener('wheel', preventBrowserZoomAtMax, { passive: false });
    svgElement.addEventListener('gesturestart', preventGestureZoom, { passive: false });
    svgElement.addEventListener('gesturechange', preventGestureZoom, { passive: false });

    return () => {
      svgElement.removeEventListener('wheel', preventBrowserZoomAtMax);
      svgElement.removeEventListener('gesturestart', preventGestureZoom);
      svgElement.removeEventListener('gesturechange', preventGestureZoom);
      svgSelection.on('.zoom', null);
      zoomBehaviorRef.current = null;
    };
  }, [getDefaultMapTransform]);

  const zoomBy = useCallback((factor: number) => {
    if (!svgRef.current || !zoomBehaviorRef.current) {
      return;
    }

    select(svgRef.current)
      .transition()
      .duration(180)
      .call(zoomBehaviorRef.current.scaleBy, factor);
  }, []);

  const focusBounds = useCallback((bounds: BoundsRect) => {
    if (!svgRef.current || !zoomBehaviorRef.current || bounds.width <= 0 || bounds.height <= 0) {
      return;
    }

    const availableWidth = TRACKER_VIEWBOX.width - (!isMobile && sidebarOpen ? 360 : 120);
    const availableHeight = TRACKER_VIEWBOX.height - (isMobile && sidebarOpen ? 180 : 120);
    const scale = Math.max(
      MIN_FLAT_MAP_ZOOM,
      Math.min(
        MAX_FLAT_MAP_ZOOM,
        Math.min(availableWidth / bounds.width, availableHeight / bounds.height) * 0.85,
      ),
    );

    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;
    const targetCenterX = !isMobile && sidebarOpen ? TRACKER_VIEWBOX.width * 0.36 : TRACKER_VIEWBOX.width / 2;
    const targetCenterY = isMobile && sidebarOpen ? TRACKER_VIEWBOX.height * 0.3 : TRACKER_VIEWBOX.height / 2;

    const nextTransform = zoomIdentity
      .translate(targetCenterX - scale * centerX, targetCenterY - scale * centerY)
      .scale(scale);

    select(svgRef.current)
      .transition()
      .duration(260)
      .call(zoomBehaviorRef.current.transform, nextTransform);
  }, [isMobile, sidebarOpen]);

  const resetZoom = useCallback(() => {
    if (!svgRef.current || !zoomBehaviorRef.current) {
      return;
    }

    select(svgRef.current)
      .transition()
      .duration(220)
      .call(zoomBehaviorRef.current.transform, defaultTransformRef.current);
  }, []);

  const value = useMemo(() => ({
    svgRef,
    mapTransform,
    zoomBy,
    resetZoom,
    focusBounds,
    isAtMinZoom: mapTransform.k <= MIN_FLAT_MAP_ZOOM + 0.001,
    isAtMaxZoom: mapTransform.k >= MAX_FLAT_MAP_ZOOM - 0.001,
  }), [focusBounds, mapTransform, resetZoom, zoomBy]);

  return <TrackerMapProvider value={value}>{children}</TrackerMapProvider>;
}
