import type { AirportDetails } from '~/components/tracker/flight/types'
import { readAirportDirectoryCache, writeAirportDirectoryCache } from './flightCache'

const AIRPORT_DIRECTORY_URL = 'https://raw.githubusercontent.com/mwgg/Airports/master/airports.json'
const AIRPORT_DIRECTORY_CACHE_TTL_MS = 24 * 60 * 60 * 1000
const AIRPORT_DIRECTORY_CACHE_KEY = 'airport-directory:v1'

type AirportDirectoryRecord = {
  iata?: string | null;
  icao?: string | null;
  name?: string | null;
  city?: string | null;
  country?: string | null;
  lat?: number | string | null;
  lon?: number | string | null;
  tz?: string | null;
}

type AirportDirectoryData = {
  entries: Map<string, AirportDetails>;
  airports: AirportDetails[];
}

let airportDirectoryCache: { data: AirportDirectoryData; expiresAt: number } | null = null
let airportDirectoryPromise: Promise<AirportDirectoryData> | null = null

function normalizeAirportCode(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : ''
}

function normalizeAirportText(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function toNullableNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}

function buildFallbackAirportDetails(code: string): AirportDetails {
  return {
    code,
    iata: code.length === 3 ? code : null,
    icao: code.length === 4 ? code : null,
    name: null,
    city: null,
    country: null,
    latitude: null,
    longitude: null,
    timezone: null,
  }
}

function getAirportIdentity(airport: AirportDetails): string {
  return airport.icao || airport.iata || airport.code
}

function getAirportCompletenessScore(airport: AirportDetails): number {
  return [
    airport.name,
    airport.city,
    airport.country,
    airport.iata,
    airport.icao,
    airport.timezone,
    airport.latitude,
    airport.longitude,
  ].reduce<number>((score, value) => score + (value == null || value === '' ? 0 : 1), 0)
}

function compareAirports(left: AirportDetails, right: AirportDetails): number {
  const leftLabel = left.name || left.city || left.code
  const rightLabel = right.name || right.city || right.code
  const byLabel = leftLabel.localeCompare(rightLabel, 'en', { sensitivity: 'base' })

  if (byLabel !== 0) {
    return byLabel
  }

  return left.code.localeCompare(right.code, 'en', { sensitivity: 'base' })
}

function toRadians(value: number): number {
  return value * (Math.PI / 180)
}

function calculateDistanceKm(
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number,
): number {
  const earthRadiusKm = 6371
  const latitudeDelta = toRadians(latitudeB - latitudeA)
  const longitudeDelta = toRadians(longitudeB - longitudeA)
  const normalizedLatitudeA = toRadians(latitudeA)
  const normalizedLatitudeB = toRadians(latitudeB)

  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(normalizedLatitudeA) * Math.cos(normalizedLatitudeB) * Math.sin(longitudeDelta / 2) ** 2

  return 2 * earthRadiusKm * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
}

export async function guessNearestAirportDetails(params: {
  latitude: number | null | undefined;
  longitude: number | null | undefined;
  maxDistanceKm?: number;
}): Promise<AirportDetails | null> {
  const latitude = typeof params.latitude === 'number' && Number.isFinite(params.latitude) ? params.latitude : null
  const longitude = typeof params.longitude === 'number' && Number.isFinite(params.longitude) ? params.longitude : null

  if (latitude == null || longitude == null) {
    return null
  }

  const maxDistanceKm = typeof params.maxDistanceKm === 'number' && Number.isFinite(params.maxDistanceKm)
    ? Math.max(0, params.maxDistanceKm)
    : 120

  try {
    const { airports } = await loadAirportDirectory()
    let nearestAirport: AirportDetails | null = null
    let nearestDistanceKm = Number.POSITIVE_INFINITY

    for (const airport of airports) {
      if (airport.latitude == null || airport.longitude == null) {
        continue
      }

      const distanceKm = calculateDistanceKm(latitude, longitude, airport.latitude, airport.longitude)
      if (distanceKm > maxDistanceKm) {
        continue
      }

      if (
        !nearestAirport
        || distanceKm < nearestDistanceKm
        || (Math.abs(distanceKm - nearestDistanceKm) < 0.001 && compareAirports(airport, nearestAirport) < 0)
      ) {
        nearestAirport = airport
        nearestDistanceKm = distanceKm
      }
    }

    return nearestAirport
  } catch {
    return null
  }
}

function buildAirportDetails(key: string, airport: AirportDirectoryRecord): AirportDetails | null {
  const icao = normalizeAirportCode(airport.icao ?? key)
  const iata = normalizeAirportCode(airport.iata)
  const code = iata || icao

  if (!code) {
    return null
  }

  return {
    code,
    iata: iata || null,
    icao: icao || null,
    name: typeof airport.name === 'string' ? airport.name : null,
    city: typeof airport.city === 'string' ? airport.city : null,
    country: typeof airport.country === 'string' ? airport.country : null,
    latitude: toNullableNumber(airport.lat),
    longitude: toNullableNumber(airport.lon),
    timezone: typeof airport.tz === 'string' ? airport.tz : null,
  }
}

function createAirportDirectoryData(airports: AirportDetails[]): AirportDirectoryData {
  const entries = new Map<string, AirportDetails>()
  const uniqueAirports = new Map<string, AirportDetails>()

  for (const airport of airports) {
    const details: AirportDetails = {
      code: normalizeAirportCode(airport.code),
      iata: normalizeAirportCode(airport.iata) || null,
      icao: normalizeAirportCode(airport.icao) || null,
      name: typeof airport.name === 'string' ? airport.name : null,
      city: typeof airport.city === 'string' ? airport.city : null,
      country: typeof airport.country === 'string' ? airport.country : null,
      latitude: toNullableNumber(airport.latitude),
      longitude: toNullableNumber(airport.longitude),
      timezone: typeof airport.timezone === 'string' ? airport.timezone : null,
    }

    if (!details.code) {
      continue
    }

    if (details.icao) {
      entries.set(details.icao, details)
    }

    if (details.iata) {
      entries.set(details.iata, details)
    }

    const identity = getAirportIdentity(details)
    const existing = uniqueAirports.get(identity)

    if (!existing || getAirportCompletenessScore(details) >= getAirportCompletenessScore(existing)) {
      uniqueAirports.set(identity, details)
    }
  }

  return {
    entries,
    airports: Array.from(uniqueAirports.values()).sort(compareAirports),
  }
}

async function loadAirportDirectory(): Promise<AirportDirectoryData> {
  if (airportDirectoryCache && Date.now() < airportDirectoryCache.expiresAt) {
    return airportDirectoryCache.data
  }

  if (airportDirectoryPromise) {
    return airportDirectoryPromise
  }

  airportDirectoryPromise = (async () => {
    const cachedAirports = await readAirportDirectoryCache(AIRPORT_DIRECTORY_CACHE_KEY)
    if (cachedAirports) {
      const data = createAirportDirectoryData(cachedAirports)
      airportDirectoryCache = {
        data,
        expiresAt: Date.now() + AIRPORT_DIRECTORY_CACHE_TTL_MS,
      }

      return data
    }

    const response = await fetch(AIRPORT_DIRECTORY_URL, {
      cache: 'force-cache',
    })

    if (!response.ok) {
      throw new Error(`Airport directory lookup failed with status ${response.status}`)
    }

    const payload = await response.json() as Record<string, AirportDirectoryRecord>
    const fetchedAirports = Object.entries(payload)
      .map(([key, airport]) => buildAirportDetails(key, airport))
      .filter((airport): airport is AirportDetails => Boolean(airport))

    const data = createAirportDirectoryData(fetchedAirports)

    airportDirectoryCache = {
      data,
      expiresAt: Date.now() + AIRPORT_DIRECTORY_CACHE_TTL_MS,
    }

    await writeAirportDirectoryCache(AIRPORT_DIRECTORY_CACHE_KEY, data.airports)

    return data
  })().finally(() => {
    airportDirectoryPromise = null
  })

  return airportDirectoryPromise
}

export async function listAirportDetails(options: {
  mappedOnly?: boolean;
  search?: string;
  limit?: number;
} = {}): Promise<AirportDetails[]> {
  const { airports } = await loadAirportDirectory()
  const searchTerm = normalizeAirportText(options.search)

  let result = options.mappedOnly
    ? airports.filter((airport) => airport.latitude != null && airport.longitude != null)
    : airports

  if (searchTerm) {
    result = result.filter((airport) => {
      const haystack = [
        airport.code,
        airport.iata,
        airport.icao,
        airport.name,
        airport.city,
        airport.country,
        airport.timezone,
      ]
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .join(' ')
        .toLowerCase()

      return haystack.includes(searchTerm)
    })
  }

  if (options.limit && options.limit > 0) {
    return result.slice(0, options.limit)
  }

  return result
}

export async function lookupAirportDetails(code: string | null | undefined): Promise<AirportDetails | null> {
  const normalizedCode = normalizeAirportCode(code)
  if (!normalizedCode) {
    return null
  }

  try {
    const airportDirectory = await loadAirportDirectory()
    return airportDirectory.entries.get(normalizedCode) ?? buildFallbackAirportDetails(normalizedCode)
  } catch {
    return buildFallbackAirportDetails(normalizedCode)
  }
}
