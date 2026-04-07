export const SELECTED_FLIGHT_COLOR = '#38bdf8';

function hslToRgb(hue: number, saturation: number, lightness: number) {
  const normalizedHue = ((hue % 360) + 360) % 360;
  const s = Math.max(0, Math.min(1, saturation));
  const l = Math.max(0, Math.min(1, lightness));
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const huePrime = normalizedHue / 60;
  const x = chroma * (1 - Math.abs((huePrime % 2) - 1));

  let red = 0;
  let green = 0;
  let blue = 0;

  if (huePrime >= 0 && huePrime < 1) {
    red = chroma;
    green = x;
  } else if (huePrime < 2) {
    red = x;
    green = chroma;
  } else if (huePrime < 3) {
    green = chroma;
    blue = x;
  } else if (huePrime < 4) {
    green = x;
    blue = chroma;
  } else if (huePrime < 5) {
    red = x;
    blue = chroma;
  } else {
    red = chroma;
    blue = x;
  }

  const match = l - chroma / 2;
  return {
    r: Math.round((red + match) * 255),
    g: Math.round((green + match) * 255),
    b: Math.round((blue + match) * 255),
  };
}

function parseColorToRgb(color: string): { r: number; g: number; b: number } | null {
  const normalized = color.trim();

  const hexMatch = normalized.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hexMatch) {
    const raw = hexMatch[1]!;
    const hex = raw.length === 3
      ? raw.split('').map((char) => `${char}${char}`).join('')
      : raw;

    return {
      r: Number.parseInt(hex.slice(0, 2), 16),
      g: Number.parseInt(hex.slice(2, 4), 16),
      b: Number.parseInt(hex.slice(4, 6), 16),
    };
  }

  const rgbMatch = normalized.match(/^rgba?\(([^)]+)\)$/i);
  if (rgbMatch) {
    const [r = 0, g = 0, b = 0] = rgbMatch[1]!.split(',').map((part) => Number.parseFloat(part.trim()));
    return { r, g, b };
  }

  const hslMatch = normalized.match(/^hsla?\(([^)]+)\)$/i);
  if (hslMatch) {
    const [h = 0, s = 0, l = 0] = hslMatch[1]!.split(',').map((part) => Number.parseFloat(part.trim().replace('%', '')));
    return hslToRgb(h, s / 100, l / 100);
  }

  return null;
}

export function getReadableTextColor(
  color: string,
  options: {
    light?: string;
    dark?: string;
    luminanceThreshold?: number;
  } = {},
) {
  const {
    light = '#ffffff',
    dark = 'rgba(15, 23, 42, 0.82)',
    luminanceThreshold = 0.58,
  } = options;

  const rgb = parseColorToRgb(color);
  if (!rgb) {
    return light;
  }

  const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
  return luminance >= luminanceThreshold ? dark : light;
}

export function getFlightMapColor(index: number, isSelected: boolean) {
  if (isSelected) {
    return SELECTED_FLIGHT_COLOR;
  }

  const hue = (index * 57) % 360;
  return `hsl(${hue}, 78%, 64%)`;
}
