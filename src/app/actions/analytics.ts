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

export async function importContentData(
  rows: ContentCsvRow[]
): Promise<{ enriched: number; skipped: number }> {
  const userId = await requireUserId();
  let enriched = 0;
  let skipped = 0;

  for (const row of rows) {
    const date = new Date(row.date);
    if (isNaN(date.getTime())) continue;

    const existing = await prisma.socialPost.findUnique({
      where: {
        userId_platform_externalPostId: {
          userId,
          platform: "X",
          externalPostId: row.postId,
        },
      },
      select: { id: true },
    });

    if (!existing) {
      skipped++;
      continue;
    }

    await prisma.socialPost.update({
      where: { id: existing.id },
      data: {
        newFollowers: row.newFollowers,
        detailExpands: row.detailExpands,
      },
    });

    enriched++;
  }

  revalidatePath("/analytics");
  return { enriched, skipped };
}

export async function importDailyStats(
  rows: OverviewCsvRow[]
): Promise<{ imported: number; updated: number }> {
  const userId = await requireUserId();
  let imported = 0;
  let updated = 0;

  for (const row of rows) {
    const date = new Date(row.date);
    if (isNaN(date.getTime())) continue;

    const dayStart = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));

    const existing = await prisma.socialDailyStats.findUnique({
      where: {
        userId_platform_date: { userId, platform: "X", date: dayStart },
      },
    });

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

    await prisma.socialDailyStats.upsert({
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

    if (existing) updated++;
    else imported++;
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
