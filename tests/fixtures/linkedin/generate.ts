// Generates deterministic synthetic LinkedIn Aggregate Analytics xlsx
// fixtures. These exist to:
//   1. Keep tests deterministic and PII-free — never commit real user
//      exports.
//   2. Exercise edge cases the real exports happen not to contain
//      (overlapping top-posts rows, negative-delta followers, multi-month
//      window, blank left-side TOP POSTS).
//
// Run:  npx tsx tests/fixtures/linkedin/generate.ts
// Output: tests/fixtures/linkedin/sample-weekly.xlsx + sample-quarterly.xlsx

import ExcelJS from "exceljs";
import path from "node:path";

const OUT_DIR = path.join(process.cwd(), "tests/fixtures/linkedin");

interface FixtureSpec {
  filename: string;
  windowStart: string; // M/D/YYYY
  windowEnd: string;
  totalImpressions: number;
  membersReached: number;
  engagement: Array<[string, number, number]>; // [date, impressions, engagements]
  topPostsLeft: Array<[string, string, number]>; // [url, pubDate, engagements]
  topPostsRight: Array<[string, string, number]>; // [url, pubDate, impressions]
  exportDate: string;
  totalFollowers: number;
  followerDeltas: Array<[string, number]>; // [date, newFollowers]
  demographics: Array<[string, string, string]>; // [category, value, percentage]
}

const WEEKLY: FixtureSpec = {
  filename: "sample-weekly.xlsx",
  windowStart: "4/13/2026",
  windowEnd: "4/19/2026",
  totalImpressions: 30,
  membersReached: 9,
  engagement: [
    ["4/13/2026", 0, 0],
    ["4/14/2026", 14, 0],
    ["4/15/2026", 0, 0],
    ["4/16/2026", 4, 0],
    ["4/17/2026", 8, 0],
    ["4/18/2026", 0, 0],
    ["4/19/2026", 4, 0],
  ],
  // Weekly window: only right side populated (like the real weekly export).
  topPostsLeft: [],
  topPostsRight: [
    [
      "https://www.linkedin.com/posts/test-user_ai-demo-share-1000000000000000001-AAAA",
      "2/20/2026",
      14,
    ],
    [
      "https://www.linkedin.com/posts/test-user_vanjs-demo-ugcPost-1000000000000000002-BBBB",
      "7/18/2025",
      4,
    ],
    [
      "https://www.linkedin.com/posts/test-user_agentcon-demo-ugcPost-1000000000000000003-CCCC",
      "12/13/2025",
      4,
    ],
  ],
  exportDate: "4/19/2026",
  totalFollowers: 1531,
  followerDeltas: [
    ["4/13/2026", 0],
    ["4/14/2026", 0],
    ["4/15/2026", 0],
    ["4/16/2026", 3],
    ["4/17/2026", 0],
    ["4/18/2026", 0],
    ["4/19/2026", 0],
  ],
  demographics: [
    ["Company", "Company A", "1%"],
    ["Company", "Company B", "< 1%"],
    ["Location", "Region X", "27%"],
    ["Location", "Region Y", "7%"],
    ["Company size", "11-50 employees", "18%"],
    ["Seniority", "Senior", "33%"],
    ["Seniority", "Entry", "27%"],
    ["Job title", "Software Engineer", "4%"],
    ["Industry", "Information Technology", "42%"],
  ],
};

const QUARTERLY: FixtureSpec = {
  filename: "sample-quarterly.xlsx",
  windowStart: "1/20/2026",
  windowEnd: "4/19/2026",
  totalImpressions: 7090,
  membersReached: 4025,
  engagement: generateEngagement("1/20/2026", 90),
  // Quarterly window: both sides populated, overlap on row 4 to exercise
  // the merge-by-url path.
  topPostsLeft: [
    [
      "https://www.linkedin.com/posts/test-user_ai-demo-share-1000000000000000001-AAAA",
      "2/20/2026",
      19,
    ],
  ],
  topPostsRight: [
    [
      "https://www.linkedin.com/posts/test-user_ai-demo-share-1000000000000000001-AAAA",
      "2/20/2026",
      5993,
    ],
    [
      "https://www.linkedin.com/posts/test-user_vanjs-demo-ugcPost-1000000000000000002-BBBB",
      "7/18/2025",
      435,
    ],
    [
      "https://www.linkedin.com/posts/test-user_aws-ugcPost-1000000000000000004-DDDD",
      "10/26/2025",
      73,
    ],
    [
      "https://www.linkedin.com/posts/test-user_agentcon-demo-ugcPost-1000000000000000003-CCCC",
      "12/13/2025",
      61,
    ],
  ],
  exportDate: "4/19/2026",
  totalFollowers: 1531,
  followerDeltas: generateFollowerDeltas("1/20/2026", 90),
  demographics: [
    ["Company", "Company A", "1%"],
    ["Location", "Region X", "27%"],
    ["Company size", "11-50 employees", "18%"],
    ["Seniority", "Senior", "33%"],
    ["Job title", "Software Engineer", "4%"],
    ["Industry", "Information Technology", "42%"],
  ],
};

function generateEngagement(start: string, days: number): Array<[string, number, number]> {
  const out: Array<[string, number, number]> = [];
  const base = parseDateStr(start);
  for (let i = 0; i < days; i++) {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() + i);
    const str = `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`;
    // Deterministic pseudo-random impressions, engagements mostly 0.
    const imp = (i * 37 + 11) % 100;
    const eng = i % 30 === 0 && i > 0 ? (i / 30) * 3 : 0;
    out.push([str, imp, eng]);
  }
  return out;
}

function generateFollowerDeltas(start: string, days: number): Array<[string, number]> {
  const out: Array<[string, number]> = [];
  const base = parseDateStr(start);
  for (let i = 0; i < days; i++) {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() + i);
    const str = `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`;
    // Sparse gains: 0 most days, occasional 1-3.
    const delta = i % 7 === 0 ? 2 : i % 11 === 0 ? 1 : 0;
    out.push([str, delta]);
  }
  return out;
}

function parseDateStr(s: string): Date {
  const [m, d, y] = s.split("/").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

async function buildFixture(spec: FixtureSpec): Promise<void> {
  const wb = new ExcelJS.Workbook();

  // DISCOVERY
  const discovery = wb.addWorksheet("DISCOVERY");
  discovery.getCell("A1").value = "Overall Performance";
  discovery.getCell("B1").value = `${spec.windowStart} - ${spec.windowEnd}`;
  discovery.getCell("A2").value = "Impressions";
  discovery.getCell("B2").value = String(spec.totalImpressions);
  discovery.getCell("A3").value = "Members reached";
  discovery.getCell("B3").value = String(spec.membersReached);

  // ENGAGEMENT
  const engagement = wb.addWorksheet("ENGAGEMENT");
  engagement.getCell("A1").value = "Date";
  engagement.getCell("B1").value = "Impressions";
  engagement.getCell("C1").value = "Engagements";
  spec.engagement.forEach(([d, imp, eng], i) => {
    const r = i + 2;
    engagement.getCell(`A${r}`).value = d;
    engagement.getCell(`B${r}`).value = String(imp);
    engagement.getCell(`C${r}`).value = String(eng);
  });

  // TOP POSTS
  const topPosts = wb.addWorksheet("TOP POSTS");
  topPosts.getCell("A1").value = "Maximum of 50 posts available to include in this list";
  topPosts.getCell("A3").value = "Post URL";
  topPosts.getCell("B3").value = "Post Publish Date";
  topPosts.getCell("C3").value = "Engagements";
  topPosts.getCell("E3").value = "Post URL";
  topPosts.getCell("F3").value = "Post Publish Date";
  topPosts.getCell("G3").value = "Impressions";
  const maxRows = Math.max(spec.topPostsLeft.length, spec.topPostsRight.length);
  for (let i = 0; i < maxRows; i++) {
    const r = i + 4;
    if (i < spec.topPostsLeft.length) {
      const [url, date, eng] = spec.topPostsLeft[i];
      topPosts.getCell(`A${r}`).value = url;
      topPosts.getCell(`B${r}`).value = date;
      topPosts.getCell(`C${r}`).value = String(eng);
    }
    if (i < spec.topPostsRight.length) {
      const [url, date, imp] = spec.topPostsRight[i];
      topPosts.getCell(`E${r}`).value = url;
      topPosts.getCell(`F${r}`).value = date;
      topPosts.getCell(`G${r}`).value = String(imp);
    }
  }

  // FOLLOWERS
  const followers = wb.addWorksheet("FOLLOWERS");
  followers.getCell("A1").value = `Total followers on ${spec.exportDate}`;
  followers.getCell("B1").value = String(spec.totalFollowers);
  followers.getCell("A3").value = "Date";
  followers.getCell("B3").value = "New followers";
  spec.followerDeltas.forEach(([d, n], i) => {
    const r = i + 4;
    followers.getCell(`A${r}`).value = d;
    followers.getCell(`B${r}`).value = String(n);
  });

  // DEMOGRAPHICS
  const demographics = wb.addWorksheet("DEMOGRAPHICS");
  demographics.getCell("A1").value = "Top Demographics";
  demographics.getCell("B1").value = "Value";
  demographics.getCell("C1").value = "Percentage";
  spec.demographics.forEach(([cat, val, pct], i) => {
    const r = i + 2;
    demographics.getCell(`A${r}`).value = cat;
    demographics.getCell(`B${r}`).value = val;
    demographics.getCell(`C${r}`).value = pct;
  });

  const outPath = path.join(OUT_DIR, spec.filename);
  await wb.xlsx.writeFile(outPath);
  console.log(`wrote ${outPath}`);
}

async function main() {
  await buildFixture(WEEKLY);
  await buildFixture(QUARTERLY);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
