import { describe, it, expect } from "vitest";

// x-api.ts imports x-api-logger which loads @/lib/prisma. We don't need
// the logger for pure-parser tests; stub it before importing x-api.
import { vi } from "vitest";
vi.mock("@/lib/x-api-logger", () => ({ logXApiCall: vi.fn() }));

import { parseXPostCount, parseXTrendingSince } from "../x-api";

// Contract tests for the post_count / trending_since normalisers added
// after X's 2026-04 endpoint change. The bug we hit in production:
// `/users/personalized_trends` started returning post_count as a
// human-formatted string ("1K posts", "43K posts"), which the legacy
// code passed straight to prisma.trendSnapshot.createMany expecting an
// Int — every row failed validation and the trend-snapshot cron yielded
// zero saved snapshots. These tests lock the parsers' contract so a
// future X-API revert (or further format drift) can't re-break trends
// silently.

describe("parseXPostCount", () => {
  describe("string input (current X format, 2026-04+)", () => {
    it("parses K-suffix integers", () => {
      expect(parseXPostCount("1K posts")).toBe(1_000);
      expect(parseXPostCount("43K posts")).toBe(43_000);
      expect(parseXPostCount("1K post")).toBe(1_000);
    });

    it("parses K-suffix with decimals", () => {
      expect(parseXPostCount("2.1K posts")).toBe(2_100);
      expect(parseXPostCount("5.4K posts")).toBe(5_400);
    });

    it("parses M-suffix", () => {
      expect(parseXPostCount("1.2M posts")).toBe(1_200_000);
      expect(parseXPostCount("3M posts")).toBe(3_000_000);
    });

    it("parses B-suffix (rare but possible)", () => {
      expect(parseXPostCount("1.5B posts")).toBe(1_500_000_000);
    });

    it("is case-insensitive on the suffix", () => {
      expect(parseXPostCount("1k posts")).toBe(1_000);
      expect(parseXPostCount("2.1m posts")).toBe(2_100_000);
    });

    it("strips comma-separated thousands", () => {
      expect(parseXPostCount("5,432 posts")).toBe(5_432);
      expect(parseXPostCount("1,234,567 posts")).toBe(1_234_567);
    });

    it("accepts plain numeric strings without 'posts' trailer", () => {
      expect(parseXPostCount("999")).toBe(999);
      expect(parseXPostCount("1.2K")).toBe(1_200);
    });

    it("handles whitespace around the number", () => {
      expect(parseXPostCount("  43K posts  ")).toBe(43_000);
      expect(parseXPostCount("43K   posts")).toBe(43_000);
    });
  });

  describe("number input (legacy / future revert)", () => {
    it("passes integer through", () => {
      expect(parseXPostCount(0)).toBe(0);
      expect(parseXPostCount(1234)).toBe(1234);
    });

    it("floors floats (DB column is Int)", () => {
      expect(parseXPostCount(3.7)).toBe(3);
    });

    it("clamps negatives to zero", () => {
      expect(parseXPostCount(-5)).toBe(0);
    });

    it("returns 0 for non-finite numbers", () => {
      expect(parseXPostCount(Infinity)).toBe(0);
      expect(parseXPostCount(-Infinity)).toBe(0);
      expect(parseXPostCount(NaN)).toBe(0);
    });
  });

  describe("falls back to 0", () => {
    it("for undefined / null", () => {
      expect(parseXPostCount(undefined)).toBe(0);
      expect(parseXPostCount(null)).toBe(0);
    });

    it("for empty / whitespace-only strings", () => {
      expect(parseXPostCount("")).toBe(0);
      expect(parseXPostCount("   ")).toBe(0);
    });

    it("for unparseable garbage strings", () => {
      // "trending hot 🔥" — would let an LLM-injected payload through
      // without the regex anchor. The 0-fallback keeps the row saveable
      // rather than aborting the whole user's run.
      expect(parseXPostCount("trending hot")).toBe(0);
      expect(parseXPostCount("posts only")).toBe(0);
    });

    it("for non-string non-number values", () => {
      expect(parseXPostCount({})).toBe(0);
      expect(parseXPostCount([])).toBe(0);
      expect(parseXPostCount(true)).toBe(0);
    });
  });
});

describe("parseXTrendingSince", () => {
  it("returns the ISO form of a parseable date", () => {
    const result = parseXTrendingSince("2026-04-29T12:00:00Z");
    expect(result).toBe("2026-04-29T12:00:00.000Z");
  });

  it("normalises non-ISO dates to ISO", () => {
    const result = parseXTrendingSince("2026-04-29");
    // Locale-independent — should yield the start of the day in UTC.
    expect(result).toBe("2026-04-29T00:00:00.000Z");
  });

  it("returns undefined for the literal string 'Invalid Date'", () => {
    // X has been seen returning this string verbatim — Date.parse on
    // it yields NaN, which used to land as `new Date(NaN)` in our
    // mapper and Prisma rejected the whole row.
    expect(parseXTrendingSince("Invalid Date")).toBeUndefined();
  });

  it("returns undefined for any unparseable string", () => {
    expect(parseXTrendingSince("not a date")).toBeUndefined();
    expect(parseXTrendingSince("yesterday")).toBeUndefined();
  });

  it("returns undefined for missing / empty values", () => {
    expect(parseXTrendingSince(undefined)).toBeUndefined();
    expect(parseXTrendingSince(null)).toBeUndefined();
    expect(parseXTrendingSince("")).toBeUndefined();
  });

  it("returns undefined for non-string types", () => {
    expect(parseXTrendingSince(12345)).toBeUndefined();
    expect(parseXTrendingSince({})).toBeUndefined();
  });
});
