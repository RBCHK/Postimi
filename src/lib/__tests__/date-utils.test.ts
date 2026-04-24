/**
 * Unit tests for date-utils — the single source of truth for timezone and
 * calendar-date conversions in the app. These are the invariants we lock in:
 *
 *   1. `calendarDateStr` — UTC-midnight storage convention: a Date built from
 *      "YYYY-MM-DDT00:00:00.000Z" returns that same YYYY-MM-DD, irrespective
 *      of server TZ. Regressions here silently shift every calendar date.
 *
 *   2. `parseTimeSlot` — accepts valid 12h format, rejects garbage. The UI
 *      passes user-typed strings straight through; silent nulls on typos
 *      would desync the scheduling model.
 *
 *   3. DST handling for `slotToUtcDate` (America/Los_Angeles):
 *        - spring-forward (2026-03-08 02:00 is skipped) must not crash and
 *          must produce a deterministic UTC moment.
 *        - fall-back (2026-11-01 01:00 is ambiguous) must not crash and must
 *          pick one consistent instant.
 *
 *   4. `nowInTimezone` is deterministic under `vi.useFakeTimers()` — the
 *      production code uses `new Date()`, so fake timers must work.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  addUTCDays,
  calendarDateStr,
  isSlotFuture,
  localToUtcDate,
  nowInTimezone,
  parseTimeSlot,
  slotToLocalDate,
  slotToUtcDate,
  time24to12,
  timeSlotToMinutes,
} from "@/lib/date-utils";

describe("calendarDateStr", () => {
  it("extracts YYYY-MM-DD from a UTC-midnight date", () => {
    const d = new Date("2026-04-24T00:00:00.000Z");
    expect(calendarDateStr(d)).toBe("2026-04-24");
  });

  it("returns the UTC date component, not the local one", () => {
    // 2026-04-24T23:30 UTC is still 2026-04-24 in UTC; the server TZ must
    // not leak through. Regression guard for a previous bug where
    // toLocaleDateString(server TZ) was used.
    const d = new Date("2026-04-24T23:30:00.000Z");
    expect(calendarDateStr(d)).toBe("2026-04-24");
  });

  it("handles epoch (1970-01-01)", () => {
    expect(calendarDateStr(new Date(0))).toBe("1970-01-01");
  });
});

describe("parseTimeSlot", () => {
  it("parses AM times", () => {
    expect(parseTimeSlot("8:15 AM")).toEqual({ hours: 8, minutes: 15 });
  });

  it("parses PM times", () => {
    expect(parseTimeSlot("3:45 PM")).toEqual({ hours: 15, minutes: 45 });
  });

  it("12:00 AM is midnight (00:00)", () => {
    // regression: naive "PM means +12" logic would turn 12 AM into 12:00
    expect(parseTimeSlot("12:00 AM")).toEqual({ hours: 0, minutes: 0 });
  });

  it("12:00 PM is noon (12:00)", () => {
    // regression: naive handler would turn 12 PM into 24:00
    expect(parseTimeSlot("12:00 PM")).toEqual({ hours: 12, minutes: 0 });
  });

  it("is case-insensitive on AM/PM", () => {
    expect(parseTimeSlot("8:15 am")).toEqual({ hours: 8, minutes: 15 });
    expect(parseTimeSlot("8:15 pm")).toEqual({ hours: 20, minutes: 15 });
  });

  it("returns null for empty string", () => {
    expect(parseTimeSlot("")).toBe(null);
  });

  it("returns null for 24h format without AM/PM suffix", () => {
    expect(parseTimeSlot("13:00")).toBe(null);
  });

  it("returns null for nonsense strings", () => {
    expect(parseTimeSlot("not a time")).toBe(null);
    expect(parseTimeSlot("8:15")).toBe(null);
    expect(parseTimeSlot("8:15 XM")).toBe(null);
  });
});

describe("timeSlotToMinutes", () => {
  it("converts 8:15 AM → 495 minutes", () => {
    expect(timeSlotToMinutes("8:15 AM")).toBe(8 * 60 + 15);
  });

  it("converts 12:00 AM → 0 minutes (midnight)", () => {
    expect(timeSlotToMinutes("12:00 AM")).toBe(0);
  });

  it("converts 12:00 PM → 720 minutes (noon)", () => {
    expect(timeSlotToMinutes("12:00 PM")).toBe(720);
  });

  it("returns 0 for invalid input (documents current behavior)", () => {
    // The function does NOT throw on bad input; it falls through to 0.
    // Callers must not rely on "0 means midnight" without validating first.
    expect(timeSlotToMinutes("garbage")).toBe(0);
  });
});

describe("time24to12", () => {
  it("converts 08:15 → '8:15 AM'", () => {
    expect(time24to12("08:15")).toBe("8:15 AM");
  });

  it("converts 15:45 → '3:45 PM'", () => {
    expect(time24to12("15:45")).toBe("3:45 PM");
  });

  it("converts 00:00 → '12:00 AM'", () => {
    expect(time24to12("00:00")).toBe("12:00 AM");
  });

  it("converts 12:00 → '12:00 PM'", () => {
    expect(time24to12("12:00")).toBe("12:00 PM");
  });

  it("returns input unchanged on malformed string", () => {
    expect(time24to12("not-a-time")).toBe("not-a-time");
  });
});

describe("localToUtcDate", () => {
  it("UTC timezone: local time IS UTC time", () => {
    // Sanity: if the caller passes UTC, we must return that exact instant.
    const d = localToUtcDate("2026-04-24", 12, 0, "UTC");
    expect(d.toISOString()).toBe("2026-04-24T12:00:00.000Z");
  });

  it("America/Los_Angeles (PDT, UTC-7) in April: 8:00 AM local = 15:00 UTC", () => {
    // April 24 2026 is in PDT (UTC-7, DST active).
    const d = localToUtcDate("2026-04-24", 8, 0, "America/Los_Angeles");
    expect(d.toISOString()).toBe("2026-04-24T15:00:00.000Z");
  });

  it("America/Los_Angeles (PST, UTC-8) in January: 8:00 AM local = 16:00 UTC", () => {
    // January 15 2026 is in PST (UTC-8, no DST).
    const d = localToUtcDate("2026-01-15", 8, 0, "America/Los_Angeles");
    expect(d.toISOString()).toBe("2026-01-15T16:00:00.000Z");
  });

  it("Europe/Moscow (UTC+3): 12:00 local = 09:00 UTC", () => {
    // Moscow has no DST; always UTC+3.
    const d = localToUtcDate("2026-04-24", 12, 0, "Europe/Moscow");
    expect(d.toISOString()).toBe("2026-04-24T09:00:00.000Z");
  });

  it("DST spring-forward (2026-03-08 02:00 PT is skipped) does not crash and returns a valid UTC Date", () => {
    // On 2026-03-08, clocks jump from 01:59 → 03:00 in America/Los_Angeles.
    // 02:30 local does not exist. The function must still return a Date
    // (not throw, not NaN). The exact instant is implementation-defined but
    // must be deterministic for the same input.
    const d1 = localToUtcDate("2026-03-08", 2, 30, "America/Los_Angeles");
    const d2 = localToUtcDate("2026-03-08", 2, 30, "America/Los_Angeles");
    expect(Number.isNaN(d1.getTime())).toBe(false);
    expect(d1.getTime()).toBe(d2.getTime()); // deterministic
  });

  it("DST fall-back (2026-11-01 01:00 PT is ambiguous) does not crash and returns a valid UTC Date", () => {
    // On 2026-11-01, clocks go back from 02:00 → 01:00 in America/Los_Angeles.
    // 01:30 local happens twice (once in PDT, once in PST). The function
    // must still return a Date (not throw, not NaN) and pick one instant
    // consistently.
    const d1 = localToUtcDate("2026-11-01", 1, 30, "America/Los_Angeles");
    const d2 = localToUtcDate("2026-11-01", 1, 30, "America/Los_Angeles");
    expect(Number.isNaN(d1.getTime())).toBe(false);
    expect(d1.getTime()).toBe(d2.getTime()); // deterministic
  });
});

describe("slotToUtcDate", () => {
  it("combines UTC-midnight date + local slot → absolute UTC moment", () => {
    const date = new Date("2026-04-24T00:00:00.000Z");
    const utc = slotToUtcDate(date, "8:15 AM", "UTC");
    expect(utc.toISOString()).toBe("2026-04-24T08:15:00.000Z");
  });

  it("applies timezone offset (PDT)", () => {
    const date = new Date("2026-04-24T00:00:00.000Z");
    const utc = slotToUtcDate(date, "8:00 AM", "America/Los_Angeles");
    // 8 AM PDT = 15:00 UTC
    expect(utc.toISOString()).toBe("2026-04-24T15:00:00.000Z");
  });

  it("falls back to input date when timeSlot is invalid", () => {
    // Documents current behavior: parseTimeSlot returns null → function
    // returns new Date(date) (the UTC-midnight moment unchanged).
    const date = new Date("2026-04-24T00:00:00.000Z");
    const result = slotToUtcDate(date, "garbage", "UTC");
    expect(result.toISOString()).toBe(date.toISOString());
  });
});

describe("slotToLocalDate", () => {
  it("returns null for invalid timeSlot", () => {
    const date = new Date("2026-04-24T00:00:00.000Z");
    expect(slotToLocalDate(date, "garbage")).toBe(null);
  });

  it("returns a Date for valid input (browser-local time)", () => {
    const date = new Date("2026-04-24T00:00:00.000Z");
    const d = slotToLocalDate(date, "8:15 AM");
    // We don't assert the UTC instant (it depends on the test runner's TZ),
    // only that we got a non-null valid Date with correct Y/M/D/H/M in local.
    expect(d).not.toBe(null);
    expect(Number.isNaN(d!.getTime())).toBe(false);
    // The local Y/M/D/H/M must match the input (Date parses "YYYY-MM-DDTHH:MM:00"
    // in the local timezone).
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(3); // April (zero-indexed)
    expect(d!.getDate()).toBe(24);
    expect(d!.getHours()).toBe(8);
    expect(d!.getMinutes()).toBe(15);
  });
});

describe("nowInTimezone", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("honors fake timers (production code uses `new Date()`)", () => {
    vi.setSystemTime(new Date("2026-04-24T15:30:00.000Z"));
    // UTC → dateStr must reflect 2026-04-24
    const result = nowInTimezone("UTC");
    expect(result.dateStr).toBe("2026-04-24");
    expect(result.date.toISOString()).toBe("2026-04-24T15:30:00.000Z");
  });

  it("converts calendar date to target timezone", () => {
    // 2026-04-24 01:00 UTC is still 2026-04-23 in Los Angeles (PDT = UTC-7).
    vi.setSystemTime(new Date("2026-04-24T01:00:00.000Z"));
    const result = nowInTimezone("America/Los_Angeles");
    expect(result.dateStr).toBe("2026-04-23");
  });

  it("returns a parseable 12h timeSlot", () => {
    vi.setSystemTime(new Date("2026-04-24T15:30:00.000Z"));
    const result = nowInTimezone("UTC");
    // Round-trip: the emitted timeSlot must parse back without error.
    expect(parseTimeSlot(result.timeSlot)).not.toBe(null);
  });
});

describe("addUTCDays", () => {
  it("adds positive days using UTC arithmetic", () => {
    const d = new Date("2026-04-24T00:00:00.000Z");
    expect(addUTCDays(d, 1).toISOString()).toBe("2026-04-25T00:00:00.000Z");
  });

  it("subtracts days when n is negative", () => {
    const d = new Date("2026-04-24T00:00:00.000Z");
    expect(addUTCDays(d, -1).toISOString()).toBe("2026-04-23T00:00:00.000Z");
  });

  it("crosses month boundary (2026-04-30 + 2 = 2026-05-02)", () => {
    const d = new Date("2026-04-30T00:00:00.000Z");
    expect(addUTCDays(d, 2).toISOString()).toBe("2026-05-02T00:00:00.000Z");
  });

  it("does not mutate input date", () => {
    const d = new Date("2026-04-24T00:00:00.000Z");
    const original = d.toISOString();
    addUTCDays(d, 5);
    expect(d.toISOString()).toBe(original);
  });

  it("crosses DST boundary without drift (UTC arithmetic, not local setDate)", () => {
    // Adding days across 2026-03-08 (spring-forward in the US) must still
    // advance by exactly 24h per day in UTC — no +/- 1h drift. This is the
    // whole reason we use setUTCDate instead of setDate.
    const d = new Date("2026-03-07T00:00:00.000Z");
    expect(addUTCDays(d, 2).toISOString()).toBe("2026-03-09T00:00:00.000Z");
  });
});

describe("isSlotFuture", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns true when the slot date is after today", () => {
    vi.setSystemTime(new Date("2026-04-24T12:00:00.000Z"));
    const slotDate = new Date("2026-04-25T00:00:00.000Z");
    expect(isSlotFuture(slotDate, "8:15 AM", "UTC")).toBe(true);
  });

  it("returns false when the slot date is before today", () => {
    vi.setSystemTime(new Date("2026-04-24T12:00:00.000Z"));
    const slotDate = new Date("2026-04-23T00:00:00.000Z");
    expect(isSlotFuture(slotDate, "11:59 PM", "UTC")).toBe(false);
  });

  it("same-day: returns true if the slot time is later than now", () => {
    vi.setSystemTime(new Date("2026-04-24T08:00:00.000Z"));
    const slotDate = new Date("2026-04-24T00:00:00.000Z");
    // 9:00 AM UTC > 8:00 AM UTC now
    expect(isSlotFuture(slotDate, "9:00 AM", "UTC")).toBe(true);
  });

  it("same-day: returns false if the slot time is earlier than now", () => {
    vi.setSystemTime(new Date("2026-04-24T12:00:00.000Z"));
    const slotDate = new Date("2026-04-24T00:00:00.000Z");
    // 8:00 AM UTC < 12:00 UTC now
    expect(isSlotFuture(slotDate, "8:00 AM", "UTC")).toBe(false);
  });
});
