import { prisma } from "@/lib/prisma";
import type {
  ContentCsvRow,
  AnalyticsSummary,
  HeatmapCell,
  PostWithSnapshotSummary,
  PostVelocityData,
} from "@/lib/types";
import { X_POST_TYPE_MAP } from "@/lib/types";

// ADR-008 Phase 1b: X-specific analytics now live on Social* tables filtered
// by `platform: "X"`. This module is kept separate from social-analytics.ts
// because the Analytics UI + X Strategist path depend on an X-rich shape
// (totalReplies, topReplies, heatmap, per-post velocity). Cross-platform
// views use src/lib/server/social-analytics.ts.

export async function getAnalyticsDateRange(
  userId: string
): Promise<{ from: Date; to: Date } | null> {
  const [postRange, statsRange] = await Promise.all([
    prisma.socialPost.aggregate({
      where: { userId, platform: "X" },
      _min: { postedAt: true },
      _max: { postedAt: true },
    }),
    prisma.socialDailyStats.aggregate({
      where: { userId, platform: "X" },
      _min: { date: true },
      _max: { date: true },
    }),
  ]);

  const dates = [
    postRange._min.postedAt,
    postRange._max.postedAt,
    statsRange._min.date,
    statsRange._max.date,
  ].filter((d): d is Date => d !== null);

  if (dates.length === 0) return null;

  return {
    from: new Date(Math.min(...dates.map((d) => d.getTime()))),
    to: new Date(Math.max(...dates.map((d) => d.getTime()))),
  };
}

export async function getAnalyticsSummary(
  userId: string,
  from: Date,
  to: Date
): Promise<AnalyticsSummary> {
  const [posts, dailyStats] = await Promise.all([
    prisma.socialPost.findMany({
      where: { userId, platform: "X", postedAt: { gte: from, lte: to } },
      orderBy: { impressions: "desc" },
    }),
    prisma.socialDailyStats.findMany({
      where: { userId, platform: "X", date: { gte: from, lte: to } },
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
    postId: p.externalPostId,
    date: formatDate(p.postedAt),
    text: p.text.slice(0, 200),
    postLink: p.postUrl ?? "",
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
    postId: p.externalPostId,
    date: formatDate(p.postedAt),
    text: p.text.slice(0, 200),
    postLink: p.postUrl ?? "",
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

  const postsByDayMap = new Map<string, { posts: number; replies: number }>();
  for (const p of posts) {
    const day = formatDate(p.postedAt);
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

export async function getEngagementHeatmap(
  userId: string,
  from: Date,
  to: Date
): Promise<HeatmapCell[]> {
  const posts = await prisma.socialPost.findMany({
    where: {
      userId,
      platform: "X",
      postedAt: { gte: from, lte: to },
      impressions: { gt: 0 },
    },
    select: { postedAt: true, engagements: true, impressions: true },
  });

  const map = new Map<string, { totalRate: number; count: number }>();

  for (const post of posts) {
    const jsDay = post.postedAt.getUTCDay();
    const dayOfWeek = jsDay === 0 ? 6 : jsDay - 1;
    const hour = post.postedAt.getUTCHours();
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

export async function getRecentPostsWithSnapshots(
  userId: string,
  limit: number = 20
): Promise<PostWithSnapshotSummary[]> {
  const snapshotGroups = await prisma.socialPostEngagementSnapshot.groupBy({
    by: ["postId"],
    where: { userId, platform: "X" },
    _count: { postId: true },
    _max: { impressions: true },
    orderBy: { _max: { snapshotDate: "desc" } },
    take: limit,
  });

  if (snapshotGroups.length === 0) return [];

  const postIds = snapshotGroups.map((g) => g.postId);
  const posts = await prisma.socialPost.findMany({
    where: { userId, platform: "X", id: { in: postIds } },
    select: { id: true, text: true, postedAt: true },
  });

  const postMap = new Map(posts.map((p) => [p.id, p]));

  return snapshotGroups
    .map((g) => {
      const post = postMap.get(g.postId);
      if (!post) return null;
      return {
        postId: g.postId,
        text: post.text.slice(0, 120),
        date: post.postedAt.toISOString().split("T")[0],
        snapshotCount: g._count.postId,
        latestImpressions: g._max.impressions ?? 0,
      };
    })
    .filter((p): p is PostWithSnapshotSummary => p !== null);
}

export async function getPostVelocity(
  userId: string,
  postId: string
): Promise<PostVelocityData | null> {
  const post = await prisma.socialPost.findFirst({
    where: { id: postId, userId, platform: "X" },
    select: { id: true, externalPostId: true, text: true, postedAt: true },
  });
  if (!post) return null;

  const snapshots = await prisma.socialPostEngagementSnapshot.findMany({
    where: { userId, platform: "X", postId },
    orderBy: { snapshotDate: "asc" },
  });

  const postTime = post.postedAt.getTime();

  return {
    postId: post.externalPostId,
    postText: post.text.slice(0, 200),
    postDate: post.postedAt.toISOString().split("T")[0],
    snapshots: snapshots.map((s) => ({
      daysSincePost: Math.round((s.snapshotDate.getTime() - postTime) / (1000 * 60 * 60 * 24)),
      snapshotDate: s.snapshotDate.toISOString().split("T")[0],
      impressions: s.impressions,
      likes: s.likes,
      engagements: s.engagements,
      bookmarks: s.bookmarks,
      replies: s.replies,
      reposts: s.reposts,
    })),
  };
}
