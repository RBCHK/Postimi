import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parseLinkedInXlsx, extractLinkedInPostId, LinkedInXlsxError } from "../linkedin";

const WEEKLY_PATH = path.join(process.cwd(), "tests/fixtures/linkedin/sample-weekly.xlsx");
const QUARTERLY_PATH = path.join(process.cwd(), "tests/fixtures/linkedin/sample-quarterly.xlsx");

function loadBuffer(p: string): ArrayBuffer {
  const buf = fs.readFileSync(p);
  // `Buffer` shares its underlying memory with other slices — pass a fresh
  // copy so exceljs can't mutate the fixture.
  const ab = new ArrayBuffer(buf.byteLength);
  new Uint8Array(ab).set(buf);
  return ab;
}

describe("extractLinkedInPostId", () => {
  it("extracts activity ID from share URL", () => {
    expect(
      extractLinkedInPostId(
        "https://www.linkedin.com/posts/test-user_ai-demo-share-1000000000000000001-AAAA"
      )
    ).toBe("1000000000000000001");
  });

  it("extracts activity ID from ugcPost URL", () => {
    expect(
      extractLinkedInPostId(
        "https://www.linkedin.com/posts/test-user_vanjs-demo-ugcPost-1000000000000000002-BBBB"
      )
    ).toBe("1000000000000000002");
  });

  it("returns null on unparseable URL so caller can fall back to full URL", () => {
    // Fallback path prevents silent data loss if LinkedIn ever changes the
    // slug format. See ADR-008.
    expect(
      extractLinkedInPostId("https://linkedin.com/feed/update/urn:li:activity:123")
    ).toBeNull();
    expect(extractLinkedInPostId("not a url")).toBeNull();
  });
});

describe("parseLinkedInXlsx — weekly fixture", () => {
  it("parses all five sheets", async () => {
    const buf = loadBuffer(WEEKLY_PATH);
    const parsed = await parseLinkedInXlsx(buf);

    expect(parsed.discovery.windowStart.toISOString()).toBe("2026-04-13T00:00:00.000Z");
    expect(parsed.discovery.windowEnd.toISOString()).toBe("2026-04-19T00:00:00.000Z");
    expect(parsed.discovery.impressions).toBe(30);
    expect(parsed.discovery.membersReached).toBe(9);

    expect(parsed.engagement).toHaveLength(7);
    expect(parsed.engagement[0]).toEqual({
      date: new Date("2026-04-13T00:00:00.000Z"),
      impressions: 0,
      engagements: 0,
    });
    expect(parsed.engagement[1].impressions).toBe(14);

    // Only right table populated in the weekly fixture.
    expect(parsed.topPosts).toHaveLength(3);
    const firstPost = parsed.topPosts[0];
    expect(firstPost.externalPostId).toBe("1000000000000000001");
    expect(firstPost.impressions).toBe(14);
    expect(firstPost.engagements).toBe(0);
    expect(firstPost.postType).toBe("POST");

    expect(parsed.exportDate.toISOString()).toBe("2026-04-19T00:00:00.000Z");
    expect(parsed.exportTotalFollowers).toBe(1531);
    expect(parsed.followers).toHaveLength(7);
    // Walking backwards: total=1531 on 4/19; 4/16 had +3; so 4/15 = 1528.
    const byDate = Object.fromEntries(
      parsed.followers.map((r) => [r.date.toISOString().slice(0, 10), r])
    );
    expect(byDate["2026-04-19"].followersCount).toBe(1531);
    expect(byDate["2026-04-18"].followersCount).toBe(1531);
    expect(byDate["2026-04-16"].followersCount).toBe(1531);
    expect(byDate["2026-04-16"].deltaFollowers).toBe(3);
    expect(byDate["2026-04-15"].followersCount).toBe(1528);
    expect(byDate["2026-04-13"].followersCount).toBe(1528);

    expect(parsed.demographics.length).toBeGreaterThan(0);
    expect(parsed.demographics[0]).toMatchObject({
      category: "Company",
      value: "Company A",
      percentage: "1%",
    });
  });
});

describe("parseLinkedInXlsx — quarterly fixture", () => {
  it("dedupes top posts that appear on both engagement and impression sides", async () => {
    const buf = loadBuffer(QUARTERLY_PATH);
    const parsed = await parseLinkedInXlsx(buf);

    // The `share-1000000000000000001` URL appears on both sides. Parser
    // should merge to a single row keeping both metrics.
    const merged = parsed.topPosts.find((p) => p.externalPostId === "1000000000000000001");
    expect(merged).toBeDefined();
    expect(merged!.engagements).toBe(19);
    expect(merged!.impressions).toBe(5993);

    // Right-side-only posts keep impressions and 0 engagements.
    const rightOnly = parsed.topPosts.find((p) => p.externalPostId === "1000000000000000002");
    expect(rightOnly).toBeDefined();
    expect(rightOnly!.impressions).toBe(435);
    expect(rightOnly!.engagements).toBe(0);

    // Total top posts = 4 unique URLs across both sides (merged count = 1).
    expect(parsed.topPosts).toHaveLength(4);
  });

  it("parses 90 days of engagement and follower rows", async () => {
    const parsed = await parseLinkedInXlsx(loadBuffer(QUARTERLY_PATH));
    expect(parsed.engagement).toHaveLength(90);
    expect(parsed.followers).toHaveLength(90);
    // Cumulative count at the last day must equal the exported total.
    const last = parsed.followers[parsed.followers.length - 1];
    expect(last.followersCount).toBe(1531);
  });
});

describe("parseLinkedInXlsx — error handling", () => {
  it("rejects invalid xlsx bytes", async () => {
    const buf = new TextEncoder().encode("not an xlsx").buffer as ArrayBuffer;
    await expect(parseLinkedInXlsx(buf)).rejects.toThrow(LinkedInXlsxError);
  });

  it("rejects a valid xlsx missing required sheets", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("NOT WHAT WE WANT");
    const buf = await wb.xlsx.writeBuffer();
    await expect(parseLinkedInXlsx(buf as ArrayBuffer)).rejects.toThrow(/Missing required sheet/);
  });

  it("rejects a malformed date cell instead of silently coercing", async () => {
    // If LinkedIn ever changes the date format we want to fail loud rather
    // than storing a wrong date (e.g. if they switch to DD/MM/YYYY, 1/4/2026
    // would silently parse as Jan 4 instead of Apr 1).
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const disc = wb.addWorksheet("DISCOVERY");
    disc.getCell("A1").value = "Overall Performance";
    disc.getCell("B1").value = "2026-04-13 - 2026-04-19"; // ISO instead of M/D/YYYY
    disc.getCell("A2").value = "Impressions";
    disc.getCell("B2").value = "0";
    disc.getCell("A3").value = "Members reached";
    disc.getCell("B3").value = "0";
    // Stubs for other required sheets so the DISCOVERY parser is reached first.
    wb.addWorksheet("ENGAGEMENT").getCell("A1").value = "Date";
    wb.getWorksheet("ENGAGEMENT")!.getCell("B1").value = "Impressions";
    wb.getWorksheet("ENGAGEMENT")!.getCell("C1").value = "Engagements";
    wb.addWorksheet("TOP POSTS");
    wb.addWorksheet("FOLLOWERS");
    wb.addWorksheet("DEMOGRAPHICS");
    const buf = await wb.xlsx.writeBuffer();
    await expect(parseLinkedInXlsx(buf as ArrayBuffer)).rejects.toThrow(/not a date range/);
  });
});
