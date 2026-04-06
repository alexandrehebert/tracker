function getFormatterPartMap(date: Date, timeZone: string): Record<string, string> {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hour12: false,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date).reduce<Record<string, string>>((parts, part) => {
    if (part.type !== 'literal') {
      parts[part.type] = part.value;
    }

    return parts;
  }, {});
}

function parseDateTimeLocalParts(value: string): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
} | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }

  const [, year, month, day, hour, minute] = match;
  return {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
  };
}

function getTimeZoneOffsetMs(date: Date, timeZone: string): number | null {
  try {
    const parts = getFormatterPartMap(date, timeZone);
    const zonedTime = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );

    return zonedTime - date.getTime();
  } catch {
    return null;
  }
}

export function toDateTimeLocalValue(value: string, timeZone?: string | null): string {
  if (!value) {
    return '';
  }

  const parsedTime = Date.parse(value);
  if (Number.isNaN(parsedTime)) {
    return '';
  }

  if (timeZone) {
    try {
      const parts = getFormatterPartMap(new Date(parsedTime), timeZone);
      return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
    } catch {
      // Fall back to the browser timezone when the airport timezone is unavailable.
    }
  }

  const date = new Date(parsedTime);
  const timezoneOffsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(parsedTime - timezoneOffsetMs).toISOString().slice(0, 16);
}

export function fromDateTimeLocalValue(value: string, timeZone?: string | null): string {
  if (!value) {
    return '';
  }

  if (!timeZone) {
    const parsedTime = Date.parse(value);
    return Number.isNaN(parsedTime) ? '' : new Date(parsedTime).toISOString();
  }

  const parts = parseDateTimeLocalParts(value);
  if (!parts) {
    return '';
  }

  const utcGuess = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0, 0);
  const initialOffset = getTimeZoneOffsetMs(new Date(utcGuess), timeZone);

  if (initialOffset == null) {
    const parsedTime = Date.parse(value);
    return Number.isNaN(parsedTime) ? '' : new Date(parsedTime).toISOString();
  }

  let resolvedTime = utcGuess - initialOffset;
  const adjustedOffset = getTimeZoneOffsetMs(new Date(resolvedTime), timeZone);
  if (adjustedOffset != null && adjustedOffset !== initialOffset) {
    resolvedTime = utcGuess - adjustedOffset;
  }

  return new Date(resolvedTime).toISOString();
}

export function formatDateTime(value: number | null, locale: string): string {
  if (!value) {
    return '—';
  }

  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(value);
}
