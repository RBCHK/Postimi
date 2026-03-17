"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/auth";
import type { ContentCsvRow, OverviewCsvRow, AnalyticsSummary, HeatmapCell } from "@/lib/types";
import { X_POST_TYPE_MAP } from "@/lib/types";

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

    const existing = await prisma.xPost.findUnique({
      where: { userId_postId: { userId, postId: row.postId } },
      select: { id: true },
    });

    if (!existing) {
      // No API data yet — skip, API import must create records first
      skipped++;
      continue;
    }

    // Enrich with CSV-exclusive fields only
    await prisma.xPost.update({
      where: { userId_postId: { userId, postId: row.postId } },
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

    // Normalize to start of day UTC
    const dayStart = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));

    const existing = await prisma.dailyAccountStats.findUnique({
      where: { userId_date: { userId, date: dayStart } },
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

    await prisma.dailyAccountStats.upsert({
      where: { userId_date: { userId, date: dayStart } },
      create: {
        date: dayStart,
        userId,
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

// --- Read ---

export async function getAnalyticsDateRange(): Promise<{ from: Date; to: Date } | null> {
  const userId = await requireUserId();
  return _getAnalyticsDateRange(userId);
}

export async function getAnalyticsDateRangeInternal(
  userId: string
): Promise<{ from: Date; to: Date } | null> {
  return _getAnalyticsDateRange(userId);
}

async function _getAnalyticsDateRange(userId: string): Promise<{ from: Date; to: Date } | null> {
  const [postRange, statsRange] = await Promise.all([
    prisma.xPost.aggregate({ where: { userId }, _min: { date: true }, _max: { date: true } }),
    prisma.dailyAccountStats.aggregate({
      where: { userId },
      _min: { date: true },
      _max: { date: true },
    }),
  ]);

  const dates = [
    postRange._min.date,
    postRange._max.date,
    statsRange._min.date,
    statsRange._max.date,
  ].filter((d): d is Date => d !== null);

  if (dates.length === 0) return null;

  return {
    from: new Date(Math.min(...dates.map((d) => d.getTime()))),
    to: new Date(Math.max(...dates.map((d) => d.getTime()))),
  };
}

export async function getDailyStatsForPeriod(from: Date, to: Date) {
  const userId = await requireUserId();
  return prisma.dailyAccountStats.findMany({
    where: { userId, date: { gte: from, lte: to } },
    orderBy: { date: "asc" },
  });
}

export async function getPostsForPeriod(from: Date, to: Date) {
  const userId = await requireUserId();
  return prisma.xPost.findMany({
    where: { userId, date: { gte: from, lte: to } },
    orderBy: { date: "desc" },
  });
}

export async function getAnalyticsSummary(from: Date, to: Date): Promise<AnalyticsSummary> {
  const userId = await requireUserId();
  return _getAnalyticsSummary(userId, from, to);
}

export async function getAnalyticsSummaryInternal(
  userId: string,
  from: Date,
  to: Date
): Promise<AnalyticsSummary> {
  return _getAnalyticsSummary(userId, from, to);
}

async function _getAnalyticsSummary(
  userId: string,
  from: Date,
  to: Date
): Promise<AnalyticsSummary> {
  const [posts, dailyStats] = await Promise.all([
    prisma.xPost.findMany({
      where: { userId, date: { gte: from, lte: to } },
      orderBy: { impressions: "desc" },
    }),
    prisma.dailyAccountStats.findMany({
      where: { userId, date: { gte: from, lte: to } },
      orderBy: { date: "asc" },
    }),
  ]);

  const originalPosts = posts.filter((p) => p.postType === "POST");
  const replies = posts.filter((p) => p.postType === "REPLY");

  const totalPostImpressions = originalPosts.reduce((s, p) => s + p.impressions, 0);
  const totalReplyImpressions = replies.reduce((s, p) => s + p.impressions, 0);
  const totalImpressions = totalPostImpressions + totalReplyImpressions;
  const totalEngagements = posts.reduce((s, p) => s + p.engagements, 0);

  const totalNewFollows = dailyStats.reduce((s, d) => s + d.newFollows, 0);
  const totalUnfollows = dailyStats.reduce((s, d) => s + d.unfollows, 0);
  const totalProfileVisits = dailyStats.reduce((s, d) => s + d.profileVisits, 0);

  const periodDays = dailyStats.length || 1;

  const formatDate = (d: Date) => d.toISOString().split("T")[0]!;

  const topPosts: ContentCsvRow[] = originalPosts.slice(0, 5).map((p) => ({
    postId: p.postId,
    date: formatDate(p.date),
    text: p.text.slice(0, 200),
    postLink: p.postLink ?? "",
    postType: X_POST_TYPE_MAP[p.postType] ?? "Post",
    impressions: p.impressions,
    likes: p.likes,
    engagements: p.engagements,
    bookmarks: p.bookmarks,
    shares: p.reposts,
    newFollowers: p.newFollowers,
    replies: p.replies,
    reposts: p.reposts,
    profileVisits: p.profileVisits,
    detailExpands: p.detailExpands,
    urlClicks: p.urlClicks,
  }));

  const topReplies: ContentCsvRow[] = replies.slice(0, 5).map((p) => ({
    postId: p.postId,
    date: formatDate(p.date),
    text: p.text.slice(0, 200),
    postLink: p.postLink ?? "",
    postType: X_POST_TYPE_MAP[p.postType] ?? "Reply",
    impressions: p.impressions,
    likes: p.likes,
    engagements: p.engagements,
    bookmarks: p.bookmarks,
    shares: p.reposts,
    newFollowers: p.newFollowers,
    replies: p.replies,
    reposts: p.reposts,
    profileVisits: p.profileVisits,
    detailExpands: p.detailExpands,
    urlClicks: p.urlClicks,
  }));

  // Aggregate posts by day for the frequency chart
  const postsByDayMap = new Map<string, { posts: number; replies: number }>();
  for (const p of posts) {
    const day = formatDate(p.date);
    const entry = postsByDayMap.get(day) ?? { posts: 0, replies: 0 };
    if (p.postType === "POST") entry.posts++;
    else entry.replies++;
    postsByDayMap.set(day, entry);
  }

  return {
    dateRange: {
      from: dailyStats[0] ? formatDate(dailyStats[0].date) : formatDate(from),
      to: dailyStats[dailyStats.length - 1]
        ? formatDate(dailyStats[dailyStats.length - 1].date)
        : formatDate(to),
    },
    periodDays,
    totalPosts: originalPosts.length,
    totalReplies: replies.length,
    avgPostImpressions:
      originalPosts.length > 0 ? Math.round(totalPostImpressions / originalPosts.length) : 0,
    avgReplyImpressions:
      replies.length > 0 ? Math.round(totalReplyImpressions / replies.length) : 0,
    maxPostImpressions: originalPosts.length > 0 ? originalPosts[0].impressions : 0,
    totalNewFollows,
    totalUnfollows,
    netFollowerGrowth: totalNewFollows - totalUnfollows,
    avgEngagementRate:
      totalImpressions > 0 ? Math.round((totalEngagements / totalImpressions) * 10000) / 100 : 0,
    avgProfileVisitsPerDay: Math.round(totalProfileVisits / periodDays),
    topPosts,
    topReplies,
    dailyStats: dailyStats.map((d) => ({
      date: formatDate(d.date),
      impressions: d.impressions,
      newFollows: d.newFollows,
      unfollows: d.unfollows,
      profileVisits: d.profileVisits,
      engagements: d.engagements,
    })),
    postsByDay: Array.from(postsByDayMap.entries())
      .map(([date, counts]) => ({ date, ...counts }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  };
}

export async function getEngagementHeatmap(from: Date, to: Date): Promise<HeatmapCell[]> {
  const userId = await requireUserId();
  const posts = await prisma.xPost.findMany({
    where: { userId, date: { gte: from, lte: to }, impressions: { gt: 0 } },
    select: { date: true, engagements: true, impressions: true },
  });

  // Map: "dayOfWeek-hour" → { totalRate, count }
  const map = new Map<string, { totalRate: number; count: number }>();

  for (const post of posts) {
    const jsDay = post.date.getUTCDay(); // 0=Sun, 1=Mon...
    const dayOfWeek = jsDay === 0 ? 6 : jsDay - 1; // 0=Mon, 6=Sun
    const hour = post.date.getUTCHours();
    const rate = post.engagements / post.impressions;
    const key = `${dayOfWeek}-${hour}`;
    const entry = map.get(key) ?? { totalRate: 0, count: 0 };
    entry.totalRate += rate;
    entry.count += 1;
    map.set(key, entry);
  }

  return Array.from(map.entries()).map(([key, { totalRate, count }]) => {
    const [dayStr, hourStr] = key.split("-");
    return {
      dayOfWeek: parseInt(dayStr!),
      hour: parseInt(hourStr!),
      avgEngagementRate: totalRate / count,
      postCount: count,
    };
  });
}
