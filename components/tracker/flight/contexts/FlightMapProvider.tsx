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
import type { TrackerMapView } from '../FlightMapViewToggle';

const DEFAULT_GLOBE_ALTITUDE = 1.65;
const MOBILE_GLOBE_ALTITUDE = 1.95;
const MIN_GLOBE_ALTITUDE = 0.4;
const MAX_GLOBE_ALTITUDE = 6;
const MIN_FLAT_MAP_ZOOM = 1;
const MAX_FLAT_MAP_ZOOM = 24;
const TRACKER_VIEWBOX = { width: 1000, height: 560 };

interface BoundsRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function FlightMapProvider({
  children,
  mapView,
}: {
  children: ReactNode;
  mapView: TrackerMapView;
}) {
  const { isMobile, sidebarOpen } = useTrackerLayout();
  const globeRef = useRef<any>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const zoomBehaviorRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const flatMapMountRetryFrameRef = useRef<number | null>(null);
  const [flatMapMountTick, setFlatMapMountTick] = useState(0);
  const [globeAltitude, setGlobeAltitude] = useState(isMobile ? MOBILE_GLOBE_ALTITUDE : DEFAULT_GLOBE_ALTITUDE);
  const getDefaultMapTransform = useCallback(() => {
    return isMobile ? zoomIdentity : DESKTOP_DEFAULT_MAP_TRANSFORM;
  }, [isMobile]);

  const defaultTransformRef = useRef<ZoomTransform>(DESKTOP_DEFAULT_MAP_TRANSFORM);
  const mapTransformRef = useRef<ZoomTransform>(DESKTOP_DEFAULT_MAP_TRANSFORM);
  const [mapTransform, setMapTransform] = useState<ZoomTransform>(DESKTOP_DEFAULT_MAP_TRANSFORM);

  const setGlobeRef = useCallback((globe: any) => {
    globeRef.current = globe;
    const nextAltitude = globe?.pointOfView?.()?.altitude ?? (isMobile ? MOBILE_GLOBE_ALTITUDE : DEFAULT_GLOBE_ALTITUDE);
    setGlobeAltitude(nextAltitude);
  }, [isMobile]);

  useEffect(() => {
    return () => {
      if (flatMapMountRetryFrameRef.current !== null) {
        cancelAnimationFrame(flatMapMountRetryFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (mapView !== 'flat') {
      return;
    }

    defaultTransformRef.current = getDefaultMapTransform();
    if (!svgRef.current || !zoomBehaviorRef.current) {
      return;
    }

    select(svgRef.current)
      .transition()
      .duration(220)
      .call(zoomBehaviorRef.current.transform, defaultTransformRef.current);
  }, [getDefaultMapTransform, mapView]);

  useEffect(() => {
    if (mapView !== 'flat') {
      return;
    }

    const svgElement = svgRef.current;
    if (!svgElement) {
      flatMapMountRetryFrameRef.current = window.requestAnimationFrame(() => {
        flatMapMountRetryFrameRef.current = null;
        setFlatMapMountTick((current) => current + 1);
      });

      return () => {
        if (flatMapMountRetryFrameRef.current !== null) {
          cancelAnimationFrame(flatMapMountRetryFrameRef.current);
          flatMapMountRetryFrameRef.current = null;
        }
      };
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
  }, [flatMapMountTick, getDefaultMapTransform, mapView]);

  useEffect(() => {
    if (mapView !== 'globe') {
      return;
    }

    const nextAltitude = globeRef.current?.pointOfView?.()?.altitude ?? (isMobile ? MOBILE_GLOBE_ALTITUDE : DEFAULT_GLOBE_ALTITUDE);
    setGlobeAltitude(nextAltitude);
  }, [isMobile, mapView]);

  const zoomBy = useCallback((factor: number) => {
    if (mapView === 'globe') {
      if (!globeRef.current) {
        return;
      }

      const currentPointOfView = globeRef.current.pointOfView?.() ?? {};
      const nextAltitude = Math.max(
        MIN_GLOBE_ALTITUDE,
        Math.min(MAX_GLOBE_ALTITUDE, (currentPointOfView.altitude ?? DEFAULT_GLOBE_ALTITUDE) / factor),
      );

      setGlobeAltitude(nextAltitude);
      globeRef.current.pointOfView({ ...currentPointOfView, altitude: nextAltitude }, 300);
      return;
    }

    if (!svgRef.current || !zoomBehaviorRef.current) {
      return;
    }

    select(svgRef.current)
      .transition()
      .duration(180)
      .call(zoomBehaviorRef.current.scaleBy, factor);
  }, [mapView]);

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
    if (mapView === 'globe') {
      if (!globeRef.current) {
        return;
      }

      const currentPointOfView = globeRef.current.pointOfView?.() ?? {};
      const nextAltitude = isMobile ? MOBILE_GLOBE_ALTITUDE : DEFAULT_GLOBE_ALTITUDE;
      setGlobeAltitude(nextAltitude);
      globeRef.current.pointOfView({ ...currentPointOfView, altitude: nextAltitude }, 500);
      return;
    }

    if (!svgRef.current || !zoomBehaviorRef.current) {
      return;
    }

    select(svgRef.current)
      .transition()
      .duration(220)
      .call(zoomBehaviorRef.current.transform, defaultTransformRef.current);
  }, [isMobile, mapView]);

  const value = useMemo(() => ({
    globeRef,
    setGlobeRef,
    svgRef,
    mapTransform,
    zoomBy,
    resetZoom,
    focusBounds,
    isAtMinZoom: mapView === 'globe'
      ? globeAltitude >= MAX_GLOBE_ALTITUDE - 0.001
      : mapTransform.k <= MIN_FLAT_MAP_ZOOM + 0.001,
    isAtMaxZoom: mapView === 'globe'
      ? globeAltitude <= MIN_GLOBE_ALTITUDE + 0.001
      : mapTransform.k >= MAX_FLAT_MAP_ZOOM - 0.001,
  }), [focusBounds, globeAltitude, mapTransform, mapView, resetZoom, setGlobeRef, zoomBy]);

  return <TrackerMapProvider value={value}>{children}</TrackerMapProvider>;
}
