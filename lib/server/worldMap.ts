import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { geoNaturalEarth1, geoPath } from 'd3-geo';
import { City } from 'country-state-city';
import countries, { type Country } from 'world-countries';

const MAP_VIEWBOX = { width: 1000, height: 560 };
const MIN_CLICKABLE_COUNTRY_SIZE = 5;

export interface WorldMapCountry {
  code: string;
  name: string;
  capital: string;
  flag: string;
  path: string;
  centroid: { x: number; y: number };
  capitalPoint: { x: number; y: number };
  focusBounds: { x: number; y: number; width: number; height: number };
  /** [latitude, longitude] from world-countries data */
  latlng: [number, number];
}

export interface WorldMapProjectionConfig {
  scale: number;
  translate: [number, number];
}

export interface WorldMapPayload {
  countries: WorldMapCountry[];
  viewBox: typeof MAP_VIEWBOX;
  projection: WorldMapProjectionConfig;
}

type GeoFeature = GeoJSON.Feature<GeoJSON.Geometry>;
type FeatureProperties = Record<string, unknown>;
type Coordinates = { latitude: number; longitude: number };
type ProjectedMapPoint = { x: number; y: number };

const capitalCoordinatesCache = new Map<string, Coordinates | null>();
const cityLookupCache = new Map<string, Map<string, Coordinates>>();
let mapProjectionPromise: Promise<ReturnType<typeof geoNaturalEarth1>> | null = null;

function getFeatureFocusGeometry(feature: GeoFeature, generator: ReturnType<typeof geoPath>): GeoFeature {
  if (feature.geometry.type !== 'MultiPolygon') {
    return feature;
  }

  const polygons = feature.geometry.coordinates;
  if (!polygons.length) {
    return feature;
  }

  let totalArea = 0;
  let largestArea = -1;
  let largestPolygon: GeoJSON.Position[][] | null = null;
  let largestBounds: [[number, number], [number, number]] | null = null;

  for (const polygon of polygons) {
    const polygonFeature: GeoFeature = {
      type: 'Feature',
      properties: feature.properties,
      geometry: { type: 'Polygon', coordinates: polygon },
    };
    const area = Math.max(0, generator.area(polygonFeature));
    totalArea += area;

    if (area > largestArea) {
      largestArea = area;
      largestPolygon = polygon;
      largestBounds = generator.bounds(polygonFeature);
    }
  }

  if (!largestPolygon || !largestBounds || totalArea <= 0) {
    return feature;
  }

  const fullBounds = generator.bounds(feature);
  const fullWidth = Math.max(0, fullBounds[1][0] - fullBounds[0][0]);
  const fullHeight = Math.max(0, fullBounds[1][1] - fullBounds[0][1]);
  const largestWidth = Math.max(0, largestBounds[1][0] - largestBounds[0][0]);
  const largestHeight = Math.max(0, largestBounds[1][1] - largestBounds[0][1]);
  const fullMaxDimension = Math.max(fullWidth, fullHeight);
  const largestMaxDimension = Math.max(largestWidth, largestHeight);
  const isMuchMoreSpreadThanLargest = largestMaxDimension > 0 && fullMaxDimension / largestMaxDimension > 2.5;

  const leftOffset = Math.max(0, largestBounds[0][0] - fullBounds[0][0]);
  const rightOffset = Math.max(0, fullBounds[1][0] - largestBounds[1][0]);
  const maxHorizontalOffset = Math.max(leftOffset, rightOffset);
  const hasDateLineOutlier = fullMaxDimension > 0 && maxHorizontalOffset / fullMaxDimension > 0.18;

  const largestAreaShare = largestArea / totalArea;

  if ((!isMuchMoreSpreadThanLargest && !hasDateLineOutlier) || largestAreaShare < 0.55) {
    return feature;
  }

  return {
    type: 'Feature',
    properties: feature.properties,
    geometry: { type: 'Polygon', coordinates: largestPolygon },
  };
}

function normalizeAntimeridianGeometry(feature: GeoFeature, generator: ReturnType<typeof geoPath>): GeoFeature {
  if (feature.geometry.type !== 'MultiPolygon') {
    return feature;
  }

  const polygons = feature.geometry.coordinates;

  const avgLons = polygons.map((polygon) => {
    const ring = polygon[0];
    if (!ring.length) return 0;
    return ring.reduce((sum, coordinate) => sum + (coordinate[0] as number), 0) / ring.length;
  });

  let largestIdx = 0;
  let largestArea = -1;
  for (let index = 0; index < polygons.length; index++) {
    const polygonFeature: GeoFeature = {
      type: 'Feature',
      properties: feature.properties,
      geometry: { type: 'Polygon', coordinates: polygons[index] },
    };
    const area = Math.max(0, generator.area(polygonFeature));
    if (area > largestArea) {
      largestArea = area;
      largestIdx = index;
    }
  }

  if (avgLons[largestIdx] <= 90) return feature;
  if (!avgLons.some((longitude) => longitude < -90)) return feature;

  const normalizedPolygons = polygons.map((polygon, index) => {
    if (avgLons[index] >= -90) return polygon;
    return polygon.map((ring) =>
      ring.map((coordinate) => [(coordinate[0] as number) + 360, coordinate[1]] as GeoJSON.Position),
    );
  });

  return {
    ...feature,
    geometry: { type: 'MultiPolygon', coordinates: normalizedPolygons },
  };
}

let cachedPayloadPromise: Promise<WorldMapPayload> | null = null;

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .toLowerCase();
}

function normalizePlaceName(value: string): string {
  return normalizeText(value)
    .replace(/\b(capital|city|province|district|region|metropolitan)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getNameVariants(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) return [];

  const variants = new Set<string>([
    trimmed,
    trimmed.replace(/\(.*?\)/g, '').trim(),
    trimmed.replace(/,.+$/, '').trim(),
    trimmed.replace(/\s*[-/].+$/, '').trim(),
  ]);

  return Array.from(variants).filter(Boolean);
}

function getCountryCityLookup(countryCode: string): Map<string, Coordinates> {
  const cached = cityLookupCache.get(countryCode);
  if (cached) return cached;

  const lookup = new Map<string, Coordinates>();
  const cities = City.getCitiesOfCountry(countryCode) || [];

  for (const city of cities) {
    const latitude = Number.parseFloat(city.latitude || '');
    const longitude = Number.parseFloat(city.longitude || '');
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;

    const baseCoordinates = { latitude, longitude };
    for (const variant of getNameVariants(city.name || '')) {
      const normalized = normalizePlaceName(variant);
      if (!normalized || lookup.has(normalized)) continue;
      lookup.set(normalized, baseCoordinates);
    }
  }

  cityLookupCache.set(countryCode, lookup);
  return lookup;
}

function getLocalizedCountryName(country: Country, locale: string): string {
  if (locale === 'fr') {
    return country.translations?.fra?.common || country.name.common;
  }

  return country.name.common;
}

function getCountryNameCandidates(country: Country): string[] {
  return [
    country.cca2,
    country.name.common,
    country.name.official,
    ...(country.altSpellings || []),
    country.translations?.fra?.common,
    country.translations?.fra?.official,
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
}

function getFeatureNameCandidates(properties: FeatureProperties): string[] {
  return [
    properties.ISO_A2,
    properties.NAME,
    properties.NAME_EN,
    properties.NAME_FR,
    properties.ADMIN,
    properties.SOVEREIGNT,
    properties.BRK_NAME,
    properties.FORMAL_EN,
    properties.FORMAL_FR,
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
}

function getCapitalCoordinates(country: Country): { latitude: number; longitude: number } | null {
  const cacheKey = country.cca2.toUpperCase();
  if (capitalCoordinatesCache.has(cacheKey)) {
    return capitalCoordinatesCache.get(cacheKey) || null;
  }

  const cityLookup = getCountryCityLookup(cacheKey);
  for (const capitalName of country.capital || []) {
    for (const variant of getNameVariants(capitalName)) {
      const normalized = normalizePlaceName(variant);
      const coordinates = cityLookup.get(normalized);
      if (coordinates) {
        capitalCoordinatesCache.set(cacheKey, coordinates);
        return coordinates;
      }
    }
  }

  const countryWithCapitalInfo = country as Country & { capitalInfo?: { latlng?: [number, number] | number[] } };
  const capitalInfo = countryWithCapitalInfo.capitalInfo;
  const capitalLatLng = capitalInfo?.latlng;

  if (
    Array.isArray(capitalLatLng)
    && capitalLatLng.length >= 2
    && Number.isFinite(capitalLatLng[0])
    && Number.isFinite(capitalLatLng[1])
  ) {
    const coordinates = { latitude: capitalLatLng[0], longitude: capitalLatLng[1] };
    capitalCoordinatesCache.set(cacheKey, coordinates);
    return coordinates;
  }

  if (
    Array.isArray(country.latlng)
    && country.latlng.length >= 2
    && Number.isFinite(country.latlng[0])
    && Number.isFinite(country.latlng[1])
  ) {
    const coordinates = { latitude: country.latlng[0], longitude: country.latlng[1] };
    capitalCoordinatesCache.set(cacheKey, coordinates);
    return coordinates;
  }

  capitalCoordinatesCache.set(cacheKey, null);
  return null;
}

function buildCountryIndexes() {
  const byCode = new Map<string, Country>();
  const byName = new Map<string, Country>();

  for (const country of countries) {
    if (!country.cca2 || !country.capital?.[0] || !country.flag) continue;

    byCode.set(country.cca2.toUpperCase(), country);

    for (const candidate of getCountryNameCandidates(country)) {
      const normalized = normalizeText(candidate);
      if (!normalized || byName.has(normalized)) continue;
      byName.set(normalized, country);
    }
  }

  return { byCode, byName };
}

function resolveCountryMetadata(
  properties: FeatureProperties,
  indexes: ReturnType<typeof buildCountryIndexes>,
): Country | null {
  const isoCode = typeof properties.ISO_A2 === 'string' ? properties.ISO_A2.toUpperCase() : '';
  if (/^[A-Z]{2}$/.test(isoCode)) {
    const fromCode = indexes.byCode.get(isoCode);
    if (fromCode) return fromCode;
  }

  for (const candidate of getFeatureNameCandidates(properties)) {
    const fromName = indexes.byName.get(normalizeText(candidate));
    if (fromName) return fromName;
  }

  return null;
}

async function loadGeoJson(): Promise<GeoJSON.FeatureCollection> {
  const filePath = join(process.cwd(), 'public/maps/world-countries-110m.geojson');
  const rawGeoData = await readFile(filePath, 'utf8');
  return JSON.parse(rawGeoData) as GeoJSON.FeatureCollection;
}

async function getMapProjection() {
  if (!mapProjectionPromise) {
    mapProjectionPromise = loadGeoJson().then((geoData) => {
      const projection = geoNaturalEarth1();
      projection.fitExtent(
        [[24, 24], [MAP_VIEWBOX.width - 24, MAP_VIEWBOX.height - 24]],
        geoData as never,
      );
      return projection;
    });
  }

  return mapProjectionPromise;
}

export async function projectCoordinatesToMap({ latitude, longitude }: Coordinates): Promise<ProjectedMapPoint | null> {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  const projection = await getMapProjection();
  const projected = projection([longitude, latitude]);
  if (!projected || !Number.isFinite(projected[0]) || !Number.isFinite(projected[1])) {
    return null;
  }

  return { x: projected[0], y: projected[1] };
}

async function buildWorldMapPayload(locale: string): Promise<WorldMapPayload> {
  const geoData = await loadGeoJson();
  const indexes = buildCountryIndexes();
  const projection = await getMapProjection();

  const generator = geoPath(projection);
  const seenCodes = new Set<string>();
  const mapCountries: WorldMapCountry[] = [];

  for (const feature of geoData.features || []) {
    if (!feature || feature.type !== 'Feature' || !feature.geometry) continue;

    const properties = (feature.properties || {}) as FeatureProperties;
    const country = resolveCountryMetadata(properties, indexes);
    if (!country || seenCodes.has(country.cca2)) continue;

    const rawFeature = normalizeAntimeridianGeometry(feature as GeoFeature, generator);
    const focusFeature = getFeatureFocusGeometry(rawFeature, generator);

    const path = generator(rawFeature);
    if (!path) continue;

    const bounds = generator.bounds(focusFeature);
    const projectedWidth = Math.max(0, bounds[1][0] - bounds[0][0]);
    const projectedHeight = Math.max(0, bounds[1][1] - bounds[0][1]);

    if (projectedWidth < MIN_CLICKABLE_COUNTRY_SIZE && projectedHeight < MIN_CLICKABLE_COUNTRY_SIZE) {
      continue;
    }

    const centroid = generator.centroid(focusFeature);
    const fallbackPoint = projection([country.latlng[1], country.latlng[0]]);
    const centroidX = Number.isFinite(centroid[0]) ? centroid[0] : (fallbackPoint?.[0] ?? Number.NaN);
    const centroidY = Number.isFinite(centroid[1]) ? centroid[1] : (fallbackPoint?.[1] ?? Number.NaN);

    const capitalCoordinates = getCapitalCoordinates(country);
    const projectedCapital = capitalCoordinates
      ? projection([capitalCoordinates.longitude, capitalCoordinates.latitude])
      : null;
    const capitalX = projectedCapital?.[0] ?? centroidX;
    const capitalY = projectedCapital?.[1] ?? centroidY;

    if (
      !Number.isFinite(centroidX)
      || !Number.isFinite(centroidY)
      || !Number.isFinite(capitalX)
      || !Number.isFinite(capitalY)
    ) {
      continue;
    }

    seenCodes.add(country.cca2);
    const lat = Number.isFinite(country.latlng?.[0]) ? country.latlng[0] : 0;
    const lng = Number.isFinite(country.latlng?.[1]) ? country.latlng[1] : 0;
    mapCountries.push({
      code: country.cca2,
      name: getLocalizedCountryName(country, locale),
      capital: country.capital[0],
      flag: country.flag,
      path,
      centroid: { x: centroidX, y: centroidY },
      capitalPoint: { x: capitalX, y: capitalY },
      focusBounds: {
        x: bounds[0][0],
        y: bounds[0][1],
        width: projectedWidth,
        height: projectedHeight,
      },
      latlng: [lat, lng],
    });
  }

  mapCountries.sort((left, right) => left.name.localeCompare(right.name, locale));

  return {
    countries: mapCountries,
    viewBox: MAP_VIEWBOX,
    projection: {
      scale: projection.scale(),
      translate: projection.translate() as [number, number],
    },
  };
}

export async function getWorldMapPayload(locale: string): Promise<WorldMapPayload> {
  if (!cachedPayloadPromise) {
    cachedPayloadPromise = buildWorldMapPayload('en');
  }

  if (locale === 'en') {
    return cachedPayloadPromise;
  }

  return buildWorldMapPayload(locale);
}
