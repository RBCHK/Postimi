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
import { LinkedInXlsxImportUserError, type LinkedInXlsxImportResult } from "./linkedin-xlsx-types";

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

// 200 rows per transaction is safely under Postgres' ~65k bound-param
// ceiling and keeps transaction duration short on xlsx imports (a
// quarterly LinkedIn export is ~90 rows total, so in practice this
// resolves to a single batch).
const XLSX_BATCH_SIZE = 200;

async function persistTopPosts(
  userId: string,
  rows: TopPostRow[]
): Promise<{ imported: number; updated: number }> {
  if (rows.length === 0) return { imported: 0, updated: 0 };

  // Fetch all existing LinkedIn posts matching these IDs up-front — one
  // query in place of N findUnique calls. The `impressions`/`engagements`
  // columns are needed so we can keep the larger value between imports.
  const existingRows = await prisma.socialPost.findMany({
    where: {
      userId,
      platform: "LINKEDIN",
      externalPostId: { in: rows.map((r) => r.externalPostId) },
    },
    select: { externalPostId: true, impressions: true, engagements: true },
  });
  const existingMap = new Map(existingRows.map((r) => [r.externalPostId, r]));

  let imported = 0;
  let updated = 0;

  for (let start = 0; start < rows.length; start += XLSX_BATCH_SIZE) {
    const chunk = rows.slice(start, start + XLSX_BATCH_SIZE);

    await prisma.$transaction(
      chunk.map((row) => {
        const existing = existingMap.get(row.externalPostId);
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

        if (existing) updated++;
        else imported++;

        return prisma.socialPost.upsert({
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
      })
    );
  }
  return { imported, updated };
}

async function persistDailyStats(userId: string, rows: EngagementRow[]): Promise<number> {
  if (rows.length === 0) return 0;

  let count = 0;
  for (let start = 0; start < rows.length; start += XLSX_BATCH_SIZE) {
    const chunk = rows.slice(start, start + XLSX_BATCH_SIZE);
    await prisma.$transaction(
      chunk.map((row) =>
        prisma.socialDailyStats.upsert({
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
        })
      )
    );
    count += chunk.length;
  }
  return count;
}

async function persistFollowers(userId: string, rows: FollowersRow[]): Promise<number> {
  if (rows.length === 0) return 0;

  let count = 0;
  for (let start = 0; start < rows.length; start += XLSX_BATCH_SIZE) {
    const chunk = rows.slice(start, start + XLSX_BATCH_SIZE);
    await prisma.$transaction(
      chunk.map((row) =>
        prisma.socialFollowersSnapshot.upsert({
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
        })
      )
    );
    count += chunk.length;
  }
  return count;
}
