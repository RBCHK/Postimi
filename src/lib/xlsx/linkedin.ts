// LinkedIn Aggregate Analytics xlsx parser.
//
// LinkedIn's Creator Analytics export is a single xlsx with five sheets:
//
//   1. DISCOVERY    — aggregate totals for the window
//   2. ENGAGEMENT   — daily impressions + engagements time series
//   3. TOP POSTS    — two side-by-side tables: top-50 by engagements (cols
//                     A–C) and top-50 by impressions (cols E–G). A post that
//                     makes both tables appears twice; we dedupe by URL.
//   4. FOLLOWERS    — header row with total-as-of-export-date, then daily
//                     "new followers" deltas (not cumulative counts).
//   5. DEMOGRAPHICS — category/value/percentage rows. Phase 3.1 parses but
//                     does NOT persist; add SocialDemographicsSnapshot later
//                     if the Strategist needs it.
//
// LinkedIn emits the file as real xlsx (not CSV despite what the per-post
// ingestion code originally assumed). Numbers are stored as **strings** in
// most cells, so `parseNumber` coercion is mandatory. Dates come as
// "M/D/YYYY" strings; openpyxl/exceljs do not auto-convert them to Date
// objects because LinkedIn writes them as text cells.
//
// Security: exceljs does not evaluate formulas at parse time, so formula
// injection via `<f>` is not a vector here. We still strip formula-ish
// prefixes from the post text field to keep user-exported re-shares safe
// if someone copies the DB row into a spreadsheet (defense in depth).

import ExcelJS from "exceljs";
import { parseNumber, stripFormulaInjection } from "@/lib/csv/primitives";

// ─── Errors ──────────────────────────────────────────────

export class LinkedInXlsxError extends Error {
  constructor(
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "LinkedInXlsxError";
  }
}

// ─── Parsed sheet types ──────────────────────────────────

export interface DiscoveryTotals {
  windowStart: Date;
  windowEnd: Date;
  impressions: number;
  membersReached: number;
}

export interface EngagementRow {
  date: Date; // UTC midnight
  impressions: number;
  engagements: number;
}

export interface TopPostRow {
  postUrl: string;
  externalPostId: string;
  publishedAt: Date;
  impressions: number; // 0 when the post only appears in the engagements column
  engagements: number; // 0 when the post only appears in the impressions column
  postType: "POST" | "REPOST" | "ARTICLE";
}

export interface FollowersRow {
  date: Date;
  followersCount: number; // walked backwards from the exported total
  deltaFollowers: number; // LinkedIn's "new followers" — can be negative if LinkedIn ever exposes losses (currently always ≥ 0)
}

export interface DemographicsRow {
  category: string;
  value: string;
  percentage: string;
}

export interface LinkedInXlsxParse {
  discovery: DiscoveryTotals;
  engagement: EngagementRow[];
  topPosts: TopPostRow[];
  followers: FollowersRow[];
  demographics: DemographicsRow[]; // parsed but not persisted in Phase 3.1
  exportTotalFollowers: number;
  exportDate: Date;
}

// ─── Cell helpers ────────────────────────────────────────

function cellString(cell: ExcelJS.Cell | undefined): string {
  if (!cell) return "";
  const v = cell.value;
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v);
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object" && "richText" in v) {
    return (v.richText as Array<{ text: string }>).map((r) => r.text).join("");
  }
  if (typeof v === "object" && "text" in v) return String(v.text);
  return String(v);
}

function cellNumber(cell: ExcelJS.Cell | undefined): number {
  if (!cell) return 0;
  const v = cell.value;
  if (typeof v === "number") return v;
  return parseNumber(cellString(cell));
}

/**
 * Parse LinkedIn's "M/D/YYYY" date format into a UTC midnight Date. Refuses
 * ambiguous inputs: if the month/day can't be determined, throws. We don't
 * fall back to `new Date(str)` because V8's parser interprets "1/2/2026" as
 * January 2 (US), which happens to match LinkedIn's format — but relying on
 * that coincidence is fragile.
 */
function parseLinkedInDate(raw: string): Date {
  const trimmed = raw.trim();
  const m = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) {
    throw new LinkedInXlsxError(`Unrecognized date format: "${trimmed}"`, { raw: trimmed });
  }
  const month = parseInt(m[1], 10);
  const day = parseInt(m[2], 10);
  const year = parseInt(m[3], 10);
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 2000 || year > 2100) {
    throw new LinkedInXlsxError(`Date out of range: "${trimmed}"`, { raw: trimmed });
  }
  return new Date(Date.UTC(year, month - 1, day));
}

/**
 * Extract the permanent LinkedIn post ID from the post URL. LinkedIn URLs
 * look like
 *   `https://www.linkedin.com/posts/<slug>_<title-words>-(share|ugcPost)-<activityId>-<suffix>`
 * where `<activityId>` is a 15+ digit numeric ID that never changes. That's
 * what we want as `SocialPost.externalPostId`.
 *
 * Returns null if the URL doesn't match the expected shape (rare edge case;
 * the caller falls back to using the normalized URL itself).
 */
export function extractLinkedInPostId(url: string): string | null {
  const m = url.match(/-(share|ugcPost)-(\d{10,})-/);
  if (!m) return null;
  return m[2];
}

function linkedinPostTypeFromUrl(url: string): "POST" | "REPOST" | "ARTICLE" {
  if (url.includes("/pulse/")) return "ARTICLE";
  // LinkedIn xlsx doesn't distinguish reposts from regular posts in the
  // URL — both show up as `ugcPost` or `share`. Defaulting to "POST".
  return "POST";
}

// ─── Sheet parsers ───────────────────────────────────────

function parseDiscoverySheet(ws: ExcelJS.Worksheet): DiscoveryTotals {
  // R1: ['Overall Performance', 'M/D/YYYY - M/D/YYYY']
  // R2: ['Impressions', <number>]
  // R3: ['Members reached', <number>]
  const rangeRaw = cellString(ws.getCell("B1"));
  const rangeMatch = rangeRaw.match(/^(\d{1,2}\/\d{1,2}\/\d{4})\s*-\s*(\d{1,2}\/\d{1,2}\/\d{4})$/);
  if (!rangeMatch) {
    throw new LinkedInXlsxError(`DISCOVERY B1 not a date range: "${rangeRaw}"`, { raw: rangeRaw });
  }
  return {
    windowStart: parseLinkedInDate(rangeMatch[1]),
    windowEnd: parseLinkedInDate(rangeMatch[2]),
    impressions: cellNumber(ws.getCell("B2")),
    membersReached: cellNumber(ws.getCell("B3")),
  };
}

function parseEngagementSheet(ws: ExcelJS.Worksheet): EngagementRow[] {
  // R1: ['Date', 'Impressions', 'Engagements']
  const header = [
    cellString(ws.getCell("A1")),
    cellString(ws.getCell("B1")),
    cellString(ws.getCell("C1")),
  ];
  if (
    header[0].toLowerCase() !== "date" ||
    !/impressions/i.test(header[1]) ||
    !/engagements/i.test(header[2])
  ) {
    throw new LinkedInXlsxError(`ENGAGEMENT header unexpected: ${JSON.stringify(header)}`);
  }
  const out: EngagementRow[] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const dateRaw = cellString(ws.getCell(`A${r}`));
    if (!dateRaw) continue;
    out.push({
      date: parseLinkedInDate(dateRaw),
      impressions: cellNumber(ws.getCell(`B${r}`)),
      engagements: cellNumber(ws.getCell(`C${r}`)),
    });
  }
  return out;
}

function parseTopPostsSheet(ws: ExcelJS.Worksheet): TopPostRow[] {
  // R1: info banner. R2: blank. R3: header row.
  //   Left table (cols A-C): Post URL | Post Publish Date | Engagements
  //   Col D: spacer.
  //   Right table (cols E-G): Post URL | Post Publish Date | Impressions
  // R4+: data. Each side can be independently empty.
  const leftHeader = cellString(ws.getCell("A3")).toLowerCase();
  const rightHeader = cellString(ws.getCell("E3")).toLowerCase();
  if (!leftHeader.includes("post url") || !rightHeader.includes("post url")) {
    throw new LinkedInXlsxError(
      `TOP POSTS headers unexpected: A3="${cellString(ws.getCell("A3"))}" E3="${cellString(ws.getCell("E3"))}"`
    );
  }

  const byUrl = new Map<string, TopPostRow>();

  for (let r = 4; r <= ws.rowCount; r++) {
    // Left side: engagements
    const leftUrl = cellString(ws.getCell(`A${r}`));
    if (leftUrl) {
      addTopPost(byUrl, {
        postUrl: leftUrl,
        publishDateRaw: cellString(ws.getCell(`B${r}`)),
        engagements: cellNumber(ws.getCell(`C${r}`)),
        impressions: 0,
      });
    }
    // Right side: impressions
    const rightUrl = cellString(ws.getCell(`E${r}`));
    if (rightUrl) {
      addTopPost(byUrl, {
        postUrl: rightUrl,
        publishDateRaw: cellString(ws.getCell(`F${r}`)),
        engagements: 0,
        impressions: cellNumber(ws.getCell(`G${r}`)),
      });
    }
  }

  return [...byUrl.values()];
}

function addTopPost(
  byUrl: Map<string, TopPostRow>,
  incoming: { postUrl: string; publishDateRaw: string; engagements: number; impressions: number }
) {
  const url = incoming.postUrl.trim();
  const existing = byUrl.get(url);
  if (existing) {
    // Merge: same post on both sides. Take the larger of each metric since
    // LinkedIn's two tables are independent rankings and one is sometimes
    // zero-padded when the post barely made the cutoff on that side.
    existing.engagements = Math.max(existing.engagements, incoming.engagements);
    existing.impressions = Math.max(existing.impressions, incoming.impressions);
    return;
  }
  byUrl.set(url, {
    postUrl: url,
    externalPostId: extractLinkedInPostId(url) ?? url,
    publishedAt: parseLinkedInDate(incoming.publishDateRaw),
    engagements: incoming.engagements,
    impressions: incoming.impressions,
    postType: linkedinPostTypeFromUrl(url),
  });
}

interface FollowersParseResult {
  rows: FollowersRow[];
  exportTotalFollowers: number;
  exportDate: Date;
}

function parseFollowersSheet(ws: ExcelJS.Worksheet): FollowersParseResult {
  // R1: ['Total followers on M/D/YYYY', <total>]
  // R2: blank
  // R3: ['Date', 'New followers']
  // R4+: daily deltas
  const totalLabel = cellString(ws.getCell("A1"));
  const totalMatch = totalLabel.match(/on\s+(\d{1,2}\/\d{1,2}\/\d{4})/);
  if (!totalMatch) {
    throw new LinkedInXlsxError(`FOLLOWERS A1 missing export date: "${totalLabel}"`);
  }
  const exportDate = parseLinkedInDate(totalMatch[1]);
  const exportTotalFollowers = cellNumber(ws.getCell("B1"));

  const header = [cellString(ws.getCell("A3")), cellString(ws.getCell("B3"))];
  if (header[0].toLowerCase() !== "date" || !/new\s+followers/i.test(header[1])) {
    throw new LinkedInXlsxError(`FOLLOWERS R3 header unexpected: ${JSON.stringify(header)}`);
  }

  // Collect deltas in file order first.
  const deltas: Array<{ date: Date; delta: number }> = [];
  for (let r = 4; r <= ws.rowCount; r++) {
    const dateRaw = cellString(ws.getCell(`A${r}`));
    if (!dateRaw) continue;
    deltas.push({
      date: parseLinkedInDate(dateRaw),
      delta: cellNumber(ws.getCell(`B${r}`)),
    });
  }

  // Walk backwards from the exported total to derive per-day absolute
  // counts. The total represents end-of-day on `exportDate`, and the delta
  // on day D is the number of followers gained during day D. Therefore
  //   count[end-of-D-1] = count[end-of-D] - delta[D].
  // We sort ascending first so later code can rely on chronological order.
  deltas.sort((a, b) => a.date.getTime() - b.date.getTime());
  const rows: FollowersRow[] = new Array(deltas.length);
  let running = exportTotalFollowers;
  for (let i = deltas.length - 1; i >= 0; i--) {
    rows[i] = {
      date: deltas[i].date,
      followersCount: running,
      deltaFollowers: deltas[i].delta,
    };
    running -= deltas[i].delta;
    // The walk must never drive the running count below zero — follower
    // counts are non-negative by construction. A negative here means the
    // xlsx is internally inconsistent: either the export total is too low
    // relative to the deltas (truncated data), or LinkedIn is reporting
    // gains larger than the cumulative total (impossible under the spec).
    // Fail loud with the row index so an operator can inspect the file
    // rather than letting corrupt data leak into analytics.
    if (running < 0) {
      throw new LinkedInXlsxError(
        "Follower back-fill produced negative count — xlsx totals inconsistent",
        {
          rowIndex: i,
          running,
          delta: deltas[i].delta,
          date: deltas[i].date.toISOString(),
          exportTotalFollowers,
        }
      );
    }
  }

  return { rows, exportTotalFollowers, exportDate };
}

function parseDemographicsSheet(ws: ExcelJS.Worksheet): DemographicsRow[] {
  // R1: ['Top Demographics', 'Value', 'Percentage']
  const header = [
    cellString(ws.getCell("A1")),
    cellString(ws.getCell("B1")),
    cellString(ws.getCell("C1")),
  ];
  if (
    !/demographics/i.test(header[0]) ||
    header[1].toLowerCase() !== "value" ||
    !/percent/i.test(header[2])
  ) {
    throw new LinkedInXlsxError(`DEMOGRAPHICS header unexpected: ${JSON.stringify(header)}`);
  }
  const out: DemographicsRow[] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const category = cellString(ws.getCell(`A${r}`));
    if (!category) continue;
    out.push({
      category,
      value: stripFormulaInjection(cellString(ws.getCell(`B${r}`))),
      percentage: cellString(ws.getCell(`C${r}`)),
    });
  }
  return out;
}

// ─── Public entry point ──────────────────────────────────

/**
 * Parse a LinkedIn Aggregate Analytics xlsx file. Accepts the raw file as
 * an ArrayBuffer (what `File.arrayBuffer()` returns in a Server Action).
 *
 * Throws `LinkedInXlsxError` on any shape mismatch so the caller can
 * surface a specific error to the user instead of a generic 500.
 */
export async function parseLinkedInXlsx(buf: ArrayBuffer): Promise<LinkedInXlsxParse> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buf);
  } catch (err) {
    throw new LinkedInXlsxError("Not a valid xlsx file", {
      cause: err instanceof Error ? err.message : String(err),
    });
  }

  const required = ["DISCOVERY", "ENGAGEMENT", "TOP POSTS", "FOLLOWERS", "DEMOGRAPHICS"];
  for (const name of required) {
    if (!workbook.getWorksheet(name)) {
      throw new LinkedInXlsxError(`Missing required sheet: ${name}`, {
        sheets: workbook.worksheets.map((w) => w.name),
      });
    }
  }

  const discovery = parseDiscoverySheet(workbook.getWorksheet("DISCOVERY")!);
  const engagement = parseEngagementSheet(workbook.getWorksheet("ENGAGEMENT")!);
  const topPosts = parseTopPostsSheet(workbook.getWorksheet("TOP POSTS")!);
  const followersParse = parseFollowersSheet(workbook.getWorksheet("FOLLOWERS")!);
  const demographics = parseDemographicsSheet(workbook.getWorksheet("DEMOGRAPHICS")!);

  // Cross-check: engagement rows should fall inside the discovery window.
  // `parseLinkedInDate` only knows `M/D/YYYY` in isolation — it can't tell
  // a D/M/YYYY-formatted export apart. Here, at the aggregation site, we
  // have the window bounds and can detect a wholesale locale mismatch: if
  // more than half of engagement rows land outside [windowStart,windowEnd],
  // the file is almost certainly D/M/YYYY and every date has been
  // misinterpreted. Fail loud rather than poisoning analytics.
  assertEngagementDatesInsideWindow(engagement, discovery);

  return {
    discovery,
    engagement,
    topPosts,
    followers: followersParse.rows,
    demographics,
    exportTotalFollowers: followersParse.exportTotalFollowers,
    exportDate: followersParse.exportDate,
  };
}

function assertEngagementDatesInsideWindow(
  engagement: EngagementRow[],
  discovery: DiscoveryTotals
): void {
  if (engagement.length === 0) return;
  // Allow a ±1 day cushion on each side — LinkedIn's window boundaries are
  // inclusive in some exports and exclusive in others, and we don't want a
  // one-off clamp to trip the locale heuristic. The real signal is
  // "wholesale wrong interpretation", not "off by a day".
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const lo = discovery.windowStart.getTime() - MS_PER_DAY;
  const hi = discovery.windowEnd.getTime() + MS_PER_DAY;
  let outside = 0;
  for (const row of engagement) {
    const t = row.date.getTime();
    if (t < lo || t > hi) outside++;
  }
  // >50% outside → locale mismatch. We choose strict > so the boundary case
  // "exactly half" doesn't throw; that can happen in short (2-row) fixtures.
  if (outside * 2 > engagement.length) {
    throw new LinkedInXlsxError(
      "Date locale mismatch — export appears to use D/M/YYYY; switch LinkedIn account language to EN (US)",
      {
        engagementRows: engagement.length,
        outsideWindow: outside,
        windowStart: discovery.windowStart.toISOString(),
        windowEnd: discovery.windowEnd.toISOString(),
      }
    );
  }
}
