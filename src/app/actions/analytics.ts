"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/auth";
import type {
  ContentCsvRow,
  OverviewCsvRow,
  AnalyticsSummary,
  HeatmapCell,
  PostWithSnapshotSummary,
  PostVelocityData,
} from "@/lib/types";
import {
  getAnalyticsDateRange as _getAnalyticsDateRange,
  getAnalyticsSummary as _getAnalyticsSummary,
  getEngagementHeatmap as _getEngagementHeatmap,
  getRecentPostsWithSnapshots as _getRecentPostsWithSnapshots,
  getPostVelocity as _getPostVelocity,
} from "@/lib/server/analytics";

// --- Import ---

// CSV imports can be a few hundred rows (X exports ~90 days of content at
// a time). 200 writes per $transaction is safely below Postgres' bound-
// parameter ceiling while collapsing N round-trips into ⌈N/200⌉.
const CSV_BATCH_SIZE = 200;

export async function importContentData(
  rows: ContentCsvRow[]
): Promise<{ enriched: number; skipped: number }> {
  const userId = await requireUserId();

  // Filter out rows with bad dates before any DB work.
  const validRows = rows.filter((r) => !isNaN(new Date(r.date).getTime()));
  if (validRows.length === 0) {
    revalidatePath("/analytics");
    return { enriched: 0, skipped: 0 };
  }

  // One findMany in place of N findUnique calls to resolve which posts
  // exist. `id` is needed so the update batch can target the row PK.
  const existingRows = await prisma.socialPost.findMany({
    where: {
      userId,
      platform: "X",
      externalPostId: { in: validRows.map((r) => r.postId) },
    },
    select: { id: true, externalPostId: true },
  });
  const existingByExternalId = new Map(existingRows.map((r) => [r.externalPostId, r.id]));

  const enrichments: Array<{ id: string; row: ContentCsvRow }> = [];
  let skipped = 0;
  for (const row of validRows) {
    const postId = existingByExternalId.get(row.postId);
    if (!postId) {
      skipped++;
      continue;
    }
    enrichments.push({ id: postId, row });
  }

  // Skipped rows from the original loop that had invalid dates also count.
  skipped += rows.length - validRows.length;

  let enriched = 0;
  for (let start = 0; start < enrichments.length; start += CSV_BATCH_SIZE) {
    const chunk = enrichments.slice(start, start + CSV_BATCH_SIZE);
    await prisma.$transaction(
      chunk.map(({ id, row }) =>
        prisma.socialPost.update({
          where: { id },
          data: {
            newFollowers: row.newFollowers,
            detailExpands: row.detailExpands,
          },
        })
      )
    );
    enriched += chunk.length;
  }

  revalidatePath("/analytics");
  return { enriched, skipped };
}

export async function importDailyStats(
  rows: OverviewCsvRow[]
): Promise<{ imported: number; updated: number }> {
  const userId = await requireUserId();

  // Pre-compute day starts and drop rows with bad dates.
  const prepared = rows
    .map((row) => {
      const date = new Date(row.date);
      if (isNaN(date.getTime())) return null;
      const dayStart = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
      return { row, dayStart };
    })
    .filter((p): p is { row: OverviewCsvRow; dayStart: Date } => p !== null);

  if (prepared.length === 0) {
    revalidatePath("/analytics");
    return { imported: 0, updated: 0 };
  }

  // One findMany classifies which (userId, platform, date) rows already
  // exist; replaces N findUnique calls.
  const existingRows = await prisma.socialDailyStats.findMany({
    where: {
      userId,
      platform: "X",
      date: { in: prepared.map((p) => p.dayStart) },
    },
    select: { date: true },
  });
  const existingSet = new Set(existingRows.map((r) => r.date.getTime()));

  let imported = 0;
  let updated = 0;
  for (const { dayStart } of prepared) {
    if (existingSet.has(dayStart.getTime())) updated++;
    else imported++;
  }

  for (let start = 0; start < prepared.length; start += CSV_BATCH_SIZE) {
    const chunk = prepared.slice(start, start + CSV_BATCH_SIZE);
    await prisma.$transaction(
      chunk.map(({ row, dayStart }) => {
        const statsData = {
          impressions: row.impressions,
          likes: row.likes,
          engagements: row.engagements,
          bookmarks: row.bookmarks,
          shares: row.shares,
          newFollows: row.newFollows,
          unfollows: row.unfollows,
          replies: row.replies,
          reposts: row.reposts,
          profileVisits: row.profileVisits,
          createPost: row.createPost,
          videoViews: row.videoViews,
          mediaViews: row.mediaViews,
        };
        return prisma.socialDailyStats.upsert({
          where: {
            userId_platform_date: { userId, platform: "X", date: dayStart },
          },
          create: {
            userId,
            platform: "X",
            date: dayStart,
            ...statsData,
          },
          update: statsData,
        });
      })
    );
  }

  revalidatePath("/analytics");
  return { imported, updated };
}

// --- Read (auth-wrapped) ---

export async function getAnalyticsDateRange(): Promise<{ from: Date; to: Date } | null> {
  const userId = await requireUserId();
  return _getAnalyticsDateRange(userId);
}

export async function getDailyStatsForPeriod(from: Date, to: Date) {
  const userId = await requireUserId();
  return prisma.socialDailyStats.findMany({
    where: { userId, platform: "X", date: { gte: from, lte: to } },
    orderBy: { date: "asc" },
  });
}

export async function getPostsForPeriod(from: Date, to: Date) {
  const userId = await requireUserId();
  return prisma.socialPost.findMany({
    where: { userId, platform: "X", postedAt: { gte: from, lte: to } },
    orderBy: { postedAt: "desc" },
  });
}

export async function getAnalyticsSummary(from: Date, to: Date): Promise<AnalyticsSummary> {
  const userId = await requireUserId();
  return _getAnalyticsSummary(userId, from, to);
}

export async function getEngagementHeatmap(from: Date, to: Date): Promise<HeatmapCell[]> {
  const userId = await requireUserId();
  return _getEngagementHeatmap(userId, from, to);
}

export async function getRecentPostsWithSnapshots(
  limit: number = 20
): Promise<PostWithSnapshotSummary[]> {
  const userId = await requireUserId();
  return _getRecentPostsWithSnapshots(userId, limit);
}

export async function getPostVelocity(postId: string): Promise<PostVelocityData | null> {
  const userId = await requireUserId();
  return _getPostVelocity(userId, postId);
}
