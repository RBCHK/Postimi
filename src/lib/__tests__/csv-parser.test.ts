import { readFileSync } from "fs";
import { join } from "path";
import { describe, it, expect } from "vitest";
import { parseCsv } from "../csv-parser";

const fixtureRaw = readFileSync(
  join(__dirname, "../account_analytics_content_2026-02-14_2026-02-27-2.csv"),
  "utf-8"
);

describe("parseCsv", () => {
  it("parses totalPosts correctly", () => {
    const result = parseCsv(fixtureRaw);
    // 178 lines total - 1 header = 177 data rows, but CSV has a trailing newline so wc -l shows 178
    expect(result.totalPosts).toBe(178);
  });

  it("parses dateRange from first and last rows", () => {
    const result = parseCsv(fixtureRaw);
    expect(result.dateRange.to).toContain("Feb 27");
    expect(result.dateRange.from).toContain("Feb 14");
  });

  it("calculates avgImpressions as a positive number", () => {
    const result = parseCsv(fixtureRaw);
    expect(result.avgImpressions).toBeGreaterThan(0);
  });

  it("maxImpressions >= avgImpressions", () => {
    const result = parseCsv(fixtureRaw);
    expect(result.maxImpressions).toBeGreaterThanOrEqual(result.avgImpressions);
  });

  it("returns 5 topPosts sorted by impressions descending", () => {
    const result = parseCsv(fixtureRaw);
    expect(result.topPosts).toHaveLength(5);
    for (let i = 1; i < result.topPosts.length; i++) {
      expect(result.topPosts[i - 1].impressions).toBeGreaterThanOrEqual(
        result.topPosts[i].impressions
      );
    }
  });

  it("avgEngagementRate is between 0 and 100", () => {
    const result = parseCsv(fixtureRaw);
    expect(result.avgEngagementRate).toBeGreaterThanOrEqual(0);
    expect(result.avgEngagementRate).toBeLessThanOrEqual(100);
  });

  it("throws on empty CSV", () => {
    expect(() => parseCsv("")).toThrow();
  });

  it("throws on header-only CSV", () => {
    expect(() =>
      parseCsv(
        "Post id,Date,Post text,Post Link,Impressions,Likes,Engagements,Bookmarks,Shares,New follows,Replies,Reposts,Profile visits,Detail Expands,URL Clicks,Hashtag Clicks,Permalink Clicks"
      )
    ).toThrow();
  });
});
