/**
 * Chantal V2 – deterministic test data generator.
 *
 * Generates realistic position snapshots for the 7 demo friends over a
 * rolling 48-hour window at 5-minute intervals, without any external I/O.
 *
 * Design goals
 * ────────────
 * • Rolling: departure times are always relative to `now`, so the most-recent
 *   snapshot always shows friends "en route".
 * • Realistic: great-circle interpolation, correct altitude profile, per-leg
 *   metadata (airline, aircraft) matching real-world flights.
 * • Imperfect: deterministic "interruptions" (signal loss over oceans) and
 *   "degraded data" windows (no altitude / heading), matching OpenSky reality.
 */

import type { ChantalFriendPosition, ChantalPositionSnapshot } from './chantalV2';

// ---------------------------------------------------------------------------
// Airport coordinates [lat°, lon°]
// ---------------------------------------------------------------------------

const AIRPORTS: Record<string, readonly [number, number]> = {
  LHR: [51.477, -0.461],
  NRT: [35.764, 140.386],
  GRU: [-23.431, -46.469],
  LAX: [33.943, -118.408],
  SYD: [-33.947, 151.179],
  JFK: [40.640, -73.779],
  NBO: [-1.319, 36.927],
  DXB: [25.253, 55.365],
  CPT: [-33.969, 18.602],
  YYZ: [43.677, -79.631],
  YVR: [49.195, -123.184],
};

// ---------------------------------------------------------------------------
// Great-circle math helpers
// ---------------------------------------------------------------------------

function toRad(d: number): number { return d * Math.PI / 180; }
function toDeg(r: number): number { return r * 180 / Math.PI; }

/**
 * Slerp interpolation along a great circle.
 * @param t - fraction [0, 1] along the arc from `from` to `to`
 */
function interpolateGreatCircle(
  from: readonly [number, number],
  to: readonly [number, number],
  t: number,
): [number, number] {
  const cT = Math.min(Math.max(t, 0), 1);
  const lat1 = toRad(from[0]); const lon1 = toRad(from[1]);
  const lat2 = toRad(to[0]);   const lon2 = toRad(to[1]);

  const d = 2 * Math.asin(Math.sqrt(
    Math.sin((lat2 - lat1) / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2,
  ));

  if (d < 0.00001) return [from[0], from[1]];

  const A = Math.sin((1 - cT) * d) / Math.sin(d);
  const B = Math.sin(cT * d) / Math.sin(d);
  const x = A * Math.cos(lat1) * Math.cos(lon1) + B * Math.cos(lat2) * Math.cos(lon2);
  const y = A * Math.cos(lat1) * Math.sin(lon1) + B * Math.cos(lat2) * Math.sin(lon2);
  const z = A * Math.sin(lat1) + B * Math.sin(lat2);

  return [
    toDeg(Math.atan2(z, Math.sqrt(x * x + y * y))),
    toDeg(Math.atan2(y, x)),
  ];
}

function computeInitialBearing(from: readonly [number, number], to: readonly [number, number]): number {
  const lat1 = toRad(from[0]); const lat2 = toRad(to[0]);
  const dLon = toRad(to[1] - from[1]);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return ((toDeg(Math.atan2(y, x)) + 360) % 360);
}

// ---------------------------------------------------------------------------
// Altitude profile
// ---------------------------------------------------------------------------

const CRUISE_ALT_M = 10_700;
const CLIMB_MS   = 22 * 60_000;
const DESCENT_MS = 28 * 60_000;

function altitudeAtFraction(fraction: number, durationMs: number): number {
  const elapsed   = fraction * durationMs;
  const remaining = (1 - fraction) * durationMs;
  if (elapsed < CLIMB_MS)    return CRUISE_ALT_M * (elapsed   / CLIMB_MS);
  if (remaining < DESCENT_MS) return CRUISE_ALT_M * (remaining / DESCENT_MS);
  return CRUISE_ALT_M;
}

// ---------------------------------------------------------------------------
// Deterministic pseudo-random (Mulberry32)
// ---------------------------------------------------------------------------

function deterministicRng(seed: number): number {
  let s = (seed ^ 0x74a5_12b7) >>> 0;
  s = Math.imul(s ^ (s >>> 16), 0x45d9_f3b);
  s = Math.imul(s ^ (s >>> 16), 0x45d9_f3b);
  return ((s ^ (s >>> 16)) >>> 0) / 0xffff_ffff;
}

// ---------------------------------------------------------------------------
// Phase types
// ---------------------------------------------------------------------------

interface PhaseAwaiting {
  type: 'awaiting';
  atAirport: string;
  fromMs: number;
  toMs: number;
}

interface PhaseGround {
  type: 'ground';
  atAirport: string;
  fromMs: number;
  toMs: number;
  flightNumber: string;
  toAirport: string;   // the NEXT airport (used as context for the card)
}

/** Time windows [startMs, endMs] during this leg when the tracker loses signal. */
type BlackoutWindow = readonly [number, number];

interface PhaseAirborne {
  type: 'airborne';
  legId: string;
  flightNumber: string;
  friendlyFlightNumber: string;
  fromAirport: string;
  toAirport: string;
  fromMs: number;
  toMs: number;
  durationMs: number;
  /** Geographic regions where signal tends to be sparse (→ extra random drops). */
  sparsePacific?: boolean;
  /** Hard blackout windows (absolute ms) – no position data at all. */
  blackouts?: BlackoutWindow[];
  /** True for legs with deliberately sparse API data (no aircraft details, short track). */
  sparseApiData?: boolean;
  /** True for legs where last-contact will be slightly stale during parts of the flight. */
  stalePeriods?: boolean;
  airline: {
    name: string;
    iata: string | null;
    icao: string | null;
  };
  aircraft: {
    icao24: string;
    registration: string | null;
    model: string;
    iata: string | null;
    icao: string | null;
  };
}

type DemoPhase = PhaseAwaiting | PhaseGround | PhaseAirborne;

interface DemoFriendDef {
  id: string;
  name: string;
  phases: DemoPhase[];
}

// ---------------------------------------------------------------------------
// Phase schedule builder
// ---------------------------------------------------------------------------

const DEMO_TRIP_ID   = 'demo-v2-global-meetup';
const DEMO_TRIP_NAME = 'Global Meetup – Tokyo';

function h(hours: number): number { return hours * 3_600_000; }

function buildDemoFriends(tripNow: number): DemoFriendDef[] {
  const far = tripNow + h(200); // "future" sentinel

  return [
    // ─────────────────────────────────────────────────────────────
    // 1. Alice (London) – LHR → NRT direct (12 h)
    // ─────────────────────────────────────────────────────────────
    {
      id: 'demo-v2-friend-1',
      name: 'Alice (London)',
      phases: [
        { type: 'awaiting', atAirport: 'LHR', fromMs: 0, toMs: tripNow - h(6) },
        {
          type: 'airborne',
          legId: 'demo-v2-leg-1a',
          flightNumber: 'BA006',
          friendlyFlightNumber: 'BA 6',
          fromAirport: 'LHR', toAirport: 'NRT',
          fromMs: tripNow - h(6), toMs: tripNow + h(6), durationMs: h(12),
          blackouts: [
            [tripNow - h(6) + h(5), tripNow - h(6) + h(7)],   // 5-7h in: over Siberia
          ],
          airline:  { name: 'British Airways',   iata: 'BA',  icao: 'BAW' },
          aircraft: { icao24: 'demo-v2-a1', registration: 'G-ZSKB', model: 'Boeing 787-9', iata: 'B789', icao: 'B789' },
        },
        { type: 'awaiting', atAirport: 'NRT', fromMs: tripNow + h(6), toMs: far },
      ],
    },

    // ─────────────────────────────────────────────────────────────
    // 2. Bruno (São Paulo) – GRU → LAX (10 h) → NRT (10 h)
    // ─────────────────────────────────────────────────────────────
    {
      id: 'demo-v2-friend-2',
      name: 'Bruno (São Paulo)',
      phases: [
        { type: 'awaiting', atAirport: 'GRU', fromMs: 0, toMs: tripNow - h(14) },
        {
          type: 'airborne',
          legId: 'demo-v2-leg-2a',
          flightNumber: 'UA837',
          friendlyFlightNumber: 'UA 837',
          fromAirport: 'GRU', toAirport: 'LAX',
          fromMs: tripNow - h(14), toMs: tripNow - h(4), durationMs: h(10),
          blackouts: [
            [tripNow - h(14) + h(3.5), tripNow - h(14) + h(5)], // 3.5-5h in: south Atlantic
          ],
          stalePeriods: true,
          airline:  { name: 'United Airlines',    iata: 'UA',  icao: 'UAL' },
          aircraft: { icao24: 'demo-v2-b1', registration: 'N87531', model: 'Boeing 787-10', iata: 'B78X', icao: 'B78X' },
        },
        {
          type: 'ground',
          atAirport: 'LAX', toAirport: 'NRT',
          flightNumber: 'NH106',
          fromMs: tripNow - h(4), toMs: tripNow - h(4), // instant connection
        },
        {
          type: 'airborne',
          legId: 'demo-v2-leg-2b',
          flightNumber: 'NH106',
          friendlyFlightNumber: 'NH 106',
          fromAirport: 'LAX', toAirport: 'NRT',
          fromMs: tripNow - h(4), toMs: tripNow + h(6), durationMs: h(10),
          sparsePacific: true,
          blackouts: [
            [tripNow - h(4) + h(4), tripNow - h(4) + h(5.5)], // 4-5.5h in: deep Pacific
          ],
          airline:  { name: 'All Nippon Airways', iata: 'NH',  icao: 'ANA' },
          aircraft: { icao24: 'demo-v2-b2', registration: 'JA893A', model: 'Boeing 787-9', iata: 'B789', icao: 'B789' },
        },
        { type: 'awaiting', atAirport: 'NRT', fromMs: tripNow + h(6), toMs: far },
      ],
    },

    // ─────────────────────────────────────────────────────────────
    // 3. Chloe (Sydney) – SYD → NRT direct (9.5 h) – sparse API data
    // ─────────────────────────────────────────────────────────────
    {
      id: 'demo-v2-friend-3',
      name: 'Chloe (Sydney)',
      phases: [
        { type: 'awaiting', atAirport: 'SYD', fromMs: 0, toMs: tripNow - h(4) },
        {
          type: 'airborne',
          legId: 'demo-v2-leg-3a',
          flightNumber: 'JL771',
          friendlyFlightNumber: 'JL 771',
          fromAirport: 'SYD', toAirport: 'NRT',
          fromMs: tripNow - h(4), toMs: tripNow + h(5.5), durationMs: h(9.5),
          sparseApiData: true,   // no aircraft details returned by API
          blackouts: [
            [tripNow - h(4) + h(2.5), tripNow - h(4) + h(3.5)], // ~Coral Sea
          ],
          airline:  { name: 'Japan Airlines', iata: 'JL', icao: 'JAL' },
          aircraft: { icao24: 'demo-v2-c1', registration: null, model: 'Boeing 787-8', iata: null, icao: null },
        },
        { type: 'awaiting', atAirport: 'NRT', fromMs: tripNow + h(5.5), toMs: far },
      ],
    },

    // ─────────────────────────────────────────────────────────────
    // 4. Diego (New York) – JFK → NRT direct (14 h)
    // ─────────────────────────────────────────────────────────────
    {
      id: 'demo-v2-friend-4',
      name: 'Diego (New York)',
      phases: [
        { type: 'awaiting', atAirport: 'JFK', fromMs: 0, toMs: tripNow - h(8) },
        {
          type: 'airborne',
          legId: 'demo-v2-leg-4a',
          flightNumber: 'JL004',
          friendlyFlightNumber: 'JL 4',
          fromAirport: 'JFK', toAirport: 'NRT',
          fromMs: tripNow - h(8), toMs: tripNow + h(6), durationMs: h(14),
          sparsePacific: true,
          blackouts: [
            // Long polar-route blackout window (~2 h)
            [tripNow - h(8) + h(6), tripNow - h(8) + h(8)],
          ],
          airline:  { name: 'Japan Airlines', iata: 'JL', icao: 'JAL' },
          aircraft: { icao24: 'demo-v2-d1', registration: 'JA743J', model: 'Boeing 777-300ER', iata: 'B77W', icao: 'B77W' },
        },
        { type: 'awaiting', atAirport: 'NRT', fromMs: tripNow + h(6), toMs: far },
      ],
    },

    // ─────────────────────────────────────────────────────────────
    // 5. Emma (Nairobi) – NBO → DXB (5 h) → NRT (9.5 h) – stale data
    // ─────────────────────────────────────────────────────────────
    {
      id: 'demo-v2-friend-5',
      name: 'Emma (Nairobi)',
      phases: [
        { type: 'awaiting', atAirport: 'NBO', fromMs: 0, toMs: tripNow - h(10) },
        {
          type: 'airborne',
          legId: 'demo-v2-leg-5a',
          flightNumber: 'EK722',
          friendlyFlightNumber: 'EK 722',
          fromAirport: 'NBO', toAirport: 'DXB',
          fromMs: tripNow - h(10), toMs: tripNow - h(5), durationMs: h(5),
          stalePeriods: true,
          airline:  { name: 'Emirates', iata: 'EK', icao: 'UAE' },
          aircraft: { icao24: 'demo-v2-e1', registration: 'A6-EOG', model: 'Boeing 777-300ER', iata: 'B77W', icao: 'B77W' },
        },
        {
          type: 'ground',
          atAirport: 'DXB', toAirport: 'NRT',
          flightNumber: 'EK318',
          fromMs: tripNow - h(5), toMs: tripNow - h(5), // instant connection
        },
        {
          type: 'airborne',
          legId: 'demo-v2-leg-5b',
          flightNumber: 'EK318',
          friendlyFlightNumber: 'EK 318',
          fromAirport: 'DXB', toAirport: 'NRT',
          fromMs: tripNow - h(5), toMs: tripNow + h(4.5), durationMs: h(9.5),
          blackouts: [
            [tripNow - h(5) + h(3), tripNow - h(5) + h(4)],  // over Bay of Bengal
          ],
          airline:  { name: 'Emirates', iata: 'EK', icao: 'UAE' },
          aircraft: { icao24: 'demo-v2-e2', registration: 'A6-EPL', model: 'Airbus A380-800', iata: 'A388', icao: 'A388' },
        },
        { type: 'awaiting', atAirport: 'NRT', fromMs: tripNow + h(4.5), toMs: far },
      ],
    },

    // ─────────────────────────────────────────────────────────────
    // 6. Farah (Cape Town) – CPT → DXB (8 h) → NRT (9.5 h)
    // ─────────────────────────────────────────────────────────────
    {
      id: 'demo-v2-friend-6',
      name: 'Farah (Cape Town)',
      phases: [
        { type: 'awaiting', atAirport: 'CPT', fromMs: 0, toMs: tripNow - h(14) },
        {
          type: 'airborne',
          legId: 'demo-v2-leg-6a',
          flightNumber: 'EK764',
          friendlyFlightNumber: 'EK 764',
          fromAirport: 'CPT', toAirport: 'DXB',
          fromMs: tripNow - h(14), toMs: tripNow - h(6), durationMs: h(8),
          blackouts: [
            [tripNow - h(14) + h(2), tripNow - h(14) + h(3)], // over East Africa
          ],
          airline:  { name: 'Emirates', iata: 'EK', icao: 'UAE' },
          aircraft: { icao24: 'demo-v2-f1', registration: 'A6-EGF', model: 'Boeing 777-300ER', iata: 'B77W', icao: 'B77W' },
        },
        {
          type: 'ground',
          atAirport: 'DXB', toAirport: 'NRT',
          flightNumber: 'EK316',
          fromMs: tripNow - h(6), toMs: tripNow - h(2),
        },
        {
          type: 'airborne',
          legId: 'demo-v2-leg-6b',
          flightNumber: 'EK316',
          friendlyFlightNumber: 'EK 316',
          fromAirport: 'DXB', toAirport: 'NRT',
          fromMs: tripNow - h(2), toMs: tripNow + h(7.5), durationMs: h(9.5),
          airline:  { name: 'Emirates', iata: 'EK', icao: 'UAE' },
          aircraft: { icao24: 'demo-v2-f2', registration: 'A6-EUA', model: 'Airbus A380-800', iata: 'A388', icao: 'A388' },
        },
        { type: 'awaiting', atAirport: 'NRT', fromMs: tripNow + h(7.5), toMs: far },
      ],
    },

    // ─────────────────────────────────────────────────────────────
    // 7. Gabriel (Toronto) – YYZ → YVR (5 h) → NRT (10 h) – sparse track
    // ─────────────────────────────────────────────────────────────
    {
      id: 'demo-v2-friend-7',
      name: 'Gabriel (Toronto)',
      phases: [
        { type: 'awaiting', atAirport: 'YYZ', fromMs: 0, toMs: tripNow - h(12) },
        {
          type: 'airborne',
          legId: 'demo-v2-leg-7a',
          flightNumber: 'AC163',
          friendlyFlightNumber: 'AC 163',
          fromAirport: 'YYZ', toAirport: 'YVR',
          fromMs: tripNow - h(12), toMs: tripNow - h(7), durationMs: h(5),
          airline:  { name: 'Air Canada', iata: 'AC', icao: 'ACA' },
          aircraft: { icao24: 'demo-v2-g1', registration: 'C-FVLU', model: 'Airbus A319', iata: 'A319', icao: 'A319' },
        },
        {
          type: 'ground',
          atAirport: 'YVR', toAirport: 'NRT',
          flightNumber: 'AC003',
          fromMs: tripNow - h(7), toMs: tripNow - h(7), // instant connection
        },
        {
          type: 'airborne',
          legId: 'demo-v2-leg-7b',
          flightNumber: 'AC003',
          friendlyFlightNumber: 'AC 3',
          fromAirport: 'YVR', toAirport: 'NRT',
          fromMs: tripNow - h(7), toMs: tripNow + h(3), durationMs: h(10),
          sparsePacific: true,
          sparseApiData: true,  // short track only (sparse Pacific coverage)
          blackouts: [
            [tripNow - h(7) + h(3.5), tripNow - h(7) + h(5)], // deep Pacific
          ],
          airline:  { name: 'Air Canada', iata: 'AC', icao: 'ACA' },
          aircraft: { icao24: 'demo-v2-g2', registration: 'C-FGDT', model: 'Boeing 787-9', iata: 'B789', icao: 'B789' },
        },
        { type: 'awaiting', atAirport: 'NRT', fromMs: tripNow + h(3), toMs: far },
      ],
    },
  ];
}

// ---------------------------------------------------------------------------
// Phase lookup
// ---------------------------------------------------------------------------

function findPhaseAtTime(phases: DemoPhase[], timeMs: number): DemoPhase | null {
  // Walk phases in order; 'awaiting' at either end has open-ended bounds.
  for (const phase of phases) {
    if (timeMs >= phase.fromMs && timeMs < phase.toMs) {
      return phase;
    }
  }
  // Clamp to last phase if past the end.
  const last = phases[phases.length - 1];
  if (last && timeMs >= last.toMs) return last;
  // Clamp to first phase if before the beginning.
  const first = phases[0];
  if (first && timeMs < first.fromMs) return first;
  return null;
}

// ---------------------------------------------------------------------------
// Position computation
// ---------------------------------------------------------------------------

const STALE_CONTACT_CHANCE = 0.08; // probability of stale lastContact
const RANDOM_DROPOUT_CHANCE = 0.05; // probability of random full signal loss
const PACIFIC_EXTRA_DROPOUT = 0.18; // extra dropout when over Pacific

/** Minimum stale offset (seconds) applied during "stale periods". */
const STALE_MIN_S = 480;   // 8 min
/** Additional random range added to the stale offset (seconds). */
const STALE_RANGE_S = 1200; // up to 28 min total
/** Minimum normal last-contact offset (seconds). */
const NORMAL_STALE_MIN_S = 20;
/** Additional random range for normal last-contact (seconds). */
const NORMAL_STALE_RANGE_S = 100;

function isInBlackout(phase: PhaseAirborne, timeMs: number): boolean {
  for (const [start, end] of phase.blackouts ?? []) {
    if (timeMs >= start && timeMs <= end) return true;
  }
  return false;
}

function computeDemoFriendPosition(
  friend: DemoFriendDef,
  friendIndex: number,
  capturedAt: number,
  snapshotIndex: number,
): ChantalFriendPosition {
  const phase = findPhaseAtTime(friend.phases, capturedAt);
  const nowSeconds = Math.floor(capturedAt / 1000);

  const base: Omit<ChantalFriendPosition, 'status' | 'latitude' | 'longitude' | 'altitude' | 'heading' | 'onGround' | 'flightNumber' | 'fromAirport' | 'toAirport' | 'lastContactAt'> = {
    friendId: friend.id,
    friendName: friend.name,
    avatarUrl: null,
  };

  if (!phase || phase.type === 'awaiting') {
    const airport = phase?.atAirport ?? null;
    return { ...base, status: 'awaiting', latitude: null, longitude: null, altitude: null, heading: null, onGround: false, flightNumber: null, fromAirport: airport, toAirport: null, lastContactAt: null };
  }

  if (phase.type === 'ground') {
    const coords = AIRPORTS[phase.atAirport];
    return {
      ...base,
      status: 'on-ground',
      latitude: coords?.[0] ?? null,
      longitude: coords?.[1] ?? null,
      altitude: 0,
      heading: null,
      onGround: true,
      flightNumber: phase.flightNumber,
      fromAirport: phase.atAirport,
      toAirport: phase.toAirport,
      lastContactAt: nowSeconds - 30,
    };
  }

  // --- Airborne ---
  const airborne = phase;

  // Hard blackout window
  if (isInBlackout(airborne, capturedAt)) {
    return { ...base, status: 'airborne', latitude: null, longitude: null, altitude: null, heading: null, onGround: false, flightNumber: airborne.friendlyFlightNumber, fromAirport: airborne.fromAirport, toAirport: airborne.toAirport, lastContactAt: null };
  }

  // Deterministic random signal loss
  const rng1 = deterministicRng(friendIndex * 97 + snapshotIndex * 31);
  const fraction = (capturedAt - airborne.fromMs) / airborne.durationMs;
  const [lat, lon] = interpolateGreatCircle(AIRPORTS[airborne.fromAirport]!, AIRPORTS[airborne.toAirport]!, fraction);

  // Extra dropout over Pacific longitudes
  const isPacific = lon > 140 || lon < -100;
  const dropoutChance = RANDOM_DROPOUT_CHANCE + (isPacific && airborne.sparsePacific ? PACIFIC_EXTRA_DROPOUT : 0);
  if (rng1 < dropoutChance) {
    return { ...base, status: 'airborne', latitude: null, longitude: null, altitude: null, heading: null, onGround: false, flightNumber: airborne.friendlyFlightNumber, fromAirport: airborne.fromAirport, toAirport: airborne.toAirport, lastContactAt: null };
  }

  // Degraded: position present but no altitude / heading
  const rng2 = deterministicRng(friendIndex * 137 + snapshotIndex * 71);
  const isDegraded = rng2 < 0.07;

  // Stale last-contact
  const rng3 = deterministicRng(friendIndex * 211 + snapshotIndex * 53);
  const staleOffsetSeconds = airborne.stalePeriods && rng3 < STALE_CONTACT_CHANCE
    ? STALE_MIN_S + Math.floor(rng3 * STALE_RANGE_S)
    : NORMAL_STALE_MIN_S + Math.floor(rng3 * NORMAL_STALE_RANGE_S);

  // Tiny GPS jitter (±0.015°)
  const jLat = (deterministicRng(friendIndex * 17 + snapshotIndex * 41) - 0.5) * 0.03;
  const jLon = (deterministicRng(friendIndex * 23 + snapshotIndex * 61) - 0.5) * 0.03;

  const altitude  = isDegraded ? null : altitudeAtFraction(fraction, airborne.durationMs);
  const heading   = isDegraded ? null : computeInitialBearing(AIRPORTS[airborne.fromAirport]!, AIRPORTS[airborne.toAirport]!);

  return {
    ...base,
    status: 'airborne',
    latitude:  lat + jLat,
    longitude: lon + jLon,
    altitude,
    heading,
    onGround: false,
    flightNumber: airborne.friendlyFlightNumber,
    fromAirport: airborne.fromAirport,
    toAirport:   airborne.toAirport,
    lastContactAt: nowSeconds - staleOffsetSeconds,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * The reference bucket used for the demo trip anchor.
 * Bucket of 15 min so the demo trip does not rebuild on every API call.
 */
const DEMO_REFERENCE_BUCKET_MS = 15 * 60_000;
/** Rolling history window kept for the demo wayback machine (48 h). */
const DEMO_LOOKBACK_WINDOW_MS = 48 * 3_600_000;
/** Number of 5-min snapshots in the default history window (576). */
export const DEMO_V2_SNAPSHOT_COUNT = DEMO_LOOKBACK_WINDOW_MS / (5 * 60_000);

function getDemoV2TripNow(now: number): number {
  return Math.floor(now / DEMO_REFERENCE_BUCKET_MS) * DEMO_REFERENCE_BUCKET_MS;
}

/** Snap a given timestamp to the nearest 5-min bucket (floor). */
function toSnapshotBucket(ms: number, stepMs: number): number {
  return Math.floor(ms / stepMs) * stepMs;
}

/**
 * Generates a single position snapshot for the demo V2 trip.
 *
 * @param now        - current real time (for anchoring trip departure offsets)
 * @param capturedAt - the time this snapshot represents (may be historical)
 */
export function generateDemoV2Snapshot(now: number, capturedAt: number): ChantalPositionSnapshot {
  const tripNow = getDemoV2TripNow(now);
  const friends = buildDemoFriends(tripNow);
  const stepMs  = 5 * 60_000;
  const snapshotIndex = Math.round((capturedAt - (tripNow - DEMO_LOOKBACK_WINDOW_MS)) / stepMs);

  const positions = friends.map((friend, friendIndex) =>
    computeDemoFriendPosition(friend, friendIndex, capturedAt, snapshotIndex),
  );

  return {
    id: `demo-v2-snapshot:${capturedAt}`,
    capturedAt,
    tripId: DEMO_TRIP_ID,
    tripName: DEMO_TRIP_NAME,
    positions,
  };
}

/**
 * Generates the full rolling series of demo snapshots (newest first).
 *
 * @param now    - current real time
 * @param count  - number of snapshots to generate (default: 576 = 48 h at 5 min)
 * @param stepMs - snapshot interval in ms (default: 5 min)
 */
export function generateDemoV2SnapshotSeries(
  now: number,
  count = DEMO_V2_SNAPSHOT_COUNT,
  stepMs = 5 * 60_000,
): ChantalPositionSnapshot[] {
  const latestBucket = toSnapshotBucket(now, stepMs);
  const snapshots: ChantalPositionSnapshot[] = [];

  for (let i = 0; i < count; i++) {
    const capturedAt = latestBucket - i * stepMs;
    snapshots.push(generateDemoV2Snapshot(now, capturedAt));
  }

  return snapshots; // newest first
}

/**
 * Returns the capturedAt timestamps for the demo snapshot series (newest first).
 */
export function getDemoV2SnapshotTimestamps(
  now: number,
  count = DEMO_V2_SNAPSHOT_COUNT,
  stepMs = 5 * 60_000,
): number[] {
  const latestBucket = toSnapshotBucket(now, stepMs);
  return Array.from({ length: count }, (_, i) => latestBucket - i * stepMs);
}

/**
 * Finds and generates the demo snapshot closest to (and not after) `targetMs`.
 */
export function getDemoV2SnapshotAt(now: number, targetMs: number, stepMs = 5 * 60_000): ChantalPositionSnapshot {
  const capturedAt = toSnapshotBucket(targetMs, stepMs);
  return generateDemoV2Snapshot(now, capturedAt);
}

// ---------------------------------------------------------------------------
// Mock TrackedFlight builder (for searchFlights in test mode)
// ---------------------------------------------------------------------------

/** Returns true if `timeMs` falls within any hard blackout window of `phase`. */
export function isInBlackoutAt(phase: PhaseAirborne, timeMs: number): boolean {
  return isInBlackout(phase, timeMs);
}

export {
  buildDemoFriends,
  findPhaseAtTime,
  AIRPORTS,
  interpolateGreatCircle,
  computeInitialBearing,
  altitudeAtFraction,
  deterministicRng,
};
export type { DemoFriendDef, DemoPhase, PhaseAirborne };
