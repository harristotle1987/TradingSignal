/**
 * Universal Timezone and Date Formatter Utility
 * Provides deterministic formatting across Local User Time, UTC, and Exchange (ET) timezones.
 */

export type DisplayTimeZone = 'LOCAL' | 'UTC' | 'EXCHANGE';

export interface FormattedTimeInfo {
  timeStr: string;
  dateStr: string;
  fullStr: string;
  timeZoneLabel: string;
}

/**
 * Returns the user's detected local timezone (e.g. "America/Los_Angeles", "Europe/London").
 */
export function getLocalTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * Returns a short abbreviation or identifier for a timezone.
 */
export function getTimeZoneAbbr(date: Date, timeZone: string): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'short',
    });
    const parts = formatter.formatToParts(date);
    return parts.find((p) => p.type === 'timeZoneName')?.value || timeZone;
  } catch {
    return timeZone;
  }
}

/**
 * Formats a timestamp into a formatted string according to the requested timezone mode.
 */
export function formatTimeWithZone(
  timestamp: number | string | Date | undefined | null,
  mode: DisplayTimeZone = 'LOCAL',
  includeSeconds = true
): string {
  if (!timestamp) return 'N/A';
  const date = typeof timestamp === 'number' || typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
  if (isNaN(date.getTime())) return 'Invalid Date';

  let targetTimeZone: string;
  let zoneTag = '';

  if (mode === 'UTC') {
    targetTimeZone = 'UTC';
    zoneTag = 'UTC';
  } else if (mode === 'EXCHANGE') {
    targetTimeZone = 'America/New_York';
    zoneTag = getTimeZoneAbbr(date, 'America/New_York');
  } else {
    targetTimeZone = getLocalTimeZone();
    zoneTag = getTimeZoneAbbr(date, targetTimeZone);
  }

  try {
    const timeFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: targetTimeZone,
      hour: '2-digit',
      minute: '2-digit',
      second: includeSeconds ? '2-digit' : undefined,
      hourCycle: 'h23',
    });

    const timeStr = timeFormatter.format(date);
    return `${timeStr} ${zoneTag}`;
  } catch {
    return date.toISOString();
  }
}

/**
 * Returns comprehensive breakdown of a date in specified timezone mode.
 */
export function getDetailedTimeBreakdown(
  timestamp: number | string | Date | undefined | null,
  mode: DisplayTimeZone = 'LOCAL'
): FormattedTimeInfo {
  if (!timestamp) {
    return { timeStr: 'N/A', dateStr: 'N/A', fullStr: 'N/A', timeZoneLabel: mode };
  }
  const date = typeof timestamp === 'number' || typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
  if (isNaN(date.getTime())) {
    return { timeStr: 'Invalid', dateStr: 'Invalid', fullStr: 'Invalid Date', timeZoneLabel: mode };
  }

  let targetTimeZone: string;
  if (mode === 'UTC') {
    targetTimeZone = 'UTC';
  } else if (mode === 'EXCHANGE') {
    targetTimeZone = 'America/New_York';
  } else {
    targetTimeZone = getLocalTimeZone();
  }

  try {
    const timeZoneLabel = getTimeZoneAbbr(date, targetTimeZone);

    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: targetTimeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
      weekday: 'short',
    });

    const parts = formatter.formatToParts(date);
    const getPart = (type: string) => parts.find((p) => p.type === type)?.value || '';

    const weekday = getPart('weekday');
    const year = getPart('year');
    const month = getPart('month');
    const day = getPart('day');
    const hour = getPart('hour');
    const minute = getPart('minute');
    const second = getPart('second');

    const dateStr = `${year}-${month}-${day}`;
    const timeStr = `${hour}:${minute}:${second}`;
    const fullStr = `${weekday} ${timeStr} ${timeZoneLabel} (${dateStr})`;

    return { timeStr, dateStr, fullStr, timeZoneLabel };
  } catch {
    return {
      timeStr: date.toISOString().substring(11, 19),
      dateStr: date.toISOString().substring(0, 10),
      fullStr: date.toISOString(),
      timeZoneLabel: mode,
    };
  }
}
