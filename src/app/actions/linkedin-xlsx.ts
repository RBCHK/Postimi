"use server";

import * as Sentry from "@sentry/nextjs";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/auth";
import {
  parseLinkedInXlsx,
  LinkedInXlsxError,
  type LinkedInXlsxParse,
  type TopPostRow,
  type EngagementRow,
  type FollowersRow,
} from "@/lib/xlsx/linkedin";
import type { LinkedInPostMetadata } from "@/lib/platform/types";

// ADR-008 Phase 3.1: LinkedIn xlsx import (replaces the dead CSV path).
//
// LinkedIn's analytics API is closed for new apps (r_member_social
// restricted). Users export an xlsx from LinkedIn → Analytics → Content and
// upload it here. The file always contains five fixed sheets; the parser
// lives in `src/lib/xlsx/linkedin.ts` and validates the shape strictly.
//
// Security invariants:
//   - 5 MB size cap. Real exports (quarterly, 90+ rows) are ~12 KB; 5 MB
//     is already 400× the worst realistic case.
//   - Magic-byte check: xlsx is a zip, so valid files start with "PK"
//     (0x50 0x4B). This rejects misnamed .csv/.html/.json uploads cheaply
//     before handing the buffer to exceljs.
//   - exceljs does not evaluate formulas at parse time, so formula
//     injection via `<f>` is not exploitable here. We still strip
//     formula-prefix cells where the text is user-visible.
//   - Row cap: 10k for engagement/followers (LinkedIn exports at most one
//     row per day — a decade of history = ~3.7k rows). Top posts caps at
//     100 by LinkedIn's own "max 50 per side" design; we allow 200 for
//     safety margin.

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const MAX_DAILY_ROWS = 10_000;
const MAX_POST_ROWS = 200;

export interface LinkedInXlsxImportResult {
  postsImported: number;
  postsUpdated: number;
  dailyStatsUpserted: number;
  followerSnapshotsUpserted: number;
  windowStart: string;
  windowEnd: string;
  totalFollowers: number;
}

export class LinkedInXlsxImportUserError extends Error {
  constructor(
    public readonly code: "too_large" | "too_many_rows" | "malformed" | "not_xlsx" | "missing_file",
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "LinkedInXlsxImportUserError";
  }
}

function assertXlsxMagicBytes(buf: ArrayBuffer): void {
  // xlsx is a zip; zips start with the local-file-header magic "PK\x03\x04".
  const bytes = new Uint8Array(buf);
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new LinkedInXlsxImportUserError(
      "not_xlsx",
      "File is not a valid xlsx. Re-export from LinkedIn → Analytics → Content."
    );
  }
}

/**
 * Primary server action. Accepts the raw xlsx file via FormData (Next.js 15
 * serializes `File` across the action boundary).
 */
export async function importLinkedInXlsx(formData: FormData): Promise<LinkedInXlsxImportResult> {
  const userId = await requireUserId();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    throw new LinkedInXlsxImportUserError("missing_file", "No file uploaded");
  }
  if (file.size > MAX_FILE_SIZE) {
    throw new LinkedInXlsxImportUserError(
      "too_large",
      `File is ${(file.size / 1024 / 1024).toFixed(1)} MB; max 5 MB`
    );
  }

  const buf = await file.arrayBuffer();
  assertXlsxMagicBytes(buf);

  let parsed: LinkedInXlsxParse;
  try {
    parsed = await parseLinkedInXlsx(buf);
  } catch (err) {
    if (err instanceof LinkedInXlsxError) {
      throw new LinkedInXlsxImportUserError("malformed", err.message, err.details);
    }
    throw err;
  }

  if (parsed.engagement.length > MAX_DAILY_ROWS || parsed.followers.length > MAX_DAILY_ROWS) {
    throw new LinkedInXlsxImportUserError(
      "too_many_rows",
      `Daily rows exceed ${MAX_DAILY_ROWS}. This shouldn't happen with a real LinkedIn export.`
    );
  }
  if (parsed.topPosts.length > MAX_POST_ROWS) {
    throw new LinkedInXlsxImportUserError(
      "too_many_rows",
      `Top posts rows exceed ${MAX_POST_ROWS}.`
    );
  }

  try {
    const postsResult = await persistTopPosts(userId, parsed.topPosts);
    const dailyUpserted = await persistDailyStats(userId, parsed.engagement);
    const followerUpserted = await persistFollowers(userId, parsed.followers);
    revalidatePath("/analytics");
    return {
      postsImported: postsResult.imported,
      postsUpdated: postsResult.updated,
      dailyStatsUpserted: dailyUpserted,
      followerSnapshotsUpserted: followerUpserted,
      windowStart: parsed.discovery.windowStart.toISOString(),
      windowEnd: parsed.discovery.windowEnd.toISOString(),
      totalFollowers: parsed.exportTotalFollowers,
    };
  } catch (err) {
    Sentry.captureException(err, {
      tags: { action: "importLinkedInXlsx", userId },
    });
    throw err;
  }
}

async function persistTopPosts(
  userId: string,
  rows: TopPostRow[]
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
      select: { id: true, impressions: true, engagements: true },
    });

    const metadata: LinkedInPostMetadata = {
      platform: "LINKEDIN",
      postUrl: row.postUrl,
      postType: row.postType,
    };

    // LinkedIn's aggregate xlsx only gives us impressions and a combined
    // engagements number — it does NOT split engagements into reactions /
    // comments / reposts. Leave those fields at their defaults (0) rather
    // than inventing values. The Strategist is expected to tolerate sparse
    // LinkedIn data (see ADR-008, memory `project_linkedin_phase31.md`).
    //
    // If the post already exists with a higher metric value (e.g. a prior
    // import of a larger quarterly export), keep the larger value. This
    // protects against the case where a user uploads a weekly export first,
    // then a quarterly — the quarterly should always "win" for totals.
    const impressions = existing
      ? Math.max(existing.impressions, row.impressions)
      : row.impressions;
    const engagements = existing
      ? Math.max(existing.engagements, row.engagements)
      : row.engagements;

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
        postedAt: row.publishedAt,
        text: "", // Not provided by LinkedIn xlsx; populated manually if needed.
        postUrl: row.postUrl,
        postType: row.postType,
        impressions,
        engagements,
        platformMetadata: metadata,
        dataSource: "CSV", // Keep existing DataSource enum; xlsx is a flavor of manual upload.
      },
      update: {
        impressions,
        engagements,
        postUrl: row.postUrl,
        platformMetadata: metadata,
        dataSource: "CSV",
      },
    });

    if (existing) updated++;
    else imported++;
  }
  return { imported, updated };
}

async function persistDailyStats(userId: string, rows: EngagementRow[]): Promise<number> {
  let count = 0;
  for (const row of rows) {
    await prisma.socialDailyStats.upsert({
      where: {
        userId_platform_date: { userId, platform: "LINKEDIN", date: row.date },
      },
      create: {
        userId,
        platform: "LINKEDIN",
        date: row.date,
        impressions: row.impressions,
        engagements: row.engagements,
      },
      update: {
        impressions: row.impressions,
        engagements: row.engagements,
      },
    });
    count++;
  }
  return count;
}

async function persistFollowers(userId: string, rows: FollowersRow[]): Promise<number> {
  let count = 0;
  for (const row of rows) {
    await prisma.socialFollowersSnapshot.upsert({
      where: {
        userId_platform_date: { userId, platform: "LINKEDIN", date: row.date },
      },
      create: {
        userId,
        platform: "LINKEDIN",
        date: row.date,
        followersCount: row.followersCount,
        followingCount: null,
        deltaFollowers: row.deltaFollowers,
        deltaFollowing: 0,
      },
      update: {
        followersCount: row.followersCount,
        deltaFollowers: row.deltaFollowers,
      },
    });
    count++;
  }
  return count;
}
