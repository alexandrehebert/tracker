export interface FlightMapPoint {
  time: number | null;
  latitude: number;
  longitude: number;
  x: number;
  y: number;
  altitude: number | null;
  heading: number | null;
  onGround: boolean;
}

export interface TrackedFlightRoute {
  departureAirport: string | null;
  arrivalAirport: string | null;
  firstSeen: number | null;
  lastSeen: number | null;
}

export interface TrackedFlight {
  icao24: string;
  callsign: string;
  originCountry: string;
  matchedBy: string[];
  lastContact: number | null;
  current: FlightMapPoint | null;
  originPoint: FlightMapPoint | null;
  track: FlightMapPoint[];
  onGround: boolean;
  velocity: number | null;
  heading: number | null;
  verticalRate: number | null;
  geoAltitude: number | null;
  baroAltitude: number | null;
  squawk: string | null;
  category: number | null;
  route: TrackedFlightRoute;
}

export interface AirportDetails {
  code: string;
  iata: string | null;
  icao: string | null;
  name: string | null;
  city: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  timezone?: string | null;
}

export interface AirportMapEntry extends AirportDetails {
  x: number | null;
  y: number | null;
}

export interface AirportDirectoryResponse {
  fetchedAt: number;
  total: number;
  mapped: number;
  airports: AirportMapEntry[];
}

export interface SelectedFlightDetails {
  icao24: string;
  callsign: string;
  fetchedAt: number;
  route: TrackedFlightRoute;
  departureAirport: AirportDetails | null;
  arrivalAirport: AirportDetails | null;
}

export interface TrackerApiResponse {
  query: string;
  requestedIdentifiers: string[];
  matchedIdentifiers: string[];
  notFoundIdentifiers: string[];
  fetchedAt: number;
  flights: TrackedFlight[];
}
