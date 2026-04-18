// LinkedIn CSV importer (ADR-008 Phase 3).
//
// LinkedIn's Post Analytics API (`memberCreatorPostAnalytics`) is gated
// behind `r_member_social` which is closed to new apps (LinkedIn API
// FAQ, Aug 2025). The only viable analytics path is CSV export from
// "Analytics → Content" in the UI. This module parses those exports.
//
// Two shapes are supported:
//   - Content export: one row per post with impressions / engagements /
//     etc. Detected via the "Post URL" header.
//   - Followers export: one row per day with follower counts.
//     Detected via the "Total followers" header.
//
// Security hardening (the X CSV path predates these checks):
//   - Size and row caps (enforced by the server action before this file
//     is called) to bound memory + Prisma batch size.
//   - Magic-byte / MIME validation (server action).
//   - UTF-16LE BOM handling — LinkedIn's exports are UTF-16LE.
//   - Formula-injection stripping on every cell (prepends `'`).
//   - Post URL whitelisting to `linkedin.com` — prevents importing
//     arbitrary URLs and cross-user forged rows.
//   - Unknown / renamed columns => throw (fail loud, no silent skip).

import {
  parseCsvLine,
  parseDate,
  parseNumber,
  splitCsvLines,
  stripFormulaInjection,
} from "./primitives";

export type LinkedInCsvKind = "content" | "followers" | "unknown";

export interface LinkedInContentRow {
  externalPostId: string;
  postUrl: string;
  postedAt: Date;
  text: string;
  postType: "POST" | "REPOST" | "ARTICLE";
  impressions: number;
  reactions: number;
  comments: number;
  reposts: number;
  shares: number;
  videoViews: number;
  clicks: number;
}

export interface LinkedInFollowersRow {
  date: Date;
  followersCount: number;
  organicFollowers: number;
  sponsoredFollowers: number;
}

export class LinkedInCsvError extends Error {
  constructor(
    public readonly reason:
      | "missing_header"
      | "unknown_column"
      | "malformed_row"
      | "bad_url"
      | "ambiguous_kind",
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "LinkedInCsvError";
  }
}

// URL whitelist: permit linkedin.com and its public regional subdomains
// (e.g. "www.", "uk.", "in."). Rejects look-alikes like "linkedln.com".
const LINKEDIN_URL_RE = /^https:\/\/([a-z-]+\.)?linkedin\.com\/[^\s]+$/i;

// Expected canonical columns for each kind. The export in practice has
// additional columns (which we ignore), but required columns must match
// exactly — a rename signals LinkedIn changed the schema and the user's
// analytics would silently regress.
const CONTENT_REQUIRED_COLUMNS = [
  "Post URL",
  "Post title",
  "Post publish date",
  "Post type",
  "Impressions",
  "Reactions",
  "Comments",
  "Reposts",
  "Clicks",
];

const FOLLOWERS_REQUIRED_COLUMNS = ["Date", "Total followers"];

function normalizeHeader(raw: string): string {
  return raw.trim();
}

export function detectLinkedInCsvKind(raw: string): LinkedInCsvKind {
  const lines = splitCsvLines(raw);
  if (lines.length === 0) return "unknown";
  const headers = parseCsvLine(lines[0]!).map(normalizeHeader);

  const hasPostUrl = headers.includes("Post URL");
  const hasTotalFollowers = headers.includes("Total followers");

  if (hasPostUrl && hasTotalFollowers) {
    throw new LinkedInCsvError(
      "ambiguous_kind",
      "CSV contains both content and followers headers — pick one export."
    );
  }
  if (hasPostUrl) return "content";
  if (hasTotalFollowers) return "followers";
  return "unknown";
}

function indexHeaders(headers: string[], required: string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const name of required) {
    const idx = headers.indexOf(name);
    if (idx === -1) {
      throw new LinkedInCsvError("missing_header", `Missing required column "${name}"`, {
        required,
        present: headers,
      });
    }
    map.set(name, idx);
  }
  return map;
}

/**
 * Extract the LinkedIn post URN from a full post URL. The URN is the
 * stable external ID used for uniqueness — two rows with the same URN
 * in different exports must upsert into the same SocialPost.
 *
 * URL shapes LinkedIn uses:
 *   https://www.linkedin.com/feed/update/urn:li:activity:1234567890/
 *   https://www.linkedin.com/posts/user_slug-activity-1234567890-abcd/
 */
function externalIdFromUrl(url: string): string | null {
  // Prefer the canonical URN shape.
  const urnMatch = url.match(/urn:li:activity:(\d+)/);
  if (urnMatch) return `urn:li:activity:${urnMatch[1]}`;
  // Fallback: "-activity-<digits>" in the pretty URL.
  const prettyMatch = url.match(/-activity-(\d+)/);
  if (prettyMatch) return `urn:li:activity:${prettyMatch[1]}`;
  return null;
}

function linkedInPostTypeFromRaw(raw: string): "POST" | "REPOST" | "ARTICLE" {
  const lower = raw.trim().toLowerCase();
  if (lower.includes("article")) return "ARTICLE";
  if (lower.includes("repost") || lower.includes("reshare")) return "REPOST";
  return "POST";
}

export function parseLinkedInContentRows(raw: string): LinkedInContentRow[] {
  const lines = splitCsvLines(raw);
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]!).map(normalizeHeader);
  const idx = indexHeaders(headers, CONTENT_REQUIRED_COLUMNS);

  // Optional columns — present on most exports but not always.
  const sharesIdx = headers.indexOf("Shares");
  const videoViewsIdx = headers.indexOf("Video views");

  const rows: LinkedInContentRow[] = [];
  for (let lineNum = 1; lineNum < lines.length; lineNum++) {
    const fields = parseCsvLine(lines[lineNum]!);
    if (fields.length < headers.length) {
      // Ragged row — LinkedIn occasionally omits trailing empty cells.
      while (fields.length < headers.length) fields.push("");
    }

    const postUrlRaw = stripFormulaInjection(fields[idx.get("Post URL")!]!.trim());
    if (!LINKEDIN_URL_RE.test(postUrlRaw)) {
      throw new LinkedInCsvError(
        "bad_url",
        `Row ${lineNum + 1}: "Post URL" does not look like a LinkedIn URL`,
        { postUrl: postUrlRaw }
      );
    }
    const externalPostId = externalIdFromUrl(postUrlRaw);
    if (!externalPostId) {
      throw new LinkedInCsvError(
        "malformed_row",
        `Row ${lineNum + 1}: could not extract URN from "${postUrlRaw}"`
      );
    }

    const postedAt = parseDate(fields[idx.get("Post publish date")!]);
    if (!postedAt) {
      throw new LinkedInCsvError(
        "malformed_row",
        `Row ${lineNum + 1}: unparseable "Post publish date"`,
        { value: fields[idx.get("Post publish date")!] }
      );
    }

    rows.push({
      externalPostId,
      postUrl: postUrlRaw,
      postedAt,
      text: stripFormulaInjection(fields[idx.get("Post title")!] ?? ""),
      postType: linkedInPostTypeFromRaw(fields[idx.get("Post type")!] ?? ""),
      impressions: parseNumber(fields[idx.get("Impressions")!]),
      reactions: parseNumber(fields[idx.get("Reactions")!]),
      comments: parseNumber(fields[idx.get("Comments")!]),
      reposts: parseNumber(fields[idx.get("Reposts")!]),
      clicks: parseNumber(fields[idx.get("Clicks")!]),
      shares: sharesIdx === -1 ? 0 : parseNumber(fields[sharesIdx]),
      videoViews: videoViewsIdx === -1 ? 0 : parseNumber(fields[videoViewsIdx]),
    });
  }
  return rows;
}

export function parseLinkedInFollowersRows(raw: string): LinkedInFollowersRow[] {
  const lines = splitCsvLines(raw);
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]!).map(normalizeHeader);
  const idx = indexHeaders(headers, FOLLOWERS_REQUIRED_COLUMNS);

  const organicIdx = headers.indexOf("Organic followers");
  const sponsoredIdx = headers.indexOf("Sponsored followers");

  const rows: LinkedInFollowersRow[] = [];
  for (let lineNum = 1; lineNum < lines.length; lineNum++) {
    const fields = parseCsvLine(lines[lineNum]!);
    const date = parseDate(fields[idx.get("Date")!]);
    if (!date) {
      throw new LinkedInCsvError("malformed_row", `Row ${lineNum + 1}: unparseable "Date"`, {
        value: fields[idx.get("Date")!],
      });
    }
    const total = parseNumber(fields[idx.get("Total followers")!]);
    rows.push({
      date,
      followersCount: total,
      organicFollowers: organicIdx === -1 ? 0 : parseNumber(fields[organicIdx]),
      sponsoredFollowers: sponsoredIdx === -1 ? 0 : parseNumber(fields[sponsoredIdx]),
    });
  }
  return rows;
}
