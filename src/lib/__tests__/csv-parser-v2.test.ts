import { readFileSync } from "fs";
import { join } from "path";
import { describe, it, expect } from "vitest";
import { detectCsvType, parseContentCsvRows, parseOverviewCsvRows } from "../csv-parser";

const contentFixture = readFileSync(
  join(__dirname, "../account_analytics_content_2026-02-14_2026-02-27-2.csv"),
  "utf-8"
);

// Minimal overview CSV fixture for testing
const overviewFixture = `Date,Impressions,Likes,Engagements,Bookmarks,Shares,New follows,Unfollows,Replies,Reposts,Profile visits,Create Post,Video views,Media views
"Tue, Mar 10, 2026",2871,24,43,0,1,0,2,1,1,2,2,0,0
"Mon, Mar 9, 2026",2199,12,26,0,0,0,0,2,0,0,2,0,0
"Sun, Mar 8, 2026",336,2,15,0,0,0,0,2,0,1,1,0,0`;

describe("detectCsvType", () => {
  it("detects content CSV by 'Post text' column", () => {
    expect(detectCsvType(contentFixture)).toBe("content");
  });

  it("detects overview CSV by 'Unfollows' column", () => {
    expect(detectCsvType(overviewFixture)).toBe("overview");
  });

  it("throws on unrecognized format", () => {
    expect(() => detectCsvType("Name,Age\nJohn,30")).toThrow("Unrecognized CSV format");
  });
});

describe("parseContentCsvRows", () => {
  it("parses all rows from fixture", () => {
    const rows = parseContentCsvRows(contentFixture);
    expect(rows.length).toBe(178);
  });

  it("extracts post ID from Post Link URL", () => {
    const rows = parseContentCsvRows(contentFixture);
    expect(rows[0].postId).toBe("2027324435158704495");
  });

  it("detects replies by @ prefix in text", () => {
    const rows = parseContentCsvRows(contentFixture);
    const replies = rows.filter((r) => r.postType === "Reply");
    const posts = rows.filter((r) => r.postType === "Post");
    expect(replies.length).toBeGreaterThan(0);
    expect(posts.length).toBeGreaterThan(0);
    // Most content for a small account is replies
    expect(replies.length).toBeGreaterThan(posts.length);
  });

  it("reply text starts with @", () => {
    const rows = parseContentCsvRows(contentFixture);
    const replies = rows.filter((r) => r.postType === "Reply");
    for (const reply of replies) {
      expect(reply.text.trimStart().startsWith("@")).toBe(true);
    }
  });

  it("post text does not start with @", () => {
    const rows = parseContentCsvRows(contentFixture);
    const posts = rows.filter((r) => r.postType === "Post");
    for (const post of posts) {
      expect(post.text.trimStart().startsWith("@")).toBe(false);
    }
  });

  it("parses numeric fields correctly", () => {
    const rows = parseContentCsvRows(contentFixture);
    for (const row of rows) {
      expect(row.impressions).toBeGreaterThanOrEqual(0);
      expect(row.likes).toBeGreaterThanOrEqual(0);
      expect(row.engagements).toBeGreaterThanOrEqual(0);
    }
  });

  it("includes postLink for each row", () => {
    const rows = parseContentCsvRows(contentFixture);
    for (const row of rows) {
      expect(row.postLink).toContain("https://x.com/");
    }
  });

  it("throws on empty CSV", () => {
    expect(() => parseContentCsvRows("")).toThrow();
  });
});

describe("parseOverviewCsvRows", () => {
  it("parses all rows from fixture", () => {
    const rows = parseOverviewCsvRows(overviewFixture);
    expect(rows.length).toBe(3);
  });

  it("parses dates correctly", () => {
    const rows = parseOverviewCsvRows(overviewFixture);
    expect(rows[0].date).toContain("Mar 10");
  });

  it("parses newFollows and unfollows", () => {
    const rows = parseOverviewCsvRows(overviewFixture);
    const totalUnfollows = rows.reduce((s, r) => s + r.unfollows, 0);
    expect(totalUnfollows).toBe(2); // only first row has 2 unfollows
  });

  it("parses all numeric fields", () => {
    const rows = parseOverviewCsvRows(overviewFixture);
    expect(rows[0].impressions).toBe(2871);
    expect(rows[0].likes).toBe(24);
    expect(rows[0].engagements).toBe(43);
    expect(rows[0].profileVisits).toBe(2);
    expect(rows[0].createPost).toBe(2);
  });

  it("throws on empty CSV", () => {
    expect(() => parseOverviewCsvRows("")).toThrow();
  });
});
