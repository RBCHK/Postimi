"use server";

import * as Sentry from "@sentry/nextjs";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/auth";
import {
  detectLinkedInCsvKind,
  LinkedInCsvError,
  parseLinkedInContentRows,
  parseLinkedInFollowersRows,
  type LinkedInContentRow,
  type LinkedInFollowersRow,
} from "@/lib/csv/linkedin";
import type { LinkedInPostMetadata } from "@/lib/platform/types";

// ADR-008 Phase 3: LinkedIn CSV import server action.
//
// LinkedIn's analytics API is closed (r_member_social restricted; see
// ADR-008 for rationale). Users export CSV from "Analytics → Content"
// in the LinkedIn UI and upload it here.
//
// Security-critical invariants (the existing X CSV path predates these):
//   - 5 MB size cap: rejects LinkedIn exports significantly larger than
//     the largest known real export (~100 KB).
//   - 50 000 row cap: a sane upper bound that prevents memory blow-up.
//   - MIME magic-byte check: parses the first two bytes to distinguish
//     UTF-16LE BOM (0xFF 0xFE) from other encodings. We accept only
//     UTF-8 and UTF-16LE (the encodings LinkedIn emits).
//   - Formula-injection stripping: every cell's first character is
//     inspected in the parser and prefixed with `'` if dangerous.
//   - URL whitelist: `Post URL` must match linkedin.com in the parser.
//   - Unknown columns fail loud: rename in LinkedIn's export is a
//     breaking change we want users to see as an error, not a silent
//     zero import.

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const MAX_ROWS = 50_000;

const UTF16_LE_BOM = [0xff, 0xfe] as const;
const UTF8_BOM = [0xef, 0xbb, 0xbf] as const;

export interface LinkedInImportResult {
  kind: "content" | "followers";
  imported: number;
  updated: number;
  rowsParsed: number;
}

class LinkedInImportUserError extends Error {
  constructor(
    public readonly code:
      | "too_large"
      | "too_many_rows"
      | "unsupported_encoding"
      | "unknown_kind"
      | "malformed",
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "LinkedInImportUserError";
  }
}

/**
 * Decode a CSV buffer. Accepts UTF-8 (with or without BOM) and UTF-16LE
 * (LinkedIn's export default). Rejects anything else so we never silently
 * corrupt mojibake characters into the DB.
 */
function decodeCsvBuffer(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  if (bytes.length >= 2 && bytes[0] === UTF16_LE_BOM[0] && bytes[1] === UTF16_LE_BOM[1]) {
    return new TextDecoder("utf-16le").decode(buf);
  }
  if (
    bytes.length >= 3 &&
    bytes[0] === UTF8_BOM[0] &&
    bytes[1] === UTF8_BOM[1] &&
    bytes[2] === UTF8_BOM[2]
  ) {
    return new TextDecoder("utf-8").decode(buf);
  }
  // No BOM — assume UTF-8 but validate the decode is non-lossy.
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    throw new LinkedInImportUserError(
      "unsupported_encoding",
      "CSV is not valid UTF-8 or UTF-16LE. LinkedIn exports are UTF-16LE; re-download from Analytics → Content."
    );
  }
}

/**
 * Primary server action. Accepts the raw file as a `File` via FormData
 * — Next.js 15 serializes File over the action boundary.
 */
export async function importLinkedInCsv(formData: FormData): Promise<LinkedInImportResult> {
  const userId = await requireUserId();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    throw new LinkedInImportUserError("malformed", "No file uploaded");
  }
  if (file.size > MAX_FILE_SIZE) {
    throw new LinkedInImportUserError(
      "too_large",
      `File is ${(file.size / 1024 / 1024).toFixed(1)} MB; max 5 MB`
    );
  }

  let raw: string;
  try {
    raw = decodeCsvBuffer(await file.arrayBuffer());
  } catch (err) {
    if (err instanceof LinkedInImportUserError) throw err;
    throw new LinkedInImportUserError("unsupported_encoding", "Failed to decode CSV");
  }

  let kind: ReturnType<typeof detectLinkedInCsvKind>;
  try {
    kind = detectLinkedInCsvKind(raw);
  } catch (err) {
    if (err instanceof LinkedInCsvError) {
      throw new LinkedInImportUserError("unknown_kind", err.message, err.details);
    }
    throw err;
  }

  if (kind === "unknown") {
    throw new LinkedInImportUserError(
      "unknown_kind",
      "Could not determine CSV type. Expected a LinkedIn Content or Followers export."
    );
  }

  try {
    if (kind === "content") {
      const rows = parseLinkedInContentRows(raw);
      if (rows.length > MAX_ROWS) {
        throw new LinkedInImportUserError(
          "too_many_rows",
          `CSV has ${rows.length} rows; max ${MAX_ROWS}`
        );
      }
      const { imported, updated } = await persistContent(userId, rows);
      revalidatePath("/analytics");
      return { kind: "content", imported, updated, rowsParsed: rows.length };
    }
    const rows = parseLinkedInFollowersRows(raw);
    if (rows.length > MAX_ROWS) {
      throw new LinkedInImportUserError(
        "too_many_rows",
        `CSV has ${rows.length} rows; max ${MAX_ROWS}`
      );
    }
    const { imported, updated } = await persistFollowers(userId, rows);
    revalidatePath("/analytics");
    return { kind: "followers", imported, updated, rowsParsed: rows.length };
  } catch (err) {
    if (err instanceof LinkedInImportUserError) throw err;
    if (err instanceof LinkedInCsvError) {
      throw new LinkedInImportUserError("malformed", err.message, err.details);
    }
    Sentry.captureException(err, {
      tags: { action: "importLinkedInCsv", userId },
    });
    throw err;
  }
}

async function persistContent(
  userId: string,
  rows: LinkedInContentRow[]
): Promise<{ imported: number; updated: number }> {
  let imported = 0;
  let updated = 0;
  for (const row of rows) {
    const existing = await prisma.socialPost.findUnique({
      where: {
        userId_platform_externalPostId: {
          userId,
          platform: "LINKEDIN",
          externalPostId: row.externalPostId,
        },
      },
      select: { id: true },
    });

    const engagements = row.reactions + row.comments + row.reposts + row.shares;

    // LinkedIn metadata shape validated at the Zod layer. Using the
    // inferred type here means parser regressions surface as type errors.
    const metadata: LinkedInPostMetadata = {
      platform: "LINKEDIN",
      postUrl: row.postUrl,
      postType: row.postType,
    };

    const metrics = {
      impressions: row.impressions,
      likes: row.reactions,
      engagements,
      bookmarks: 0,
      replies: row.comments,
      reposts: row.reposts,
      shares: row.shares,
      urlClicks: row.clicks,
      views: 0,
    };

    await prisma.socialPost.upsert({
      where: {
        userId_platform_externalPostId: {
          userId,
          platform: "LINKEDIN",
          externalPostId: row.externalPostId,
        },
      },
      create: {
        userId,
        platform: "LINKEDIN",
        externalPostId: row.externalPostId,
        postedAt: row.postedAt,
        text: row.text,
        postUrl: row.postUrl,
        postType: row.postType,
        platformMetadata: metadata,
        ...metrics,
        dataSource: "CSV",
      },
      update: {
        ...metrics,
        platformMetadata: metadata,
        dataSource: "CSV",
      },
    });

    if (existing) updated++;
    else imported++;
  }
  return { imported, updated };
}

async function persistFollowers(
  userId: string,
  rows: LinkedInFollowersRow[]
): Promise<{ imported: number; updated: number }> {
  let imported = 0;
  let updated = 0;

  // Compute deltas by sorting ascending and iterating.
  const sorted = [...rows].sort((a, b) => a.date.getTime() - b.date.getTime());
  let prev: LinkedInFollowersRow | null = null;

  for (const row of sorted) {
    const dayStart = new Date(
      Date.UTC(row.date.getUTCFullYear(), row.date.getUTCMonth(), row.date.getUTCDate())
    );
    const existing = await prisma.socialFollowersSnapshot.findUnique({
      where: { userId_platform_date: { userId, platform: "LINKEDIN", date: dayStart } },
      select: { id: true },
    });

    const deltaFollowers = prev ? row.followersCount - prev.followersCount : 0;

    await prisma.socialFollowersSnapshot.upsert({
      where: { userId_platform_date: { userId, platform: "LINKEDIN", date: dayStart } },
      create: {
        userId,
        platform: "LINKEDIN",
        date: dayStart,
        followersCount: row.followersCount,
        // LinkedIn CSV doesn't report following count from the creator's side.
        followingCount: null,
        deltaFollowers,
        deltaFollowing: 0,
      },
      update: {
        followersCount: row.followersCount,
        deltaFollowers,
      },
    });

    if (existing) updated++;
    else imported++;
    prev = row;
  }
  return { imported, updated };
}
