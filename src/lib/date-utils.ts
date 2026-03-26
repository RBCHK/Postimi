/**
 * Calendar-date & timezone utilities for the UTC-midnight storage convention.
 *
 * xREBA stores calendar dates (slot dates, analytics, goals) as
 * `YYYY-MM-DDT00:00:00.000Z` — the UTC date component IS the local calendar day.
 * These are NOT real UTC timestamps; they are a representation convention.
 *
 * Time slots ("8:15 AM") are always in the user's local timezone.
 *
 * SINGLE SOURCE OF TRUTH for all timezone conversions:
 * - `parseTimeSlot("8:15 AM")` → { hours: 8, minutes: 15 }
 * - `timeSlotToMinutes("8:15 AM")` → 495
 * - `slotToUtcDate(date, "8:15 AM", timezone)` → absolute UTC Date
 * - `localToUtcDate("2026-03-26", "08:15", timezone)` → absolute UTC Date
 * - `nowInTimezone(timezone)` → { dateStr, timeStr, date }
 */

/** Extract "YYYY-MM-DD" from a UTC-midnight calendar date (storage convention). */
export function calendarDateStr(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// ─── Time Slot Parsing ──────────────────────────────────

interface ParsedTime {
  hours: number; // 0-23
  minutes: number;
}

/**
 * Parse a 12h time slot string ("8:15 AM") → 24h hours & minutes.
 * Returns null if the format doesn't match.
 */
export function parseTimeSlot(timeSlot: string): ParsedTime | null {
  const match = timeSlot.match(/^(\d+):(\d+)\s*(AM|PM)$/i);
  if (!match) return null;
  let h = parseInt(match[1]);
  const m = parseInt(match[2]);
  const period = match[3].toUpperCase();
  if (period === "PM" && h !== 12) h += 12;
  if (period === "AM" && h === 12) h = 0;
  return { hours: h, minutes: m };
}

/** Convert time slot to minutes since midnight (for ordering/comparison). */
export function timeSlotToMinutes(timeSlot: string): number {
  const parsed = parseTimeSlot(timeSlot);
  if (!parsed) return 0;
  return parsed.hours * 60 + parsed.minutes;
}

/** Convert 24h "HH:MM" → "h:MM AM/PM". */
export function time24to12(time24: string): string {
  const [h, m] = time24.split(":").map(Number);
  if (isNaN(h) || isNaN(m)) return time24;
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${m.toString().padStart(2, "0")} ${period}`;
}

// ─── Timezone Conversion ────────────────────────────────

/**
 * Convert a local datetime (date string + 24h time) in a given timezone → absolute UTC Date.
 *
 * Uses Intl to derive the timezone offset: create a UTC guess, then measure
 * what the target TZ displays for that guess, and adjust.
 *
 * @param dateStr - "YYYY-MM-DD" calendar date
 * @param hours - 0-23
 * @param minutes - 0-59
 * @param timezone - IANA timezone string, e.g. "Europe/Moscow"
 */
export function localToUtcDate(
  dateStr: string,
  hours: number,
  minutes: number,
  timezone: string
): Date {
  const hh = hours.toString().padStart(2, "0");
  const mm = minutes.toString().padStart(2, "0");

  // UTC guess: treat the local time as if it were UTC
  const utcGuess = new Date(`${dateStr}T${hh}:${mm}:00Z`);

  // Use formatToParts to see what the target TZ displays for our UTC guess.
  // This avoids `new Date(localeString)` which parses in the SERVER's timezone.
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(utcGuess);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "00";
  // Build an ISO string from the parts → parse as UTC to get a server-TZ-independent value
  const tzStr = `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}Z`;
  const tzAsUtc = new Date(tzStr).getTime();

  // offset = how the TZ differs from UTC (positive = east of UTC)
  const offsetMs = tzAsUtc - utcGuess.getTime();

  // Target local time as UTC milliseconds (just for arithmetic)
  const targetUtcMs = utcGuess.getTime();

  // Actual UTC = target local time - offset
  return new Date(targetUtcMs - offsetMs);
}

/**
 * Convert a UTC-midnight date + local timeSlot ("8:15 AM") → absolute UTC Date.
 * This is the canonical way to get the real UTC moment for a scheduled slot.
 *
 * @param date - UTC-midnight calendar date from DB
 * @param timeSlot - "8:15 AM" in user's timezone
 * @param timezone - IANA timezone string
 */
export function slotToUtcDate(date: Date, timeSlot: string, timezone: string): Date {
  const parsed = parseTimeSlot(timeSlot);
  if (!parsed) return new Date(date);
  const dateStr = calendarDateStr(date);
  return localToUtcDate(dateStr, parsed.hours, parsed.minutes, timezone);
}

/**
 * Convert a UTC-midnight date + local timeSlot → local Date (for client-side display).
 * Uses browser's local timezone (no explicit TZ needed).
 * Returns null if timeSlot format is invalid.
 */
export function slotToLocalDate(date: Date, timeSlot: string): Date | null {
  const parsed = parseTimeSlot(timeSlot);
  if (!parsed) return null;
  const dateStr = calendarDateStr(date);
  const hh = parsed.hours.toString().padStart(2, "0");
  const mm = parsed.minutes.toString().padStart(2, "0");
  // Parsed as browser-local time (no "Z" suffix)
  return new Date(`${dateStr}T${hh}:${mm}:00`);
}

// ─── "Now" in Timezone ──────────────────────────────────

/**
 * Get current date/time in a specific timezone.
 * Returns the calendar date string and formatted time slot.
 */
export function nowInTimezone(timezone: string): {
  dateStr: string; // "YYYY-MM-DD"
  timeSlot: string; // "8:15 AM"
  date: Date; // original UTC Date
} {
  const now = new Date();
  return {
    dateStr: now.toLocaleDateString("en-CA", { timeZone: timezone }),
    timeSlot: now.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: timezone,
    }),
    date: now,
  };
}

// ─── UTC Date Arithmetic ────────────────────────────────

/** Add n UTC days to a date (never bare setDate — see CLAUDE.md timezone rules). */
export function addUTCDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

// ─── Slot Comparison ────────────────────────────────────

/** Returns true if a slot is in the future relative to the user's timezone. */
export function isSlotFuture(slotDate: Date, timeSlot: string, timezone: string): boolean {
  const { dateStr: nowDateStr, timeSlot: nowTimeSlot } = nowInTimezone(timezone);
  const slotDateStr = calendarDateStr(slotDate);

  if (slotDateStr > nowDateStr) return true;
  if (slotDateStr < nowDateStr) return false;

  return timeSlotToMinutes(timeSlot) > timeSlotToMinutes(nowTimeSlot);
}
