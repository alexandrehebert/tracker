'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorldMapPayload } from '~/lib/server/worldMap';
import FlightMap2D from './FlightMap2D';
import type { TrackerMapView } from './FlightMapViewToggle';
import type { FlightMapAirportMarker, FriendAvatarInfo, FriendAvatarMarker, SelectedFlightDetails, TrackedFlight } from './types';

const FlightMap3D = dynamic(() => import('./FlightMap3D'), {
  ssr: false,
});

const MAP_SWITCH_RENDER_DELAY_MS = 700;

interface FlightMapProps {
  map: WorldMapPayload;
  flights: TrackedFlight[];
  mapView: TrackerMapView;
  selectedIcao24: string | null;
  selectedFlightDetails?: SelectedFlightDetails | null;
  airportMarkers?: FlightMapAirportMarker[];
  onSelectFlight?: (icao24: string) => void;
  onInitialZoomEnd?: () => void;
  selectionMode?: 'single' | 'all';
  flightLabels?: Record<string, string>;
  flightAvatars?: Record<string, FriendAvatarInfo[]>;
  staticFriendMarkers?: FriendAvatarMarker[];
  emptyOverlayMessage?: string | null;
}

export default function FlightMap({
  map,
  flights,
  mapView,
  selectedIcao24,
  selectedFlightDetails,
  airportMarkers = [],
  onSelectFlight,
  onInitialZoomEnd,
  selectionMode = 'single',
  flightLabels,
  flightAvatars,
  staticFriendMarkers,
  emptyOverlayMessage,
}: FlightMapProps) {
  const [renderedMapView, setRenderedMapView] = useState(mapView);
  const switchTimeoutRef = useRef<number | null>(null);
  const mapViewRef = useRef(mapView);
  const renderedMapViewRef = useRef(renderedMapView);

  useEffect(() => {
    mapViewRef.current = mapView;
  }, [mapView]);

  useEffect(() => {
    renderedMapViewRef.current = renderedMapView;
  }, [renderedMapView]);

  useEffect(() => {
    if (renderedMapView === mapView) {
      return;
    }

    if (switchTimeoutRef.current !== null) {
      window.clearTimeout(switchTimeoutRef.current);
      switchTimeoutRef.current = null;
    }

    switchTimeoutRef.current = window.setTimeout(() => {
      switchTimeoutRef.current = null;
      setRenderedMapView(mapViewRef.current);
    }, MAP_SWITCH_RENDER_DELAY_MS);

    return () => {
      if (switchTimeoutRef.current !== null) {
        window.clearTimeout(switchTimeoutRef.current);
        switchTimeoutRef.current = null;
      }
    };
  }, [mapView, renderedMapView]);

  const handleMapReady = useCallback(() => {
    if (renderedMapViewRef.current !== mapViewRef.current) {
      return;
    }

    onInitialZoomEnd?.();
  }, [onInitialZoomEnd]);

  if (renderedMapView === 'flat') {
    return (
      <FlightMap2D
        map={map}
        flights={flights}
        selectedIcao24={selectedIcao24}
        selectedFlightDetails={selectedFlightDetails}
        airportMarkers={airportMarkers}
        onSelectFlight={onSelectFlight}
        onInitialZoomEnd={handleMapReady}
        selectionMode={selectionMode}
        flightLabels={flightLabels}
        flightAvatars={flightAvatars}
        staticFriendMarkers={staticFriendMarkers}
        emptyOverlayMessage={emptyOverlayMessage}
      />
    );
  }

  return (
    <FlightMap3D
      flights={flights}
      selectedIcao24={selectedIcao24}
      selectedFlightDetails={selectedFlightDetails}
      airportMarkers={airportMarkers}
      onSelectFlight={onSelectFlight}
      onInitialZoomEnd={handleMapReady}
      selectionMode={selectionMode}
      flightLabels={flightLabels}
      flightAvatars={flightAvatars}
      staticFriendMarkers={staticFriendMarkers}
    />
  );
}
