function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const REGION_NAME_TO_CODE: Record<string, string> = (() => {
  const map: Record<string, string> = {};

  // Build a reverse lookup from localized region names to ISO-2 code.
  const formatter = new Intl.DisplayNames(['fr'], { type: 'region' });
  for (let first = 65; first <= 90; first++) {
    for (let second = 65; second <= 90; second++) {
      const code = String.fromCharCode(first, second);
      const localizedName = formatter.of(code);
      if (!localizedName || localizedName === code) continue;

      const normalizedName = normalizeText(localizedName);
      if (!normalizedName) continue;
      if (!(normalizedName in map)) {
        map[normalizedName] = code;
      }
    }
  }

  return map;
})();

const COUNTRY_CODE_ALIASES: Record<string, string> = {
  // French regions/territories we want to count under France.
  'corse': 'FR',
  'la reunion': 'FR',
  'reunion': 'FR',
  'martinique': 'FR',
  // Common alternate labels not always returned by Intl in this form.
  'allemagne': 'DE',
  'germany': 'DE',
  'angleterre': 'GB',
  'etats unis d amerique': 'US',
  'etats unis': 'US',
  'republique tcheque': 'CZ',
  'vietnam': 'VN',
  'viet nam': 'VN',
};

export function resolveCountryCode(countryName: string): string | null {
  const normalized = normalizeText(countryName);
  if (!normalized) return null;

  const fromAliases = COUNTRY_CODE_ALIASES[normalized];
  if (fromAliases) return fromAliases;

  const fromLocalizedRegion = REGION_NAME_TO_CODE[normalized];
  return fromLocalizedRegion ?? null;
}
