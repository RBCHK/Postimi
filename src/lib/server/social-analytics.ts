import { prisma } from "@/lib/prisma";
import type { Platform } from "@/lib/types";

// ADR-008 Phase 4: platform-agnostic analytics reads over Social* tables.

export interface SocialAnalyticsSummary {
  platform: Platform;
  dateRange: { from: string; to: string };
  periodDays: number;

  totalPosts: number;
  totalImpressions: number;
  totalEngagements: number;
  avgPostImpressions: number;
  maxPostImpressions: number;
  avgEngagementRate: number;

  latestFollowers: number | null;
  netFollowerGrowth: number;
  totalNewFollows: number;

  dailyStats: Array<{
    date: string;
    impressions: number;
    engagements: number;
    newFollows: number;
    unfollows: number;
  }>;

  postsByDay: Array<{ date: string; posts: number }>;

  followersSeries: Array<{
    date: string;
    followersCount: number;
    deltaFollowers: number;
  }>;

  topPosts: Array<{
    externalPostId: string;
    postUrl: string | null;
    postedAt: string;
    text: string;
    postType: string;
    impressions: number;
    engagements: number;
    likes: number;
  }>;
}

function formatDate(d: Date): string {
  return d.toISOString().split("T")[0]!;
}

export async function getSocialAnalyticsDateRange(
  userId: string,
  platform: Platform
): Promise<{ from: Date; to: Date } | null> {
  const [postRange, statsRange, followersRange] = await Promise.all([
    prisma.socialPost.aggregate({
      where: { userId, platform },
      _min: { postedAt: true },
      _max: { postedAt: true },
    }),
    prisma.socialDailyStats.aggregate({
      where: { userId, platform },
      _min: { date: true },
      _max: { date: true },
    }),
    prisma.socialFollowersSnapshot.aggregate({
      where: { userId, platform },
      _min: { date: true },
      _max: { date: true },
    }),
  ]);

  const dates = [
    postRange._min.postedAt,
    postRange._max.postedAt,
    statsRange._min.date,
    statsRange._max.date,
    followersRange._min.date,
    followersRange._max.date,
  ].filter((d): d is Date => d !== null);

  if (dates.length === 0) return null;
  return {
    from: new Date(Math.min(...dates.map((d) => d.getTime()))),
    to: new Date(Math.max(...dates.map((d) => d.getTime()))),
  };
}

export async function getSocialAnalyticsSummary(
  userId: string,
  platform: Platform,
  from: Date,
  to: Date
): Promise<SocialAnalyticsSummary> {
  const [posts, dailyStats, followersSnapshots] = await Promise.all([
    prisma.socialPost.findMany({
      where: { userId, platform, postedAt: { gte: from, lte: to } },
      orderBy: { impressions: "desc" },
    }),
    prisma.socialDailyStats.findMany({
      where: { userId, platform, date: { gte: from, lte: to } },
      orderBy: { date: "asc" },
    }),
    prisma.socialFollowersSnapshot.findMany({
      where: { userId, platform, date: { gte: from, lte: to } },
      orderBy: { date: "asc" },
    }),
  ]);

  const totalImpressions = posts.reduce((s, p) => s + p.impressions, 0);
  const totalEngagements = posts.reduce((s, p) => s + p.engagements, 0);
  const totalNewFollows = dailyStats.reduce((s, d) => s + d.newFollows, 0);
  const totalUnfollows = dailyStats.reduce((s, d) => s + d.unfollows, 0);

  const periodDays =
    dailyStats.length ||
    Math.max(1, Math.round((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)));

  const topPosts = posts.slice(0, 5).map((p) => ({
    externalPostId: p.externalPostId,
    postUrl: p.postUrl,
    postedAt: formatDate(p.postedAt),
    text: p.text.slice(0, 200),
    postType: p.postType,
    impressions: p.impressions,
    engagements: p.engagements,
    likes: p.likes,
  }));

  const postsByDayMap = new Map<string, number>();
  for (const p of posts) {
    const day = formatDate(p.postedAt);
    postsByDayMap.set(day, (postsByDayMap.get(day) ?? 0) + 1);
  }
  const postsByDay = Array.from(postsByDayMap.entries())
    .map(([date, count]) => ({ date, posts: count }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const followersSeries = followersSnapshots.map((s) => ({
    date: formatDate(s.date),
    followersCount: s.followersCount,
    deltaFollowers: s.deltaFollowers,
  }));
  const firstFollowers = followersSnapshots[0]?.followersCount ?? null;
  const latestFollowers = followersSnapshots[followersSnapshots.length - 1]?.followersCount ?? null;
  const netFollowerGrowth =
    firstFollowers !== null && latestFollowers !== null
      ? latestFollowers - firstFollowers
      : totalNewFollows - totalUnfollows;

  return {
    platform,
    dateRange: { from: formatDate(from), to: formatDate(to) },
    periodDays,
    totalPosts: posts.length,
    totalImpressions,
    totalEngagements,
    avgPostImpressions: posts.length > 0 ? Math.round(totalImpressions / posts.length) : 0,
    maxPostImpressions: posts[0]?.impressions ?? 0,
    avgEngagementRate:
      totalImpressions > 0 ? Math.round((totalEngagements / totalImpressions) * 10000) / 100 : 0,
    latestFollowers,
    netFollowerGrowth,
    totalNewFollows,
    dailyStats: dailyStats.map((d) => ({
      date: formatDate(d.date),
      impressions: d.impressions,
      engagements: d.engagements,
      newFollows: d.newFollows,
      unfollows: d.unfollows,
    })),
    postsByDay,
    followersSeries,
    topPosts,
  };
}
