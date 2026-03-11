"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import type { ContentCsvRow, OverviewCsvRow, AnalyticsSummary } from "@/lib/types";
import { X_POST_TYPE_TO_PRISMA, X_POST_TYPE_MAP } from "@/lib/types";
import type { XPostType as PrismaXPostType } from "@/generated/prisma";

// --- Import ---

export async function importContentData(
  rows: ContentCsvRow[]
): Promise<{ imported: number; updated: number }> {
  let imported = 0;
  let updated = 0;

  for (const row of rows) {
    const date = new Date(row.date);
    if (isNaN(date.getTime())) continue;

    const result = await prisma.xPost.upsert({
      where: { postId: row.postId },
      create: {
        postId: row.postId,
        date,
        text: row.text,
        postLink: row.postLink,
        postType: X_POST_TYPE_TO_PRISMA[row.postType] as PrismaXPostType,
        impressions: row.impressions,
        likes: row.likes,
        engagements: row.engagements,
        bookmarks: row.bookmarks,
        shares: row.shares,
        newFollowers: row.newFollowers,
        replies: row.replies,
        reposts: row.reposts,
        profileVisits: row.profileVisits,
        detailExpands: row.detailExpands,
        urlClicks: row.urlClicks,
      },
      update: {
        impressions: row.impressions,
        likes: row.likes,
        engagements: row.engagements,
        bookmarks: row.bookmarks,
        shares: row.shares,
        newFollowers: row.newFollowers,
        replies: row.replies,
        reposts: row.reposts,
        profileVisits: row.profileVisits,
        detailExpands: row.detailExpands,
        urlClicks: row.urlClicks,
      },
    });

    if (result.createdAt.getTime() === result.createdAt.getTime()) {
      // Check if this was a create or update by comparing dates
      // Prisma upsert doesn't distinguish, so we count based on whether createdAt is "now"
      const isNew = Date.now() - result.createdAt.getTime() < 5000;
      if (isNew) imported++;
      else updated++;
    }
  }

  revalidatePath("/analytics");
  return { imported, updated };
}

export async function importDailyStats(
  rows: OverviewCsvRow[]
): Promise<{ imported: number; updated: number }> {
  let imported = 0;
  let updated = 0;

  for (const row of rows) {
    const date = new Date(row.date);
    if (isNaN(date.getTime())) continue;

    // Normalize to start of day UTC
    const dayStart = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));

    const existing = await prisma.dailyAccountStats.findUnique({
      where: { date: dayStart },
    });

    await prisma.dailyAccountStats.upsert({
      where: { date: dayStart },
      create: {
        date: dayStart,
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
      },
      update: {
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
      },
    });

    if (existing) updated++;
    else imported++;
  }

  revalidatePath("/analytics");
  return { imported, updated };
}

// --- Read ---

export async function getAnalyticsDateRange(): Promise<{ from: Date; to: Date } | null> {
  const [postRange, statsRange] = await Promise.all([
    prisma.xPost.aggregate({ _min: { date: true }, _max: { date: true } }),
    prisma.dailyAccountStats.aggregate({ _min: { date: true }, _max: { date: true } }),
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
  return prisma.dailyAccountStats.findMany({
    where: { date: { gte: from, lte: to } },
    orderBy: { date: "asc" },
  });
}

export async function getPostsForPeriod(from: Date, to: Date) {
  return prisma.xPost.findMany({
    where: { date: { gte: from, lte: to } },
    orderBy: { date: "desc" },
  });
}

export async function getAnalyticsSummary(from: Date, to: Date): Promise<AnalyticsSummary> {
  const [posts, dailyStats] = await Promise.all([
    prisma.xPost.findMany({
      where: { date: { gte: from, lte: to } },
      orderBy: { impressions: "desc" },
    }),
    prisma.dailyAccountStats.findMany({
      where: { date: { gte: from, lte: to } },
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
    shares: p.shares,
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
    shares: p.shares,
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
    avgPostImpressions: originalPosts.length > 0 ? Math.round(totalPostImpressions / originalPosts.length) : 0,
    avgReplyImpressions: replies.length > 0 ? Math.round(totalReplyImpressions / replies.length) : 0,
    maxPostImpressions: originalPosts.length > 0 ? originalPosts[0].impressions : 0,
    totalNewFollows,
    totalUnfollows,
    netFollowerGrowth: totalNewFollows - totalUnfollows,
    avgEngagementRate:
      totalImpressions > 0
        ? Math.round((totalEngagements / totalImpressions) * 10000) / 100
        : 0,
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
