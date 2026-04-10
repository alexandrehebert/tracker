import { geoNaturalEarth1 } from 'd3-geo';
import type {
  AirportDetails,
  FlightMapPoint,
  FlightSourceDetail,
  TrackerApiResponse,
  TrackedFlight,
  TrackedFlightRoute,
} from '~/components/tracker/flight/types';
import {
  lookupAirlabsFlightsWithReport,
  hasAirlabsCredentials,
  type AirlabsFlightEnrichment,
} from './providers/airlabs';
import {
  lookupAviationstackFlightsWithReport,
  hasAviationstackCredentials,
  type AviationstackFlightEnrichment,
} from './providers/aviationstack';
import {
  lookupFlightAwareFlightsWithReport,
  hasFlightAwareCredentials,
  type FlightAwareFlightEnrichment,
} from './providers/flightaware';
import { getProviderDisabledReasonAsync } from './providers';
import {
  clearStoredOpenSkyAccessToken,
  ensureOpenSkyAccessToken,
  fetchOpenSky,
  getOpenSkyErrorDiagnostics,
  getOpenSkyTokenStatus,
  getTrackForAircraft,
  getRecentRoute,
  guessDepartureAirportFromOriginPoint,
  hasOpenSkyConfiguration,
  refreshOpenSkyAccessToken,
  setStoredOpenSkyAccessToken,
  type OpenSkyTokenStatus,
  type OpenSkyTrackHistory,
} from './providers/opensky';

export {
  clearStoredOpenSkyAccessToken,
  ensureOpenSkyAccessToken,
  getOpenSkyTokenStatus,
  refreshOpenSkyAccessToken,
  setStoredOpenSkyAccessToken,
};
export type { OpenSkyTokenStatus };
import { lookupAirportDetails } from './airports';
import {
  readFlightSearchCache,
  writeFlightSearchCache,
} from './flightCache';

const TRACKER_MAP_VIEWBOX = { width: 1000, height: 560 };
const RECENT_FLIGHTS_LOOKBACK_SECONDS = 6 * 60 * 60;
const RECENT_FLIGHTS_CACHE_TTL_MS = 60_000;
const ROUTE_TIME_RECONCILIATION_GRACE_SECONDS = 15 * 60;

type OpenSkyStatesResponse = {
  time?: number;
  states?: unknown[][];
};

type OpenSkyTrackResponse = {
  path?: unknown[][];
};

type OpenSkyRouteResponse = Array<{
  estDepartureAirport?: string | null;
  estArrivalAirport?: string | null;
  firstSeen?: number | null;
  lastSeen?: number | null;
}>;

type OpenSkyRecentFlight = {
  icao24?: string | null;
  callsign?: string | null;
  estDepartureAirport?: string | null;
  estArrivalAirport?: string | null;
  firstSeen?: number | null;
  lastSeen?: number | null;
};

type ParsedState = {
  icao24: string;
  callsign: string;
  originCountry: string;
  timePosition: number | null;
  lastContact: number | null;
  longitude: number | null;
  latitude: number | null;
  baroAltitude: number | null;
  onGround: boolean;
  velocity: number | null;
  trueTrack: number | null;
  verticalRate: number | null;
  geoAltitude: number | null;
  squawk: string | null;
  category: number | null;
};

type SearchFlightsOptions = {
  forceRefresh?: boolean;
  /** When true, return only cached data (including stale entries) without calling any provider. */
  cacheOnly?: boolean;
  /** Reuse a recent cached FlightAware live match instead of re-calling AeroAPI. Defaults to true unless explicitly disabled. */
  preferCachedFlightAware?: boolean;
  /** Force a fresh FlightAware lookup even when the provider already has a cached match. */
  forceFlightAwareRefresh?: boolean;
};

type DemoFlightIdentifier = 'TEST1' | 'TEST2' | 'TEST3' | 'TEST4' | 'TEST5' | 'TEST6' | 'TEST7' | 'TEST8' | 'TEST9' | 'TEST10';

function isDemoFlightIdentifier(value: string): value is DemoFlightIdentifier {
  return value === 'TEST1'
    || value === 'TEST2'
    || value === 'TEST3'
    || value === 'TEST4'
    || value === 'TEST5'
    || value === 'TEST6'
    || value === 'TEST7'
    || value === 'TEST8'
    || value === 'TEST9'
    || value === 'TEST10';
}

function resolveDemoFlightIdentifier(value: string): DemoFlightIdentifier | null {
  if (isDemoFlightIdentifier(value)) {
    return value;
  }

  const normalizedAlias = value.match(/^DEMO[-_]?(TEST(?:[1-9]|10))$/)?.[1] ?? null;
  return normalizedAlias as DemoFlightIdentifier | null;
}

function createDemoFlightPoint(params: {
  time: number;
  latitude: number;
  longitude: number;
  altitude: number;
  heading: number;
  onGround: boolean;
}): FlightMapPoint {
  return projectPoint(params) ?? {
    time: params.time,
    latitude: params.latitude,
    longitude: params.longitude,
    x: 0,
    y: 0,
    altitude: params.altitude,
    heading: params.heading,
    onGround: params.onGround,
  };
}

function createDemoTrackedFlight(identifier: DemoFlightIdentifier, nowSeconds = Math.floor(Date.now() / 1000)): TrackedFlight {
  switch (identifier) {
    case 'TEST1': {
      const track = [
        createDemoFlightPoint({
          time: nowSeconds - 240,
          latitude: 49.0088,
          longitude: 2.5486,
          altitude: 0,
          heading: 90,
          onGround: true,
        }),
        createDemoFlightPoint({
          time: nowSeconds - 150,
          latitude: 49.0097,
          longitude: 2.5535,
          altitude: 0,
          heading: 92,
          onGround: true,
        }),
        createDemoFlightPoint({
          time: nowSeconds - 45,
          latitude: 49.0108,
          longitude: 2.5584,
          altitude: 0,
          heading: 95,
          onGround: true,
        }),
      ];
      const current = track.at(-1) ?? null;

      return {
        icao24: 'demo-test1',
        callsign: 'AFR006',
        originCountry: 'France',
        matchedBy: [identifier],
        lastContact: current?.time ?? nowSeconds - 45,
        current,
        originPoint: track[0] ?? current,
        track,
        rawTrack: track,
        onGround: true,
        velocity: 12,
        heading: current?.heading ?? 95,
        verticalRate: 0,
        geoAltitude: 0,
        baroAltitude: 0,
        squawk: '1001',
        category: 0,
        route: {
          departureAirport: 'CDG',
          arrivalAirport: 'JFK',
          firstSeen: null,
          lastSeen: null,
        },
        flightNumber: 'AF 6',
        airline: {
          name: 'Air France',
          iata: 'AF',
          icao: 'AFR',
        },
        aircraft: {
          registration: 'F-GSQX',
          iata: 'B77W',
          icao: 'B77W',
          icao24: 'demo-test1',
          model: 'Boeing 777-300ER',
        },
        dataSource: 'opensky',
        sourceDetails: [
          createSourceDetail(
            'opensky',
            'used',
            true,
            'Built-in demo result for TEST1: Air France AFR006 is still on the ground at Paris Charles de Gaulle awaiting departure to New York JFK.',
            {
              demoIdentifier: identifier,
              scenario: 'pre-departure',
              route: {
                departureAirport: 'CDG',
                arrivalAirport: 'JFK',
              },
            },
          ),
        ],
      };
    }
    case 'TEST2': {
      const track = [
        createDemoFlightPoint({
          time: nowSeconds - 4_200,
          latitude: 52.62,
          longitude: -8.41,
          altitude: 7_200,
          heading: 287,
          onGround: false,
        }),
        createDemoFlightPoint({
          time: nowSeconds - 2_700,
          latitude: 53.46,
          longitude: -16.8,
          altitude: 10_100,
          heading: 289,
          onGround: false,
        }),
        createDemoFlightPoint({
          time: nowSeconds - 1_200,
          latitude: 53.88,
          longitude: -24.7,
          altitude: 10_700,
          heading: 290,
          onGround: false,
        }),
        createDemoFlightPoint({
          time: nowSeconds - 75,
          latitude: 53.94,
          longitude: -31.25,
          altitude: 10_650,
          heading: 291,
          onGround: false,
        }),
      ];
      const current = track.at(-1) ?? null;

      return {
        icao24: 'demo-test2',
        callsign: 'BAW117',
        originCountry: 'United Kingdom',
        matchedBy: [identifier],
        lastContact: current?.time ?? nowSeconds - 75,
        current,
        originPoint: track[0] ?? current,
        track,
        rawTrack: track,
        onGround: false,
        velocity: 247,
        heading: current?.heading ?? 291,
        verticalRate: 0,
        geoAltitude: current?.altitude ?? 10_650,
        baroAltitude: (current?.altitude ?? 10_650) + 40,
        squawk: '2201',
        category: 1,
        route: {
          departureAirport: 'LHR',
          arrivalAirport: 'JFK',
          firstSeen: nowSeconds - 5_400,
          lastSeen: null,
        },
        flightNumber: 'BA 117',
        airline: {
          name: 'British Airways',
          iata: 'BA',
          icao: 'BAW',
        },
        aircraft: {
          registration: 'G-STBC',
          iata: 'B77W',
          icao: 'B77W',
          icao24: 'demo-test2',
          model: 'Boeing 777-300ER',
        },
        dataSource: 'opensky',
        sourceDetails: [
          createSourceDetail(
            'opensky',
            'used',
            true,
            'Built-in demo result for TEST2: British Airways BAW117 is currently airborne on its transatlantic leg from London Heathrow to New York JFK.',
            {
              demoIdentifier: identifier,
              scenario: 'airborne',
              route: {
                departureAirport: 'LHR',
                arrivalAirport: 'JFK',
              },
            },
          ),
        ],
      };
    }
    case 'TEST3': {
      const track = [
        createDemoFlightPoint({
          time: nowSeconds - 4_800,
          latitude: 33.6407,
          longitude: -84.4277,
          altitude: 0,
          heading: 45,
          onGround: true,
        }),
        createDemoFlightPoint({
          time: nowSeconds - 4_200,
          latitude: 33.92,
          longitude: -83.56,
          altitude: 2_100,
          heading: 48,
          onGround: false,
        }),
        createDemoFlightPoint({
          time: nowSeconds - 3_000,
          latitude: 35.84,
          longitude: -80.52,
          altitude: 9_600,
          heading: 51,
          onGround: false,
        }),
        createDemoFlightPoint({
          time: nowSeconds - 1_800,
          latitude: 38.22,
          longitude: -77.34,
          altitude: 8_400,
          heading: 56,
          onGround: false,
        }),
        createDemoFlightPoint({
          time: nowSeconds - 600,
          latitude: 40.31,
          longitude: -74.62,
          altitude: 2_300,
          heading: 67,
          onGround: false,
        }),
        createDemoFlightPoint({
          time: nowSeconds - 180,
          latitude: 40.598,
          longitude: -73.91,
          altitude: 350,
          heading: 80,
          onGround: false,
        }),
        createDemoFlightPoint({
          time: nowSeconds - 90,
          latitude: 40.6413,
          longitude: -73.7781,
          altitude: 0,
          heading: 89,
          onGround: true,
        }),
      ];
      const current = track.at(-1) ?? null;

      return {
        icao24: 'demo-test3',
        callsign: 'DAL220',
        originCountry: 'United States',
        matchedBy: [identifier],
        lastContact: current?.time ?? nowSeconds - 90,
        current,
        originPoint: track[0] ?? current,
        track,
        rawTrack: track,
        onGround: true,
        velocity: 6,
        heading: current?.heading ?? 89,
        verticalRate: 0,
        geoAltitude: 0,
        baroAltitude: 0,
        squawk: '1453',
        category: 1,
        route: {
          departureAirport: 'ATL',
          arrivalAirport: 'JFK',
          firstSeen: nowSeconds - 4_800,
          lastSeen: nowSeconds - 120,
        },
        flightNumber: 'DL 220',
        airline: {
          name: 'Delta Air Lines',
          iata: 'DL',
          icao: 'DAL',
        },
        aircraft: {
          registration: 'N840DN',
          iata: 'B739',
          icao: 'B739',
          icao24: 'demo-test3',
          model: 'Boeing 737-900ER',
        },
        dataSource: 'opensky',
        sourceDetails: [
          createSourceDetail(
            'opensky',
            'used',
            true,
            'Built-in demo result for TEST3: Delta DAL220 has completed its flight from Atlanta to New York JFK and is now grounded at the destination.',
            {
              demoIdentifier: identifier,
              scenario: 'landed',
              route: {
                departureAirport: 'ATL',
                arrivalAirport: 'JFK',
              },
            },
          ),
        ],
      };
    }
    case 'TEST4': {
      const track = [
        createDemoFlightPoint({
          time: nowSeconds - 5_400,
          latitude: 40.4722,
          longitude: -3.5608,
          altitude: 0,
          heading: 86,
          onGround: true,
        }),
        createDemoFlightPoint({
          time: nowSeconds - 4_900,
          latitude: 40.83,
          longitude: -4.22,
          altitude: 2_300,
          heading: 88,
          onGround: false,
        }),
        createDemoFlightPoint({
          time: nowSeconds - 3_600,
          latitude: 42.75,
          longitude: -11.8,
          altitude: 9_800,
          heading: 291,
          onGround: false,
        }),
        createDemoFlightPoint({
          time: nowSeconds - 1_800,
          latitude: 43.92,
          longitude: -24.4,
          altitude: 10_700,
          heading: 293,
          onGround: false,
        }),
        createDemoFlightPoint({
          time: nowSeconds - 90,
          latitude: 44.31,
          longitude: -35.9,
          altitude: 10_650,
          heading: 295,
          onGround: false,
        }),
      ];
      const current = track.at(-1) ?? null;

      return {
        icao24: 'demo-test4',
        callsign: 'IBE6253',
        originCountry: 'Spain',
        matchedBy: [identifier],
        lastContact: current?.time ?? nowSeconds - 90,
        current,
        originPoint: track[0] ?? current,
        track,
        rawTrack: track,
        onGround: false,
        velocity: 241,
        heading: current?.heading ?? 295,
        verticalRate: 0,
        geoAltitude: current?.altitude ?? 10_650,
        baroAltitude: (current?.altitude ?? 10_650) + 35,
        squawk: '5124',
        category: 1,
        route: {
          departureAirport: 'MAD',
          arrivalAirport: 'JFK',
          firstSeen: nowSeconds - 5_400,
          lastSeen: null,
        },
        flightNumber: 'IB 6253',
        airline: {
          name: 'Iberia',
          iata: 'IB',
          icao: 'IBE',
        },
        aircraft: {
          registration: 'EC-NBX',
          iata: 'A333',
          icao: 'A333',
          icao24: 'demo-test4',
          model: 'Airbus A330-300',
        },
        dataSource: 'opensky',
        sourceDetails: [
          createSourceDetail(
            'opensky',
            'used',
            true,
            'Built-in demo result for TEST4: Iberia IBE6253 is currently flying the long-haul connection from Madrid to New York JFK.',
            {
              demoIdentifier: identifier,
              scenario: 'connection-airborne',
              route: {
                departureAirport: 'MAD',
                arrivalAirport: 'JFK',
              },
            },
          ),
        ],
      };
    }
    case 'TEST5': {
      const track = [
        createDemoFlightPoint({
          time: nowSeconds - 7_200,
          latitude: 41.2971,
          longitude: 2.0785,
          altitude: 0,
          heading: 36,
          onGround: true,
        }),
        createDemoFlightPoint({
          time: nowSeconds - 6_900,
          latitude: 41.62,
          longitude: 2.24,
          altitude: 1_900,
          heading: 38,
          onGround: false,
        }),
        createDemoFlightPoint({
          time: nowSeconds - 4_800,
          latitude: 44.12,
          longitude: 2.64,
          altitude: 9_700,
          heading: 24,
          onGround: false,
        }),
        createDemoFlightPoint({
          time: nowSeconds - 2_400,
          latitude: 49.48,
          longitude: 3.22,
          altitude: 8_400,
          heading: 18,
          onGround: false,
        }),
        createDemoFlightPoint({
          time: nowSeconds - 600,
          latitude: 52.12,
          longitude: 4.55,
          altitude: 650,
          heading: 15,
          onGround: false,
        }),
        createDemoFlightPoint({
          time: nowSeconds - 120,
          latitude: 52.3105,
          longitude: 4.7683,
          altitude: 0,
          heading: 12,
          onGround: true,
        }),
      ];
      const current = track.at(-1) ?? null;

      return {
        icao24: 'demo-test5',
        callsign: 'KLM1698',
        originCountry: 'Netherlands',
        matchedBy: [identifier],
        lastContact: current?.time ?? nowSeconds - 120,
        current,
        originPoint: track[0] ?? current,
        track,
        rawTrack: track,
        onGround: true,
        velocity: 4,
        heading: current?.heading ?? 12,
        verticalRate: 0,
        geoAltitude: 0,
        baroAltitude: 0,
        squawk: '2731',
        category: 1,
        route: {
          departureAirport: 'BCN',
          arrivalAirport: 'AMS',
          firstSeen: nowSeconds - 7_200,
          lastSeen: nowSeconds - 120,
        },
        flightNumber: 'KL 1698',
        airline: {
          name: 'KLM Royal Dutch Airlines',
          iata: 'KL',
          icao: 'KLM',
        },
        aircraft: {
          registration: 'PH-BXO',
          iata: 'B738',
          icao: 'B738',
          icao24: 'demo-test5',
          model: 'Boeing 737-800',
        },
        dataSource: 'opensky',
        sourceDetails: [
          createSourceDetail(
            'opensky',
            'used',
            true,
            'Built-in demo result for TEST5: KLM KLM1698 has landed in Amsterdam and is waiting at the connection stop before the final hop to New York.',
            {
              demoIdentifier: identifier,
              scenario: 'layover',
              route: {
                departureAirport: 'BCN',
                arrivalAirport: 'AMS',
              },
            },
          ),
        ],
      };
    }
    case 'TEST6': {
      const track = [
        createDemoFlightPoint({
          time: nowSeconds - 7_200,
          latitude: 32.8998,
          longitude: -97.0403,
          altitude: 0,
          heading: 312,
          onGround: true,
        }),
        createDemoFlightPoint({
          time: nowSeconds - 6_600,
          latitude: 40.84,
          longitude: -121.8,
          altitude: 7_400,
          heading: 314,
          onGround: false,
        }),
        createDemoFlightPoint({
          time: nowSeconds - 5_100,
          latitude: 49.7,
          longitude: -150.4,
          altitude: 10_500,
          heading: 304,
          onGround: false,
        }),
        createDemoFlightPoint({
          time: nowSeconds - 3_000,
          latitude: 53.1,
          longitude: -179.3,
          altitude: 10_950,
          heading: 286,
          onGround: false,
        }),
        createDemoFlightPoint({
          time: nowSeconds - 1_200,
          latitude: 53.3,
          longitude: 179.2,
          altitude: 11_020,
          heading: 276,
          onGround: false,
        }),
        createDemoFlightPoint({
          time: nowSeconds - 90,
          latitude: 49.1,
          longitude: 166.4,
          altitude: 10_980,
          heading: 265,
          onGround: false,
        }),
      ];
      const current = track.at(-1) ?? null;

      return {
        icao24: 'demo-test6',
        callsign: 'KAL031',
        originCountry: 'Republic of Korea',
        matchedBy: [identifier],
        lastContact: current?.time ?? nowSeconds - 90,
        current,
        originPoint: track[0] ?? current,
        track,
        rawTrack: track,
        onGround: false,
        velocity: 252,
        heading: current?.heading ?? 265,
        verticalRate: 0,
        geoAltitude: current?.altitude ?? 10_980,
        baroAltitude: (current?.altitude ?? 10_980) + 35,
        squawk: '4306',
        category: 1,
        route: {
          departureAirport: 'DFW',
          arrivalAirport: 'ICN',
          firstSeen: nowSeconds - 7_200,
          lastSeen: null,
        },
        flightNumber: 'KE 31',
        airline: {
          name: 'Korean Air',
          iata: 'KE',
          icao: 'KAL',
        },
        aircraft: {
          registration: 'HL8342',
          iata: 'B789',
          icao: 'B789',
          icao24: 'demo-test6',
          model: 'Boeing 787-9',
        },
        dataSource: 'opensky',
        sourceDetails: [
          createSourceDetail(
            'opensky',
            'used',
            true,
            'Built-in demo result for TEST6: Korean Air KAL031 is currently crossing the Pacific dateline westbound from Dallas/Fort Worth to Seoul Incheon, making it ideal for map-edge validation.',
            {
              demoIdentifier: identifier,
              scenario: 'dateline-airborne',
              route: {
                departureAirport: 'DFW',
                arrivalAirport: 'ICN',
              },
            },
          ),
        ],
      };
    }
    case 'TEST7': {
      // Pre-departure gate hold at AMS (AMS → JFK, upcoming connection ~70 min away)
      const track = [
        createDemoFlightPoint({
          time: nowSeconds - 1_800,
          latitude: 52.3105,
          longitude: 4.7683,
          altitude: 0,
          heading: 270,
          onGround: true,
        }),
        createDemoFlightPoint({
          time: nowSeconds - 300,
          latitude: 52.3091,
          longitude: 4.7661,
          altitude: 0,
          heading: 271,
          onGround: true,
        }),
      ];
      const current = track.at(-1) ?? null;

      return {
        icao24: 'demo-test7',
        callsign: 'KLM641',
        originCountry: 'Netherlands',
        matchedBy: [identifier],
        lastContact: current?.time ?? nowSeconds - 300,
        current,
        originPoint: track[0] ?? current,
        track,
        rawTrack: track,
        onGround: true,
        velocity: 0,
        heading: current?.heading ?? 271,
        verticalRate: 0,
        geoAltitude: 0,
        baroAltitude: 0,
        squawk: '2732',
        category: 1,
        route: {
          departureAirport: 'AMS',
          arrivalAirport: 'JFK',
          firstSeen: null,
          lastSeen: null,
        },
        flightNumber: 'KL 641',
        airline: {
          name: 'KLM Royal Dutch Airlines',
          iata: 'KL',
          icao: 'KLM',
        },
        aircraft: {
          registration: 'PH-BVD',
          iata: 'B772',
          icao: 'B772',
          icao24: 'demo-test7',
          model: 'Boeing 777-200',
        },
        dataSource: 'opensky',
        sourceDetails: [
          createSourceDetail(
            'opensky',
            'used',
            true,
            'Built-in demo result for TEST7: KLM KLM641 is at the gate at Amsterdam Schiphol, pre-departure for the transatlantic leg to New York JFK.',
            {
              demoIdentifier: identifier,
              scenario: 'pre-departure-gate',
              route: {
                departureAirport: 'AMS',
                arrivalAirport: 'JFK',
              },
            },
          ),
        ],
      };
    }
    case 'TEST8': {
      // Completed feeder hop, on ground at MAD (LIS → MAD, arrived ~5 hours ago)
      const track = [
        createDemoFlightPoint({
          time: nowSeconds - 18_000,
          latitude: 38.7813,
          longitude: -9.1359,
          altitude: 0,
          heading: 55,
          onGround: true,
        }),
        createDemoFlightPoint({
          time: nowSeconds - 16_800,
          latitude: 38.94,
          longitude: -8.76,
          altitude: 2_600,
          heading: 52,
          onGround: false,
        }),
        createDemoFlightPoint({
          time: nowSeconds - 14_400,
          latitude: 39.82,
          longitude: -6.44,
          altitude: 9_800,
          heading: 50,
          onGround: false,
        }),
        createDemoFlightPoint({
          time: nowSeconds - 12_000,
          latitude: 40.52,
          longitude: -4.11,
          altitude: 5_200,
          heading: 48,
          onGround: false,
        }),
        createDemoFlightPoint({
          time: nowSeconds - 10_800,
          latitude: 40.4722,
          longitude: -3.5608,
          altitude: 0,
          heading: 45,
          onGround: true,
        }),
      ];
      const current = track.at(-1) ?? null;

      return {
        icao24: 'demo-test8',
        callsign: 'VLG1153',
        originCountry: 'Spain',
        matchedBy: [identifier],
        lastContact: current?.time ?? nowSeconds - 10_800,
        current,
        originPoint: track[0] ?? current,
        track,
        rawTrack: track,
        onGround: true,
        velocity: 5,
        heading: current?.heading ?? 45,
        verticalRate: 0,
        geoAltitude: 0,
        baroAltitude: 0,
        squawk: '3211',
        category: 1,
        route: {
          departureAirport: 'LIS',
          arrivalAirport: 'MAD',
          firstSeen: nowSeconds - 18_000,
          lastSeen: nowSeconds - 10_800,
        },
        flightNumber: 'VY 1153',
        airline: {
          name: 'Vueling Airlines',
          iata: 'VY',
          icao: 'VLG',
        },
        aircraft: {
          registration: 'EC-MXY',
          iata: 'A320',
          icao: 'A320',
          icao24: 'demo-test8',
          model: 'Airbus A320',
        },
        dataSource: 'opensky',
        sourceDetails: [
          createSourceDetail(
            'opensky',
            'used',
            true,
            'Built-in demo result for TEST8: Vueling VLG1153 has completed the feeder hop from Lisbon to Madrid and is now on the ground at the connection point.',
            {
              demoIdentifier: identifier,
              scenario: 'feeder-landed',
              route: {
                departureAirport: 'LIS',
                arrivalAirport: 'MAD',
              },
            },
          ),
        ],
      };
    }
    case 'TEST9': {
      // Future feeder on ground at FCO (FCO → CDG, departure ~7 hours away)
      const track = [
        createDemoFlightPoint({
          time: nowSeconds - 600,
          latitude: 41.8003,
          longitude: 12.2389,
          altitude: 0,
          heading: 180,
          onGround: true,
        }),
      ];
      const current = track.at(-1) ?? null;

      return {
        icao24: 'demo-test9',
        callsign: 'AFR1840',
        originCountry: 'France',
        matchedBy: [identifier],
        lastContact: current?.time ?? nowSeconds - 600,
        current,
        originPoint: track[0] ?? current,
        track,
        rawTrack: track,
        onGround: true,
        velocity: 0,
        heading: 180,
        verticalRate: 0,
        geoAltitude: 0,
        baroAltitude: 0,
        squawk: null,
        category: 1,
        route: {
          departureAirport: 'FCO',
          arrivalAirport: 'CDG',
          firstSeen: null,
          lastSeen: null,
        },
        flightNumber: 'AF 1840',
        airline: {
          name: 'Air France',
          iata: 'AF',
          icao: 'AFR',
        },
        aircraft: {
          registration: 'F-GZNP',
          iata: 'B788',
          icao: 'B788',
          icao24: 'demo-test9',
          model: 'Boeing 787-8',
        },
        dataSource: 'opensky',
        sourceDetails: [
          createSourceDetail(
            'opensky',
            'used',
            true,
            'Built-in demo result for TEST9: Air France AFR1840 is parked at Rome Fiumicino, awaiting its feeder flight to Paris CDG departing in several hours.',
            {
              demoIdentifier: identifier,
              scenario: 'pre-departure-future',
              route: {
                departureAirport: 'FCO',
                arrivalAirport: 'CDG',
              },
            },
          ),
        ],
      };
    }
    case 'TEST10': {
      // Future long-haul on ground at CDG (CDG → JFK, departure ~10 hours away)
      const track = [
        createDemoFlightPoint({
          time: nowSeconds - 600,
          latitude: 49.0097,
          longitude: 2.5479,
          altitude: 0,
          heading: 90,
          onGround: true,
        }),
      ];
      const current = track.at(-1) ?? null;

      return {
        icao24: 'demo-test10',
        callsign: 'AFR022',
        originCountry: 'France',
        matchedBy: [identifier],
        lastContact: current?.time ?? nowSeconds - 600,
        current,
        originPoint: track[0] ?? current,
        track,
        rawTrack: track,
        onGround: true,
        velocity: 0,
        heading: 90,
        verticalRate: 0,
        geoAltitude: 0,
        baroAltitude: 0,
        squawk: null,
        category: 1,
        route: {
          departureAirport: 'CDG',
          arrivalAirport: 'JFK',
          firstSeen: null,
          lastSeen: null,
        },
        flightNumber: 'AF 22',
        airline: {
          name: 'Air France',
          iata: 'AF',
          icao: 'AFR',
        },
        aircraft: {
          registration: 'F-GSPS',
          iata: 'B77W',
          icao: 'B77W',
          icao24: 'demo-test10',
          model: 'Boeing 777-300ER',
        },
        dataSource: 'opensky',
        sourceDetails: [
          createSourceDetail(
            'opensky',
            'used',
            true,
            'Built-in demo result for TEST10: Air France AFR022 is on stand at Paris Charles de Gaulle, well ahead of its scheduled long-haul departure to New York JFK.',
            {
              demoIdentifier: identifier,
              scenario: 'pre-departure-future',
              route: {
                departureAirport: 'CDG',
                arrivalAirport: 'JFK',
              },
            },
          ),
        ],
      };
    }
  }
}

function createPresetDemoSearchPayload(query: string, requestedIdentifiers: string[]): TrackerApiResponse | null {
  const matchedEntries = requestedIdentifiers.flatMap((identifier) => {
    const normalizedIdentifier = normalizeIdentifier(identifier);
    const demoIdentifier = resolveDemoFlightIdentifier(normalizedIdentifier);
    return demoIdentifier
      ? [{ requestedIdentifier: identifier, demoIdentifier }]
      : [];
  });

  if (matchedEntries.length === 0) {
    return null;
  }

  return {
    query,
    requestedIdentifiers,
    matchedIdentifiers: matchedEntries.map((entry) => entry.requestedIdentifier),
    notFoundIdentifiers: requestedIdentifiers.filter((identifier) => !resolveDemoFlightIdentifier(normalizeIdentifier(identifier))),
    fetchedAt: Date.now(),
    flights: matchedEntries.map((entry) => createDemoTrackedFlight(entry.demoIdentifier)),
  };
}

function buildTrackedFlightMergeKey(flight: TrackedFlight, index: number): string {
  const baseIdentifier = normalizeIdentifier(
    flight.icao24 || flight.callsign || flight.flightNumber || '',
  );
  if (baseIdentifier) {
    return baseIdentifier;
  }

  const matchedByIdentifier = (flight.matchedBy ?? [])
    .map((value) => normalizeIdentifier(value))
    .filter(Boolean)
    .join(',');

  return matchedByIdentifier || `flight-${index}`;
}

function mergeTrackerApiResponses(
  primary: TrackerApiResponse,
  overlay: TrackerApiResponse,
  query: string,
  requestedIdentifiers: string[],
): TrackerApiResponse {
  const matchedIdentifierSet = new Set([
    ...primary.matchedIdentifiers,
    ...overlay.matchedIdentifiers,
  ]);

  const mergedFlights = new Map<string, TrackedFlight>();
  [...primary.flights, ...overlay.flights].forEach((flight, index) => {
    mergedFlights.set(buildTrackedFlightMergeKey(flight, index), flight);
  });

  const flights = Array.from(mergedFlights.values());
  flights.sort((first, second) => first.callsign.localeCompare(second.callsign));

  return {
    query,
    requestedIdentifiers,
    matchedIdentifiers: requestedIdentifiers.filter((identifier) => matchedIdentifierSet.has(identifier)),
    notFoundIdentifiers: requestedIdentifiers.filter((identifier) => !matchedIdentifierSet.has(identifier)),
    fetchedAt: Math.max(primary.fetchedAt, overlay.fetchedAt),
    flights,
  };
}

let recentFlightsCache: { flights: OpenSkyRecentFlight[]; expiresAt: number } | null = null;
const inFlightSearches = new Map<string, Promise<TrackerApiResponse>>();

const projection = geoNaturalEarth1();
projection.fitSize([TRACKER_MAP_VIEWBOX.width, TRACKER_MAP_VIEWBOX.height], { type: 'Sphere' } as never);

function toNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeIdentifier(value: string): string {
  return value.replace(/\s+/g, '').trim().toUpperCase();
}

function parseIdentifierQuery(query: string): string[] {
  return Array.from(
    new Set(
      query
        .split(/[\n,]+/)
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
}

function buildSearchCacheKey(identifiers: string[]): string {
  return identifiers.map((identifier) => normalizeIdentifier(identifier)).filter(Boolean).join(',');
}

function buildFlightDetailsCacheKey(params: {
  icao24: string;
  departureAirport?: string | null;
  arrivalAirport?: string | null;
  referenceTime?: number | null;
  lastSeen?: number | null;
}): string {
  const referenceTime = normalizeUnixSeconds(params.referenceTime) ?? 0;
  const lastSeen = normalizeUnixSeconds(params.lastSeen) ?? 0;

  return [
    normalizeIdentifier(params.icao24),
    normalizeIdentifier(params.departureAirport ?? ''),
    normalizeIdentifier(params.arrivalAirport ?? ''),
    String(referenceTime),
    String(lastSeen),
  ].join(':');
}

function createEmptyRoute(): TrackedFlightRoute {
  return {
    departureAirport: null,
    arrivalAirport: null,
    firstSeen: null,
    lastSeen: null,
  };
}

function normalizeUnixSeconds(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : null;
}

function sanitizeRouteTimes(route: TrackedFlightRoute, referenceTime?: number | null): TrackedFlightRoute {
  const normalizedReferenceTime = normalizeUnixSeconds(referenceTime);
  const isTooFarInFuture = (timestamp: number | null) => normalizedReferenceTime != null
    && timestamp != null
    && timestamp > normalizedReferenceTime + ROUTE_TIME_RECONCILIATION_GRACE_SECONDS;

  let firstSeen = normalizeUnixSeconds(route.firstSeen);
  let lastSeen = normalizeUnixSeconds(route.lastSeen);

  if (isTooFarInFuture(firstSeen)) {
    firstSeen = null;
  }

  if (isTooFarInFuture(lastSeen)) {
    lastSeen = null;
  }

  if (firstSeen != null && lastSeen != null && firstSeen > lastSeen) {
    firstSeen = null;
  }

  return {
    ...route,
    firstSeen,
    lastSeen,
  };
}

function isSyntheticAircraftIdentifier(value: string): boolean {
  const normalizedValue = normalizeIdentifier(value).toLowerCase();

  if (!normalizedValue) {
    return false;
  }

  return normalizedValue.startsWith('as-')
    || normalizedValue.startsWith('fa-')
    || (!/^[0-9a-f]{6}$/.test(normalizedValue) && normalizedValue.includes('-'));
}

function createRouteFromAviationstackMatch(match: AviationstackFlightEnrichment): TrackedFlightRoute {
  return {
    departureAirport: match.route.departureAirport,
    arrivalAirport: match.route.arrivalAirport,
    firstSeen: match.route.firstSeen,
    lastSeen: match.route.lastSeen,
  };
}

function createRouteFromAirlabsMatch(match: AirlabsFlightEnrichment): TrackedFlightRoute {
  return {
    departureAirport: match.route.departureAirport,
    arrivalAirport: match.route.arrivalAirport,
    firstSeen: match.route.firstSeen,
    lastSeen: match.route.lastSeen,
  };
}

function createRouteFromFlightAwareMatch(match: FlightAwareFlightEnrichment): TrackedFlightRoute {
  return {
    departureAirport: match.route.departureAirport,
    arrivalAirport: match.route.arrivalAirport,
    firstSeen: match.route.firstSeen,
    lastSeen: match.route.lastSeen,
  };
}

function mergeMatchedIdentifiers(existing: string[], identifier: string): string[] {
  return Array.from(new Set([...existing, identifier]));
}

function createSourceDetail(
  source: FlightSourceDetail['source'],
  status: FlightSourceDetail['status'],
  usedInResult: boolean,
  reason: string,
  raw: Record<string, unknown> | null = null,
): FlightSourceDetail {
  return {
    source,
    status,
    usedInResult,
    reason,
    raw,
  };
}

function mergeSourceDetails(
  existing: FlightSourceDetail[] | undefined,
  incoming: FlightSourceDetail[] | undefined,
): FlightSourceDetail[] | undefined {
  const nextEntries = [...(existing ?? [])];

  for (const detail of incoming ?? []) {
    const index = nextEntries.findIndex((entry) => entry.source === detail.source);
    if (index < 0) {
      nextEntries.push(detail);
      continue;
    }

    const current = nextEntries[index]!;
    const priority = { used: 4, error: 3, 'no-data': 2, skipped: 1 } as const;
    const shouldUseIncomingStatus = priority[detail.status] >= priority[current.status];

    nextEntries[index] = {
      ...current,
      ...detail,
      status: shouldUseIncomingStatus ? detail.status : current.status,
      usedInResult: current.usedInResult || detail.usedInResult,
      reason: detail.reason || current.reason,
      raw: detail.raw ?? current.raw ?? null,
    };
  }

  return nextEntries.length > 0 ? nextEntries : undefined;
}

function mergeAirportDetails(
  airport: AirportDetails | null,
  fallbackCode: string | null,
  fallbackName: string | null,
): AirportDetails | null {
  if (airport) {
    return !airport.name && fallbackName ? { ...airport, name: fallbackName } : airport;
  }

  if (!fallbackCode && !fallbackName) {
    return null;
  }

  return {
    code: fallbackCode ?? fallbackName ?? 'UNKNOWN',
    iata: fallbackCode && fallbackCode.length === 3 ? fallbackCode : null,
    icao: fallbackCode && fallbackCode.length === 4 ? fallbackCode : null,
    name: fallbackName,
    city: null,
    country: null,
    latitude: null,
    longitude: null,
    timezone: null,
  };
}

function createTrackedFlightFromAviationstack(
  identifier: string,
  match: AviationstackFlightEnrichment,
  sourceDetails?: FlightSourceDetail[],
): TrackedFlight {
  const current = match.current;
  const routeReferenceTime = current?.time ?? Math.floor(Date.now() / 1000);
  const route = sanitizeRouteTimes(createRouteFromAviationstackMatch(match), routeReferenceTime);
  const icao24 = normalizeIdentifier(match.aircraft.icao24 ?? match.identifier).toLowerCase() || `as-${normalizeIdentifier(identifier).toLowerCase()}`;

  return {
    icao24,
    callsign: match.callsign,
    originCountry: 'Unknown',
    matchedBy: [identifier],
    lastContact: current?.time ?? route.lastSeen ?? route.firstSeen,
    current,
    originPoint: current,
    track: current ? [current] : [],
    rawTrack: current ? [current] : [],
    onGround: match.onGround,
    velocity: match.velocity,
    heading: match.heading ?? current?.heading ?? null,
    verticalRate: null,
    geoAltitude: match.geoAltitude ?? current?.altitude ?? null,
    baroAltitude: null,
    squawk: null,
    category: null,
    route,
    flightNumber: match.flightNumber,
    airline: match.airline,
    aircraft: match.aircraft,
    dataSource: 'aviationstack',
    sourceDetails,
  };
}

function createTrackedFlightFromAirlabs(
  identifier: string,
  match: AirlabsFlightEnrichment,
  sourceDetails?: FlightSourceDetail[],
): TrackedFlight {
  const current = match.current;
  const routeReferenceTime = current?.time ?? Math.floor(Date.now() / 1000);
  const route = sanitizeRouteTimes(createRouteFromAirlabsMatch(match), routeReferenceTime);
  const icao24 = normalizeIdentifier(match.aircraft.icao24 ?? match.identifier).toLowerCase() || `al-${normalizeIdentifier(identifier).toLowerCase()}`;

  return {
    icao24,
    callsign: match.callsign,
    originCountry: 'Unknown',
    matchedBy: [identifier],
    lastContact: current?.time ?? route.lastSeen ?? route.firstSeen,
    current,
    originPoint: current,
    track: current ? [current] : [],
    rawTrack: current ? [current] : [],
    onGround: match.onGround,
    velocity: match.velocity,
    heading: match.heading ?? current?.heading ?? null,
    verticalRate: null,
    geoAltitude: match.geoAltitude ?? current?.altitude ?? null,
    baroAltitude: null,
    squawk: null,
    category: null,
    route,
    flightNumber: match.flightNumber,
    airline: match.airline,
    aircraft: match.aircraft,
    dataSource: 'airlabs',
    sourceDetails,
  };
}

function createTrackedFlightFromFlightAware(
  identifier: string,
  match: FlightAwareFlightEnrichment,
  sourceDetails?: FlightSourceDetail[],
): TrackedFlight {
  const current = match.current;
  const routeReferenceTime = current?.time ?? Math.floor(Date.now() / 1000);
  const route = sanitizeRouteTimes(createRouteFromFlightAwareMatch(match), routeReferenceTime);
  const icao24 = normalizeIdentifier(match.aircraft.icao24 ?? match.identifier).toLowerCase() || `fa-${normalizeIdentifier(identifier).toLowerCase()}`;

  return {
    icao24,
    callsign: match.callsign,
    originCountry: 'Unknown',
    matchedBy: [identifier],
    lastContact: current?.time ?? route.lastSeen ?? route.firstSeen,
    current,
    originPoint: current,
    track: current ? [current] : [],
    rawTrack: current ? [current] : [],
    onGround: match.onGround,
    velocity: match.velocity,
    heading: match.heading ?? current?.heading ?? null,
    verticalRate: null,
    geoAltitude: match.geoAltitude ?? current?.altitude ?? null,
    baroAltitude: null,
    squawk: null,
    category: null,
    route,
    flightNumber: match.flightNumber,
    airline: match.airline,
    aircraft: match.aircraft,
    dataSource: 'flightaware',
    sourceDetails,
  };
}

function mergeTrackedFlightWithAviationstack(
  flight: TrackedFlight,
  match: AviationstackFlightEnrichment,
  identifier: string,
): TrackedFlight {
  const hasOpenSkyLiveData = flight.track.length > 0 || Boolean(flight.current);

  return {
    ...flight,
    callsign: flight.callsign || match.callsign,
    matchedBy: mergeMatchedIdentifiers(flight.matchedBy, identifier),
    lastContact: flight.lastContact ?? match.current?.time ?? match.route.lastSeen,
    current: flight.current ?? match.current,
    originPoint: flight.originPoint ?? flight.current ?? match.current,
    track: flight.track.length > 0 ? flight.track : (match.current ? [match.current] : []),
    rawTrack: flight.rawTrack?.length ? flight.rawTrack : (flight.track.length > 0 ? flight.track : (match.current ? [match.current] : [])),
    velocity: flight.velocity ?? match.velocity,
    heading: flight.heading ?? match.heading ?? match.current?.heading ?? null,
    geoAltitude: flight.geoAltitude ?? flight.baroAltitude ?? match.geoAltitude ?? match.current?.altitude ?? null,
    route: sanitizeRouteTimes({
      departureAirport: flight.route.departureAirport ?? match.route.departureAirport,
      arrivalAirport: flight.route.arrivalAirport ?? match.route.arrivalAirport,
      firstSeen: flight.route.firstSeen ?? match.route.firstSeen,
      lastSeen: flight.route.lastSeen ?? match.route.lastSeen,
    }, flight.lastContact),
    flightNumber: flight.flightNumber ?? match.flightNumber,
    airline: flight.airline ?? match.airline,
    aircraft: flight.aircraft ?? match.aircraft,
    dataSource: hasOpenSkyLiveData ? 'hybrid' : 'aviationstack',
    sourceDetails: flight.sourceDetails,
  };
}

function mergeTrackedFlightWithAirlabs(
  flight: TrackedFlight,
  match: AirlabsFlightEnrichment,
  identifier: string,
): TrackedFlight {
  const hasOpenSkyLiveData = flight.track.length > 0 || Boolean(flight.current);

  return {
    ...flight,
    callsign: flight.callsign || match.callsign,
    matchedBy: mergeMatchedIdentifiers(flight.matchedBy, identifier),
    lastContact: flight.lastContact ?? match.current?.time ?? match.route.lastSeen,
    current: flight.current ?? match.current,
    originPoint: flight.originPoint ?? flight.current ?? match.current,
    track: flight.track.length > 0 ? flight.track : (match.current ? [match.current] : []),
    rawTrack: flight.rawTrack?.length ? flight.rawTrack : (flight.track.length > 0 ? flight.track : (match.current ? [match.current] : [])),
    velocity: flight.velocity ?? match.velocity,
    heading: flight.heading ?? match.heading ?? match.current?.heading ?? null,
    geoAltitude: flight.geoAltitude ?? flight.baroAltitude ?? match.geoAltitude ?? match.current?.altitude ?? null,
    route: sanitizeRouteTimes({
      departureAirport: flight.route.departureAirport ?? match.route.departureAirport,
      arrivalAirport: flight.route.arrivalAirport ?? match.route.arrivalAirport,
      firstSeen: flight.route.firstSeen ?? match.route.firstSeen,
      lastSeen: flight.route.lastSeen ?? match.route.lastSeen,
    }, flight.lastContact),
    flightNumber: flight.flightNumber ?? match.flightNumber,
    airline: flight.airline ?? match.airline,
    aircraft: flight.aircraft ?? match.aircraft,
    dataSource: hasOpenSkyLiveData ? 'hybrid' : 'airlabs',
    sourceDetails: flight.sourceDetails,
  };
}

function mergeTrackedFlightWithFlightAware(
  flight: TrackedFlight,
  match: FlightAwareFlightEnrichment,
  identifier: string,
): TrackedFlight {
  const hasOpenSkyLiveData = flight.track.length > 0 || Boolean(flight.current);

  return {
    ...flight,
    callsign: flight.callsign || match.callsign,
    matchedBy: mergeMatchedIdentifiers(flight.matchedBy, identifier),
    lastContact: flight.lastContact ?? match.current?.time ?? match.route.lastSeen,
    current: flight.current ?? match.current,
    originPoint: flight.originPoint ?? flight.current ?? match.current,
    track: flight.track.length > 0 ? flight.track : (match.current ? [match.current] : []),
    rawTrack: flight.rawTrack?.length ? flight.rawTrack : (flight.track.length > 0 ? flight.track : (match.current ? [match.current] : [])),
    velocity: flight.velocity ?? match.velocity,
    heading: flight.heading ?? match.heading ?? match.current?.heading ?? null,
    geoAltitude: flight.geoAltitude ?? flight.baroAltitude ?? match.geoAltitude ?? match.current?.altitude ?? null,
    route: sanitizeRouteTimes({
      departureAirport: flight.route.departureAirport ?? match.route.departureAirport,
      arrivalAirport: flight.route.arrivalAirport ?? match.route.arrivalAirport,
      firstSeen: flight.route.firstSeen ?? match.route.firstSeen,
      lastSeen: flight.route.lastSeen ?? match.route.lastSeen,
    }, flight.lastContact),
    flightNumber: flight.flightNumber ?? match.flightNumber,
    airline: flight.airline ?? match.airline,
    aircraft: flight.aircraft ?? match.aircraft,
    dataSource: hasOpenSkyLiveData ? 'hybrid' : 'flightaware',
    sourceDetails: flight.sourceDetails,
  };
}

async function enrichSearchResultWithFlightAware(
  payload: TrackerApiResponse,
  options: { preferCachedFlightAware?: boolean; forceFlightAwareRefresh?: boolean } = {},
): Promise<TrackerApiResponse> {
  if (payload.requestedIdentifiers.length === 0) {
    return payload;
  }

  try {
    const identifiersToEnrich = payload.requestedIdentifiers;
    const enrichments = await lookupFlightAwareFlightsWithReport(identifiersToEnrich, {
      allowStaleLiveReuse: options.preferCachedFlightAware,
      forceRefresh: options.forceFlightAwareRefresh,
    });
    const matchedIdentifiers = new Set(payload.matchedIdentifiers);
    const flights = [...payload.flights];

    for (const identifier of identifiersToEnrich) {
      const enrichmentResult = enrichments.get(identifier);
      if (!enrichmentResult) {
        continue;
      }

      const { match, report } = enrichmentResult;
      const normalizedIdentifier = normalizeIdentifier(identifier);
      const normalizedAircraftIcao24 = normalizeIdentifier(match?.aircraft.icao24 ?? match?.identifier ?? '').toLowerCase();
      const existingFlightIndex = flights.findIndex((flight) => {
        const normalizedCallsign = normalizeIdentifier(flight.callsign);

        return flight.matchedBy.some((value) => normalizeIdentifier(value) === normalizedIdentifier)
          || normalizedCallsign === normalizedIdentifier
          || normalizeIdentifier(flight.icao24).toLowerCase() === normalizedIdentifier.toLowerCase()
          || (normalizedAircraftIcao24.length > 0 && normalizeIdentifier(flight.icao24).toLowerCase() === normalizedAircraftIcao24);
      });

      if (existingFlightIndex >= 0) {
        const baseFlight = flights[existingFlightIndex]!;
        const mergedFlight = match
          ? mergeTrackedFlightWithFlightAware(baseFlight, match, identifier)
          : baseFlight;

        flights[existingFlightIndex] = {
          ...mergedFlight,
          sourceDetails: mergeSourceDetails(mergedFlight.sourceDetails, [
            {
              ...report,
              usedInResult: Boolean(match) || report.usedInResult,
            },
          ]),
        };
      } else if (match) {
        flights.push(createTrackedFlightFromFlightAware(identifier, match, mergeSourceDetails(undefined, [
          createSourceDetail(
            'opensky',
            'no-data',
            false,
            'OpenSky did not return a live or recent-history match for this identifier, so the tracker fell back to FlightAware AeroAPI.',
            { identifier: normalizedIdentifier },
          ),
          {
            ...report,
            usedInResult: true,
          },
        ])));
      }

      if (match) {
        matchedIdentifiers.add(identifier);
      }
    }

    flights.sort((first, second) => first.callsign.localeCompare(second.callsign));

    return {
      ...payload,
      matchedIdentifiers: Array.from(matchedIdentifiers),
      notFoundIdentifiers: payload.requestedIdentifiers.filter((identifier) => !matchedIdentifiers.has(identifier)),
      flights,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'FlightAware enrichment failed unexpectedly.';

    return {
      ...payload,
      flights: payload.flights.map((flight) => ({
        ...flight,
        sourceDetails: mergeSourceDetails(flight.sourceDetails, [
          createSourceDetail('flightaware', 'error', false, reason, {
            requestedIdentifiers: payload.requestedIdentifiers,
          }),
        ]),
      })),
    };
  }
}

async function enrichSearchResultWithAirlabs(
  payload: TrackerApiResponse,
  options: { forceRefresh?: boolean } = {},
): Promise<TrackerApiResponse> {
  if (payload.requestedIdentifiers.length === 0) {
    return payload;
  }

  try {
    const identifiersToEnrich = payload.requestedIdentifiers;
    const enrichments = await lookupAirlabsFlightsWithReport(identifiersToEnrich, {
      forceRefresh: options.forceRefresh,
    });
    const matchedIdentifiers = new Set(payload.matchedIdentifiers);
    const flights = [...payload.flights];

    for (const identifier of identifiersToEnrich) {
      const enrichmentResult = enrichments.get(identifier);
      if (!enrichmentResult) {
        continue;
      }

      const { match, report } = enrichmentResult;
      const normalizedIdentifier = normalizeIdentifier(identifier);
      const normalizedAircraftIcao24 = normalizeIdentifier(match?.aircraft.icao24 ?? match?.identifier ?? '').toLowerCase();
      const existingFlightIndex = flights.findIndex((flight) => {
        const normalizedCallsign = normalizeIdentifier(flight.callsign);

        return flight.matchedBy.some((value) => normalizeIdentifier(value) === normalizedIdentifier)
          || normalizedCallsign === normalizedIdentifier
          || normalizeIdentifier(flight.icao24).toLowerCase() === normalizedIdentifier.toLowerCase()
          || (normalizedAircraftIcao24.length > 0 && normalizeIdentifier(flight.icao24).toLowerCase() === normalizedAircraftIcao24);
      });

      if (existingFlightIndex >= 0) {
        const baseFlight = flights[existingFlightIndex]!;
        const mergedFlight = match
          ? mergeTrackedFlightWithAirlabs(baseFlight, match, identifier)
          : baseFlight;

        flights[existingFlightIndex] = {
          ...mergedFlight,
          sourceDetails: mergeSourceDetails(mergedFlight.sourceDetails, [
            {
              ...report,
              usedInResult: Boolean(match) || report.usedInResult,
            },
          ]),
        };
      } else if (match) {
        flights.push(createTrackedFlightFromAirlabs(identifier, match, mergeSourceDetails(undefined, [
          createSourceDetail(
            'opensky',
            'no-data',
            false,
            'OpenSky did not return a live or recent-history match for this identifier, so the tracker fell back to AirLabs.',
            { identifier: normalizedIdentifier },
          ),
          {
            ...report,
            usedInResult: true,
          },
        ])));
      }

      if (match) {
        matchedIdentifiers.add(identifier);
      }
    }

    flights.sort((first, second) => first.callsign.localeCompare(second.callsign));

    return {
      ...payload,
      matchedIdentifiers: Array.from(matchedIdentifiers),
      notFoundIdentifiers: payload.requestedIdentifiers.filter((identifier) => !matchedIdentifiers.has(identifier)),
      flights,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'AirLabs enrichment failed unexpectedly.';

    return {
      ...payload,
      flights: payload.flights.map((flight) => ({
        ...flight,
        sourceDetails: mergeSourceDetails(flight.sourceDetails, [
          createSourceDetail('airlabs', 'error', false, reason, {
            requestedIdentifiers: payload.requestedIdentifiers,
          }),
        ]),
      })),
    };
  }
}

async function enrichSearchResultWithAviationstack(payload: TrackerApiResponse): Promise<TrackerApiResponse> {
  if (payload.requestedIdentifiers.length === 0) {
    return payload;
  }

  try {
    const identifiersToEnrich = payload.requestedIdentifiers;
    const enrichments = await lookupAviationstackFlightsWithReport(identifiersToEnrich);
    const matchedIdentifiers = new Set(payload.matchedIdentifiers);
    const flights = [...payload.flights];

    for (const identifier of identifiersToEnrich) {
      const enrichmentResult = enrichments.get(identifier);
      if (!enrichmentResult) {
        continue;
      }

      const { match, report } = enrichmentResult;
      const normalizedIdentifier = normalizeIdentifier(identifier);
      const normalizedAircraftIcao24 = normalizeIdentifier(match?.aircraft.icao24 ?? match?.identifier ?? '').toLowerCase();
      const existingFlightIndex = flights.findIndex((flight) => {
        const normalizedCallsign = normalizeIdentifier(flight.callsign);

        return flight.matchedBy.some((value) => normalizeIdentifier(value) === normalizedIdentifier)
          || normalizedCallsign === normalizedIdentifier
          || normalizeIdentifier(flight.icao24).toLowerCase() === normalizedIdentifier.toLowerCase()
          || (normalizedAircraftIcao24.length > 0 && normalizeIdentifier(flight.icao24).toLowerCase() === normalizedAircraftIcao24);
      });

      if (existingFlightIndex >= 0) {
        const baseFlight = flights[existingFlightIndex]!;
        const mergedFlight = match
          ? mergeTrackedFlightWithAviationstack(baseFlight, match, identifier)
          : baseFlight;

        flights[existingFlightIndex] = {
          ...mergedFlight,
          sourceDetails: mergeSourceDetails(mergedFlight.sourceDetails, [
            {
              ...report,
              usedInResult: Boolean(match) || report.usedInResult,
            },
          ]),
        };
      } else if (match) {
        flights.push(createTrackedFlightFromAviationstack(identifier, match, mergeSourceDetails(undefined, [
          createSourceDetail(
            'opensky',
            'no-data',
            false,
            'OpenSky did not return a live or recent-history match for this identifier, so the tracker fell back to Aviationstack.',
            { identifier: normalizedIdentifier },
          ),
          {
            ...report,
            usedInResult: true,
          },
        ])));
      }

      if (match) {
        matchedIdentifiers.add(identifier);
      }
    }

    flights.sort((first, second) => first.callsign.localeCompare(second.callsign));

    return {
      ...payload,
      matchedIdentifiers: Array.from(matchedIdentifiers),
      notFoundIdentifiers: payload.requestedIdentifiers.filter((identifier) => !matchedIdentifiers.has(identifier)),
      flights,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Aviationstack enrichment failed unexpectedly.';

    return {
      ...payload,
      flights: payload.flights.map((flight) => ({
        ...flight,
        sourceDetails: mergeSourceDetails(flight.sourceDetails, [
          createSourceDetail('aviationstack', 'error', false, reason, {
            requestedIdentifiers: payload.requestedIdentifiers,
          }),
        ]),
      })),
    };
  }
}

async function enrichSearchResultWithExternalSources(
  payload: TrackerApiResponse,
  options: {
    forceRefresh?: boolean;
    preferCachedFlightAware?: boolean;
    forceFlightAwareRefresh?: boolean;
  } = {},
): Promise<TrackerApiResponse> {
  const withFlightAware = await enrichSearchResultWithFlightAware(payload, {
    preferCachedFlightAware: options.preferCachedFlightAware,
    forceFlightAwareRefresh: options.forceFlightAwareRefresh,
  });
  const withAirlabs = await enrichSearchResultWithAirlabs(withFlightAware, options);
  return enrichSearchResultWithAviationstack(withAirlabs);
}

async function searchFlightsFromExternalSourcesOnly(
  query: string,
  requestedIdentifiers: string[],
  options: {
    forceRefresh?: boolean;
    preferCachedFlightAware?: boolean;
    forceFlightAwareRefresh?: boolean;
  } = {},
): Promise<TrackerApiResponse> {
  return enrichSearchResultWithExternalSources({
    query,
    requestedIdentifiers,
    matchedIdentifiers: [],
    notFoundIdentifiers: requestedIdentifiers,
    fetchedAt: Date.now(),
    flights: [],
  }, options);
}

function getAirportLookupCode(airport: AirportDetails | null): string | null {
  return airport?.icao ?? airport?.code ?? null;
}

function payloadHasRawTrackData(payload: TrackerApiResponse): boolean {
  return payload.flights.every((flight) => Array.isArray(flight.rawTrack));
}

function projectPoint(params: {
  latitude: number | null;
  longitude: number | null;
  time: number | null;
  altitude: number | null;
  heading: number | null;
  onGround: boolean;
}): FlightMapPoint | null {
  const { latitude, longitude, time, altitude, heading, onGround } = params;

  if (latitude == null || longitude == null || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  const safeLatitude = latitude;
  const safeLongitude = longitude;
  const coordinates = projection([safeLongitude, safeLatitude]);
  if (!coordinates) {
    return null;
  }

  return {
    time,
    latitude: safeLatitude,
    longitude: safeLongitude,
    x: coordinates[0],
    y: coordinates[1],
    altitude,
    heading,
    onGround,
  };
}


function parseStateVector(row: unknown[]): ParsedState | null {
  const icao24 = typeof row[0] === 'string' ? row[0].trim().toLowerCase() : '';
  if (!icao24) {
    return null;
  }

  return {
    icao24,
    callsign: typeof row[1] === 'string' ? row[1].trim() : '',
    originCountry: typeof row[2] === 'string' ? row[2] : 'Unknown',
    timePosition: toNumber(row[3]),
    lastContact: toNumber(row[4]),
    longitude: toNumber(row[5]),
    latitude: toNumber(row[6]),
    baroAltitude: toNumber(row[7]),
    onGround: Boolean(row[8]),
    velocity: toNumber(row[9]),
    trueTrack: toNumber(row[10]),
    verticalRate: toNumber(row[11]),
    geoAltitude: toNumber(row[13]),
    squawk: typeof row[14] === 'string' ? row[14] : null,
    category: toNumber(row[17]),
  };
}

function matchesFlightIdentifier(params: {
  callsign: string | null | undefined;
  icao24: string | null | undefined;
  identifier: string;
}): boolean {
  const normalized = normalizeIdentifier(params.identifier);
  if (!normalized) {
    return false;
  }

  const normalizedCallsign = normalizeIdentifier(params.callsign ?? '');
  const normalizedIcao24 = normalizeIdentifier(params.icao24 ?? '');

  return normalized === normalizedIcao24 || normalized === normalizedCallsign;
}

function matchesIdentifier(state: ParsedState, identifier: string): boolean {
  return matchesFlightIdentifier({
    callsign: state.callsign,
    icao24: state.icao24,
    identifier,
  });
}

function matchesRecentFlightIdentifier(flight: OpenSkyRecentFlight, identifier: string): boolean {
  return matchesFlightIdentifier({
    callsign: flight.callsign,
    icao24: flight.icao24,
    identifier,
  });
}

function readRecentFlightsSnapshot(): OpenSkyRecentFlight[] | null {
  if (!recentFlightsCache) {
    return null;
  }

  if (Date.now() >= recentFlightsCache.expiresAt) {
    recentFlightsCache = null;
    return null;
  }

  return recentFlightsCache.flights;
}

async function getRecentFlightsSnapshot(): Promise<OpenSkyRecentFlight[]> {
  const cachedFlights = readRecentFlightsSnapshot();
  if (cachedFlights) {
    return cachedFlights;
  }

  const end = Math.floor(Date.now() / 1000);
  const begin = end - RECENT_FLIGHTS_LOOKBACK_SECONDS;
  const response = await fetchOpenSky<OpenSkyRecentFlight[] | null>('/flights/all', {
    begin,
    end,
  });

  const flights = Array.isArray(response) ? response : [];
  recentFlightsCache = {
    flights,
    expiresAt: Date.now() + RECENT_FLIGHTS_CACHE_TTL_MS,
  };

  return flights;
}

async function fetchFreshFlights(query: string, requestedIdentifiers: string[]): Promise<TrackerApiResponse> {
  const fetchedAt = Date.now();
  const stateResponse = await fetchOpenSky<OpenSkyStatesResponse>('/states/all', { extended: 1 });
  const parsedStates = (stateResponse.states ?? [])
    .map((row) => (Array.isArray(row) ? parseStateVector(row) : null))
    .filter((state): state is ParsedState => Boolean(state));

  const matchesByAircraft = new Map<string, {
    state: ParsedState | null;
    recentFlight: OpenSkyRecentFlight | null;
    matchedBy: Set<string>;
  }>();

  for (const identifier of requestedIdentifiers) {
    for (const state of parsedStates) {
      if (!matchesIdentifier(state, identifier)) continue;

      const existing = matchesByAircraft.get(state.icao24);
      if (existing) {
        existing.state = state;
        existing.matchedBy.add(identifier);
      } else {
        matchesByAircraft.set(state.icao24, {
          state,
          recentFlight: null,
          matchedBy: new Set([identifier]),
        });
      }
    }
  }

  const matchedIdentifiers = new Set<string>();
  for (const { matchedBy } of matchesByAircraft.values()) {
    for (const identifier of matchedBy) {
      matchedIdentifiers.add(identifier);
    }
  }

  const unmatchedIdentifiers = requestedIdentifiers.filter((identifier) => !matchedIdentifiers.has(identifier));
  if (unmatchedIdentifiers.length > 0) {
    const recentFlights = await getRecentFlightsSnapshot().catch(() => []);

    for (const identifier of unmatchedIdentifiers) {
      for (const recentFlight of recentFlights) {
        const recentIcao24 = typeof recentFlight.icao24 === 'string' ? recentFlight.icao24.trim().toLowerCase() : '';
        if (!recentIcao24 || !matchesRecentFlightIdentifier(recentFlight, identifier)) {
          continue;
        }

        const existing = matchesByAircraft.get(recentIcao24);
        if (existing) {
          existing.matchedBy.add(identifier);

          const existingLastSeen = existing.recentFlight?.lastSeen ?? 0;
          const nextLastSeen = recentFlight.lastSeen ?? 0;
          if (!existing.recentFlight || nextLastSeen >= existingLastSeen) {
            existing.recentFlight = recentFlight;
          }
        } else {
          matchesByAircraft.set(recentIcao24, {
            state: null,
            recentFlight,
            matchedBy: new Set([identifier]),
          });
        }

        matchedIdentifiers.add(identifier);
      }
    }
  }

  const flights = await Promise.all(
    Array.from(matchesByAircraft.entries()).map(async ([icao24, { state, recentFlight, matchedBy }]) => {
      const referenceTime = state?.lastContact ?? recentFlight?.lastSeen ?? Math.floor(Date.now() / 1000);
      const [trackHistory, routeResult] = await Promise.all([
        getTrackForAircraft(icao24, referenceTime).catch(() => ({ track: [], rawTrack: [] } satisfies OpenSkyTrackHistory)),
        getRecentRoute(icao24, referenceTime).catch(() => createEmptyRoute()),
      ]);

      const track = trackHistory.track;
      const rawTrack = trackHistory.rawTrack;

      const current = state
        ? projectPoint({
            time: state.lastContact,
            latitude: state.latitude,
            longitude: state.longitude,
            altitude: state.geoAltitude ?? state.baroAltitude,
            heading: state.trueTrack,
            onGround: state.onGround,
          })
        : track.at(-1) ?? null;

      const originPoint = track[0] ?? current;
      const isOnGround = state?.onGround ?? current?.onGround ?? false;
      const guessedDepartureAirport = !routeResult.departureAirport && !recentFlight?.estDepartureAirport
        ? await guessDepartureAirportFromOriginPoint(track[0] ?? null)
        : null;

      const route = {
        departureAirport: routeResult.departureAirport
          ?? recentFlight?.estDepartureAirport
          ?? getAirportLookupCode(guessedDepartureAirport),
        arrivalAirport: routeResult.arrivalAirport ?? recentFlight?.estArrivalAirport ?? null,
        firstSeen: routeResult.firstSeen ?? recentFlight?.firstSeen ?? null,
        lastSeen: isOnGround ? (routeResult.lastSeen ?? recentFlight?.lastSeen ?? null) : null,
      };

      const openSkySourceDetail = createSourceDetail(
        'opensky',
        'used',
        true,
        state
          ? 'OpenSky matched this flight from live state vectors and recent route history.'
          : 'OpenSky live state was unavailable, but recent flight history kept the last known route visible.',
        {
          icao24,
          matchedBy: Array.from(matchedBy),
          state: state
            ? {
                callsign: state.callsign,
                lastContact: state.lastContact,
                velocity: state.velocity,
                heading: state.trueTrack,
                geoAltitude: state.geoAltitude,
              }
            : null,
          recentFlight,
          route,
          trackPoints: track.length,
        },
      );

      return {
        icao24,
        callsign: state?.callsign || recentFlight?.callsign?.trim() || icao24.toUpperCase(),
        originCountry: state?.originCountry ?? 'Unknown',
        matchedBy: Array.from(matchedBy),
        lastContact: state?.lastContact ?? route.lastSeen,
        current,
        originPoint,
        track,
        rawTrack,
        onGround: isOnGround,
        velocity: state?.velocity ?? null,
        heading: state?.trueTrack ?? current?.heading ?? null,
        verticalRate: state?.verticalRate ?? null,
        geoAltitude: state?.geoAltitude ?? current?.altitude ?? null,
        baroAltitude: state?.baroAltitude ?? null,
        squawk: state?.squawk ?? null,
        category: state?.category ?? null,
        route,
        sourceDetails: [openSkySourceDetail],
      } satisfies TrackedFlight;
    }),
  );

  flights.sort((first, second) => first.callsign.localeCompare(second.callsign));

  return {
    query,
    requestedIdentifiers,
    matchedIdentifiers: Array.from(matchedIdentifiers),
    notFoundIdentifiers: requestedIdentifiers.filter((identifier) => !matchedIdentifiers.has(identifier)),
    fetchedAt,
    flights,
  };
}

export async function searchFlights(query: string, options: SearchFlightsOptions = {}): Promise<TrackerApiResponse> {
  const requestedIdentifiers = parseIdentifierQuery(query);
  const trimmedQuery = query.trim();

  if (requestedIdentifiers.length === 0) {
    return {
      query: trimmedQuery,
      requestedIdentifiers: [],
      matchedIdentifiers: [],
      notFoundIdentifiers: [],
      fetchedAt: Date.now(),
      flights: [],
    };
  }

  const demoPayload = createPresetDemoSearchPayload(trimmedQuery, requestedIdentifiers);
  if (demoPayload && demoPayload.notFoundIdentifiers.length === 0) {
    return demoPayload;
  }

  const remainingIdentifiers = demoPayload
    ? requestedIdentifiers.filter((identifier) => !demoPayload.matchedIdentifiers.includes(identifier))
    : requestedIdentifiers;

  const mergeWithDemoPayload = (payload: TrackerApiResponse): TrackerApiResponse => demoPayload
    ? mergeTrackerApiResponses(payload, demoPayload, trimmedQuery, requestedIdentifiers)
    : payload;

  if (remainingIdentifiers.length === 0) {
    return mergeWithDemoPayload({
      query: trimmedQuery,
      requestedIdentifiers,
      matchedIdentifiers: [],
      notFoundIdentifiers: requestedIdentifiers,
      fetchedAt: Date.now(),
      flights: [],
    });
  }

  const remainingQuery = remainingIdentifiers.join(',');
  const cacheKey = buildSearchCacheKey(requestedIdentifiers);
  const preferCachedFlightAware = options.preferCachedFlightAware !== false && !options.forceFlightAwareRefresh;

  const inFlightKey = [
    cacheKey,
    options.forceRefresh ? 'force' : 'default',
    options.cacheOnly ? 'cache-only' : 'live',
    preferCachedFlightAware ? 'fa-reuse' : 'fa-normal',
    options.forceFlightAwareRefresh ? 'fa-force' : 'fa-cache',
  ].join(':');
  const cachedResult = options.forceRefresh ? null : await readFlightSearchCache(cacheKey, options.cacheOnly);
  if (cachedResult && payloadHasRawTrackData(cachedResult)) {
    return mergeWithDemoPayload(cachedResult);
  }

  if (options.cacheOnly) {
    return mergeWithDemoPayload({
      query: trimmedQuery,
      requestedIdentifiers,
      matchedIdentifiers: [],
      notFoundIdentifiers: remainingIdentifiers,
      fetchedAt: Date.now(),
      flights: [],
    });
  }

  const existingSearch = inFlightSearches.get(inFlightKey);
  if (existingSearch) {
    return existingSearch;
  }

  const pendingSearch = (async () => {
    const openSkyDisabledReason = await getProviderDisabledReasonAsync('opensky');
    const openSkyAvailable = !openSkyDisabledReason && hasOpenSkyConfiguration();

    if (!openSkyAvailable) {
      const skipReason = openSkyDisabledReason
        ?? 'OpenSky is not configured for this deployment, so the tracker is using the external fallback providers only.';

      if (!hasAviationstackCredentials() && !hasFlightAwareCredentials() && !hasAirlabsCredentials()) {
        const historicalOnlyResult = await writeFlightSearchCache(
          cacheKey,
          mergeWithDemoPayload({
            query: trimmedQuery,
            requestedIdentifiers,
            matchedIdentifiers: [],
            notFoundIdentifiers: requestedIdentifiers,
            fetchedAt: Date.now(),
            flights: [],
          }),
          options.forceRefresh ? 'manual-refresh' : 'search',
        );

        if (historicalOnlyResult.flights.length > 0 || historicalOnlyResult.matchedIdentifiers.length > 0) {
          return mergeWithDemoPayload(historicalOnlyResult);
        }

        throw new Error(skipReason);
      }

      const fallbackResult = await searchFlightsFromExternalSourcesOnly(remainingQuery, remainingIdentifiers, {
        forceRefresh: options.forceRefresh,
        preferCachedFlightAware,
        forceFlightAwareRefresh: options.forceFlightAwareRefresh,
      });
      const fallbackWithDiagnostics = mergeWithDemoPayload({
        ...fallbackResult,
        query: trimmedQuery,
        requestedIdentifiers,
        flights: fallbackResult.flights.map((flight) => ({
          ...flight,
          sourceDetails: mergeSourceDetails(flight.sourceDetails, [
            createSourceDetail('opensky', 'skipped', false, skipReason, {
              query: trimmedQuery,
              requestedIdentifiers,
              fallback: 'external-only',
            }),
          ]),
        })),
      } satisfies TrackerApiResponse);

      const cachedFallbackResult = await writeFlightSearchCache(
        cacheKey,
        fallbackWithDiagnostics,
        options.forceRefresh ? 'manual-refresh' : 'search',
      );

      if (cachedFallbackResult.flights.length === 0 && cachedFallbackResult.matchedIdentifiers.length === 0) {
        throw new Error(skipReason);
      }

      return mergeWithDemoPayload(cachedFallbackResult);
    }

    try {
      const freshResult = await fetchFreshFlights(remainingQuery, remainingIdentifiers);
      const enrichedResult = await enrichSearchResultWithExternalSources(freshResult, {
        forceRefresh: options.forceRefresh,
        preferCachedFlightAware,
        forceFlightAwareRefresh: options.forceFlightAwareRefresh,
      });
      const cachedResult = await writeFlightSearchCache(
        cacheKey,
        mergeWithDemoPayload(enrichedResult),
        options.forceRefresh ? 'manual-refresh' : 'search',
      );
      return mergeWithDemoPayload(cachedResult);
    } catch (error) {
      if (!hasAviationstackCredentials() && !hasFlightAwareCredentials() && !hasAirlabsCredentials()) {
        const historicalOnlyResult = await writeFlightSearchCache(
          cacheKey,
          mergeWithDemoPayload({
            query: trimmedQuery,
            requestedIdentifiers,
            matchedIdentifiers: [],
            notFoundIdentifiers: requestedIdentifiers,
            fetchedAt: Date.now(),
            flights: [],
          }),
          options.forceRefresh ? 'manual-refresh' : 'search',
        );

        if (historicalOnlyResult.flights.length > 0 || historicalOnlyResult.matchedIdentifiers.length > 0) {
          return mergeWithDemoPayload(historicalOnlyResult);
        }

        throw error;
      }

      const fallbackResult = await searchFlightsFromExternalSourcesOnly(remainingQuery, remainingIdentifiers, {
        forceRefresh: options.forceRefresh,
        preferCachedFlightAware,
        forceFlightAwareRefresh: options.forceFlightAwareRefresh,
      });
      const openSkyErrorReason = error instanceof Error ? error.message : 'OpenSky search failed unexpectedly.';
      const openSkyDiagnostics = getOpenSkyErrorDiagnostics(error);

      console.error('[opensky] search failed, using external fallback', {
        query: trimmedQuery,
        requestedIdentifiers,
        reason: openSkyErrorReason,
        diagnostics: openSkyDiagnostics,
      });

      const fallbackWithDiagnostics = mergeWithDemoPayload({
        ...fallbackResult,
        query: trimmedQuery,
        requestedIdentifiers,
        flights: fallbackResult.flights.map((flight) => ({
          ...flight,
          sourceDetails: mergeSourceDetails(flight.sourceDetails, [
            createSourceDetail('opensky', 'error', false, openSkyErrorReason, {
              query: trimmedQuery,
              requestedIdentifiers,
              ...(openSkyDiagnostics ?? {}),
            }),
          ]),
        })),
      } satisfies TrackerApiResponse);

      const cachedFallbackResult = await writeFlightSearchCache(
        cacheKey,
        fallbackWithDiagnostics,
        options.forceRefresh ? 'manual-refresh' : 'search',
      );

      if (cachedFallbackResult.flights.length === 0 && cachedFallbackResult.matchedIdentifiers.length === 0) {
        throw error;
      }

      return mergeWithDemoPayload(cachedFallbackResult);
    }
  })().finally(() => {
    inFlightSearches.delete(inFlightKey);
  });

  inFlightSearches.set(inFlightKey, pendingSearch);
  return pendingSearch;
}
