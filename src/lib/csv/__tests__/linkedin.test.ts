import { describe, it, expect } from "vitest";
import {
  detectLinkedInCsvKind,
  LinkedInCsvError,
  parseLinkedInContentRows,
  parseLinkedInFollowersRows,
} from "../linkedin";

// ADR-008 Phase 3 — parser contract tests.
//
// LinkedIn's CSV export is a security-sensitive boundary: the input
// comes from a user-downloaded file that could have been tampered with.
// These tests lock the hardening rules: URL whitelist, formula-injection
// stripping, fail-loud on renamed columns.

const CONTENT_HEADERS =
  "Post URL,Post title,Post publish date,Post type,Impressions,Reactions,Comments,Reposts,Clicks,Shares,Video views";

const FOLLOWERS_HEADERS = "Date,Total followers,Organic followers,Sponsored followers";

function contentRow(opts: Partial<Record<string, string>> = {}) {
  const defaults: Record<string, string> = {
    "Post URL": "https://www.linkedin.com/feed/update/urn:li:activity:1234567890/",
    "Post title": "hello",
    "Post publish date": "2026-04-10",
    "Post type": "Post",
    Impressions: "1000",
    Reactions: "50",
    Comments: "5",
    Reposts: "2",
    Clicks: "20",
    Shares: "1",
    "Video views": "0",
    ...opts,
  };
  return [
    defaults["Post URL"],
    defaults["Post title"],
    defaults["Post publish date"],
    defaults["Post type"],
    defaults["Impressions"],
    defaults["Reactions"],
    defaults["Comments"],
    defaults["Reposts"],
    defaults["Clicks"],
    defaults["Shares"],
    defaults["Video views"],
  ].join(",");
}

describe("detectLinkedInCsvKind", () => {
  it("detects content export by Post URL header", () => {
    expect(detectLinkedInCsvKind(`${CONTENT_HEADERS}\n${contentRow()}`)).toBe("content");
  });

  it("detects followers export by Total followers header", () => {
    expect(detectLinkedInCsvKind(`${FOLLOWERS_HEADERS}\n2026-04-10,1000,800,200`)).toBe(
      "followers"
    );
  });

  it("returns unknown for CSV with neither header", () => {
    expect(detectLinkedInCsvKind("Foo,Bar\n1,2")).toBe("unknown");
  });

  it("throws on ambiguous CSV that contains both headers", () => {
    expect(() =>
      detectLinkedInCsvKind("Post URL,Total followers\nhttps://www.linkedin.com/x,1")
    ).toThrow(LinkedInCsvError);
  });
});

describe("parseLinkedInContentRows", () => {
  it("extracts URN from the canonical URL shape", () => {
    const rows = parseLinkedInContentRows(`${CONTENT_HEADERS}\n${contentRow()}`);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.externalPostId).toBe("urn:li:activity:1234567890");
    expect(rows[0]!.impressions).toBe(1000);
    expect(rows[0]!.reactions).toBe(50);
    expect(rows[0]!.postType).toBe("POST");
  });

  it("extracts URN from the pretty URL shape (-activity-<id>-)", () => {
    const row = contentRow({
      "Post URL": "https://www.linkedin.com/posts/user-name_foo-activity-987654321-abcd/",
    });
    const rows = parseLinkedInContentRows(`${CONTENT_HEADERS}\n${row}`);
    expect(rows[0]!.externalPostId).toBe("urn:li:activity:987654321");
  });

  it("rejects non-LinkedIn URLs (phishing defense)", () => {
    const row = contentRow({ "Post URL": "https://linkedln.com/feed/update/urn:li:activity:1/" });
    expect(() => parseLinkedInContentRows(`${CONTENT_HEADERS}\n${row}`)).toThrow(LinkedInCsvError);
  });

  it("rejects URL that doesn't contain a URN", () => {
    const row = contentRow({ "Post URL": "https://www.linkedin.com/feed/" });
    expect(() => parseLinkedInContentRows(`${CONTENT_HEADERS}\n${row}`)).toThrow(LinkedInCsvError);
  });

  it("throws on missing required column (LinkedIn renamed the export)", () => {
    const headers = "Post URL,Post title,Post publish date,Post type,Impressions"; // missing Reactions, Comments, Reposts, Clicks
    const body = `${headers}\nhttps://www.linkedin.com/feed/update/urn:li:activity:1/,t,2026-04-10,Post,100`;
    expect(() => parseLinkedInContentRows(body)).toThrow(LinkedInCsvError);
  });

  it("strips CSV formula injection from text cells", () => {
    const row = contentRow({ "Post title": "=cmd|' /C calc'!A0" });
    const rows = parseLinkedInContentRows(`${CONTENT_HEADERS}\n${row}`);
    expect(rows[0]!.text.startsWith("'")).toBe(true);
  });

  it("maps Post type strings to the three enum values", () => {
    const body = [
      CONTENT_HEADERS,
      contentRow({
        "Post URL": "https://www.linkedin.com/feed/update/urn:li:activity:1/",
        "Post type": "Article",
      }),
      contentRow({
        "Post URL": "https://www.linkedin.com/feed/update/urn:li:activity:2/",
        "Post type": "Reshare",
      }),
      contentRow({
        "Post URL": "https://www.linkedin.com/feed/update/urn:li:activity:3/",
        "Post type": "Post",
      }),
    ].join("\n");
    const rows = parseLinkedInContentRows(body);
    expect(rows.map((r) => r.postType)).toEqual(["ARTICLE", "REPOST", "POST"]);
  });

  it("parses numbers with comma thousand-separators when quoted", () => {
    // `12,345` must be quoted inside a CSV cell — otherwise RFC 4180 treats
    // the comma as a field delimiter and the number collapses to 12.
    const row = contentRow({ Impressions: '"12,345"' });
    const rows = parseLinkedInContentRows(`${CONTENT_HEADERS}\n${row}`);
    expect(rows[0]!.impressions).toBe(12345);
  });

  it("throws on unparseable date", () => {
    const row = contentRow({ "Post publish date": "not-a-date" });
    expect(() => parseLinkedInContentRows(`${CONTENT_HEADERS}\n${row}`)).toThrow(LinkedInCsvError);
  });
});

describe("parseLinkedInFollowersRows", () => {
  it("parses followers rows in chronological order regardless of input order", () => {
    const body = [FOLLOWERS_HEADERS, "2026-04-11,1010,810,200", "2026-04-10,1000,800,200"].join(
      "\n"
    );
    const rows = parseLinkedInFollowersRows(body);
    expect(rows).toHaveLength(2);
    // Parser preserves order; sorting is the caller's job (server action).
    expect(rows[0]!.followersCount).toBe(1010);
    expect(rows[1]!.followersCount).toBe(1000);
  });

  it("throws on missing Total followers column", () => {
    const body = "Date,Some other column\n2026-04-10,123";
    expect(() => parseLinkedInFollowersRows(body)).toThrow(LinkedInCsvError);
  });

  it("throws on unparseable date", () => {
    const body = `${FOLLOWERS_HEADERS}\nnot-a-date,1000,800,200`;
    expect(() => parseLinkedInFollowersRows(body)).toThrow(LinkedInCsvError);
  });
});
