import { describe, it, expect, vi, beforeEach } from "vitest";

// ADR-008 Phase 4: platform-agnostic analytics reads.
//
// Verifies per-user + per-platform isolation in the where clauses,
// summary shape, and that follower growth over the period is computed
// as (last - first) — not summing deltas, which can silently drift if
// a day is missing.

vi.mock("@/lib/auth", () => ({ requireUserId: vi.fn() }));

const prismaMock = vi.hoisted(() => ({
  socialPost: {
    findMany: vi.fn(),
    aggregate: vi.fn(),
  },
  socialDailyStats: {
    findMany: vi.fn(),
    aggregate: vi.fn(),
  },
  socialFollowersSnapshot: {
    findMany: vi.fn(),
    aggregate: vi.fn(),
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

import { requireUserId } from "@/lib/auth";
import { getSocialAnalyticsDateRange, getSocialAnalyticsSummary } from "../social-analytics";

const USER_ID = "user-phase4";

beforeEach(() => {
  vi.clearAllMocks();
  (requireUserId as ReturnType<typeof vi.fn>).mockResolvedValue(USER_ID);
});

describe("getSocialAnalyticsDateRange", () => {
  it("returns null when the user has no data for the platform", async () => {
    const empty = { _min: { postedAt: null, date: null }, _max: { postedAt: null, date: null } };
    prismaMock.socialPost.aggregate.mockResolvedValue(empty);
    prismaMock.socialDailyStats.aggregate.mockResolvedValue(empty);
    prismaMock.socialFollowersSnapshot.aggregate.mockResolvedValue(empty);

    const result = await getSocialAnalyticsDateRange("LINKEDIN");
    expect(result).toBeNull();
  });

  it("unions earliest/latest across posts, stats, and followers", async () => {
    prismaMock.socialPost.aggregate.mockResolvedValue({
      _min: { postedAt: new Date("2026-04-05") },
      _max: { postedAt: new Date("2026-04-12") },
    });
    prismaMock.socialDailyStats.aggregate.mockResolvedValue({
      _min: { date: new Date("2026-04-01") },
      _max: { date: new Date("2026-04-10") },
    });
    prismaMock.socialFollowersSnapshot.aggregate.mockResolvedValue({
      _min: { date: new Date("2026-04-08") },
      _max: { date: new Date("2026-04-15") },
    });

    const result = await getSocialAnalyticsDateRange("LINKEDIN");
    expect(result).not.toBeNull();
    expect(result!.from.toISOString()).toBe("2026-04-01T00:00:00.000Z");
    expect(result!.to.toISOString()).toBe("2026-04-15T00:00:00.000Z");
  });

  it("filters every query by (userId, platform) — data isolation check", async () => {
    const empty = { _min: { postedAt: null, date: null }, _max: { postedAt: null, date: null } };
    prismaMock.socialPost.aggregate.mockResolvedValue(empty);
    prismaMock.socialDailyStats.aggregate.mockResolvedValue(empty);
    prismaMock.socialFollowersSnapshot.aggregate.mockResolvedValue(empty);

    await getSocialAnalyticsDateRange("THREADS");

    for (const call of prismaMock.socialPost.aggregate.mock.calls) {
      expect(call[0].where).toEqual({ userId: USER_ID, platform: "THREADS" });
    }
    for (const call of prismaMock.socialDailyStats.aggregate.mock.calls) {
      expect(call[0].where).toEqual({ userId: USER_ID, platform: "THREADS" });
    }
    for (const call of prismaMock.socialFollowersSnapshot.aggregate.mock.calls) {
      expect(call[0].where).toEqual({ userId: USER_ID, platform: "THREADS" });
    }
  });
});

describe("getSocialAnalyticsSummary", () => {
  const FROM = new Date("2026-04-01");
  const TO = new Date("2026-04-15");

  it("returns a zeroed summary when there's no data", async () => {
    prismaMock.socialPost.findMany.mockResolvedValue([]);
    prismaMock.socialDailyStats.findMany.mockResolvedValue([]);
    prismaMock.socialFollowersSnapshot.findMany.mockResolvedValue([]);

    const result = await getSocialAnalyticsSummary("LINKEDIN", FROM, TO);
    expect(result.platform).toBe("LINKEDIN");
    expect(result.totalPosts).toBe(0);
    expect(result.totalImpressions).toBe(0);
    expect(result.avgEngagementRate).toBe(0);
    expect(result.latestFollowers).toBeNull();
    expect(result.topPosts).toEqual([]);
  });

  it("aggregates post metrics and picks top posts (ordered by impressions desc)", async () => {
    prismaMock.socialPost.findMany.mockResolvedValue([
      {
        externalPostId: "urn:li:activity:1",
        postUrl: "https://www.linkedin.com/feed/update/urn:li:activity:1",
        postedAt: new Date("2026-04-10"),
        text: "Top post",
        postType: "POST",
        impressions: 1000,
        engagements: 50,
        likes: 40,
      },
      {
        externalPostId: "urn:li:activity:2",
        postUrl: null,
        postedAt: new Date("2026-04-12"),
        text: "Second post",
        postType: "ARTICLE",
        impressions: 500,
        engagements: 10,
        likes: 5,
      },
    ]);
    prismaMock.socialDailyStats.findMany.mockResolvedValue([]);
    prismaMock.socialFollowersSnapshot.findMany.mockResolvedValue([]);

    const result = await getSocialAnalyticsSummary("LINKEDIN", FROM, TO);
    expect(result.totalPosts).toBe(2);
    expect(result.totalImpressions).toBe(1500);
    expect(result.totalEngagements).toBe(60);
    expect(result.avgPostImpressions).toBe(750);
    expect(result.maxPostImpressions).toBe(1000);
    // 60 / 1500 = 4%
    expect(result.avgEngagementRate).toBe(4);
    expect(result.topPosts[0]!.externalPostId).toBe("urn:li:activity:1");
    expect(result.topPosts[0]!.postedAt).toBe("2026-04-10");
  });

  it("computes net follower growth as (last - first) from snapshots, not by summing deltas", async () => {
    // Deltas here are intentionally wrong (sum=3) so the test proves
    // the code uses first/last, not sum: 1050 - 1000 = 50, never 3.
    prismaMock.socialPost.findMany.mockResolvedValue([]);
    prismaMock.socialDailyStats.findMany.mockResolvedValue([]);
    prismaMock.socialFollowersSnapshot.findMany.mockResolvedValue([
      { date: new Date("2026-04-01"), followersCount: 1000, deltaFollowers: 1 },
      { date: new Date("2026-04-08"), followersCount: 1030, deltaFollowers: 1 },
      { date: new Date("2026-04-15"), followersCount: 1050, deltaFollowers: 1 },
    ]);

    const result = await getSocialAnalyticsSummary("LINKEDIN", FROM, TO);
    expect(result.latestFollowers).toBe(1050);
    expect(result.netFollowerGrowth).toBe(50);
    expect(result.followersSeries).toHaveLength(3);
  });

  it("falls back to dailyStats delta when follower snapshots are missing (e.g. legacy X path)", async () => {
    prismaMock.socialPost.findMany.mockResolvedValue([]);
    prismaMock.socialDailyStats.findMany.mockResolvedValue([
      {
        date: new Date("2026-04-01"),
        impressions: 100,
        engagements: 5,
        newFollows: 20,
        unfollows: 2,
      },
      {
        date: new Date("2026-04-02"),
        impressions: 150,
        engagements: 10,
        newFollows: 30,
        unfollows: 5,
      },
    ]);
    prismaMock.socialFollowersSnapshot.findMany.mockResolvedValue([]);

    const result = await getSocialAnalyticsSummary("X", FROM, TO);
    expect(result.latestFollowers).toBeNull();
    // totalNewFollows (50) - totalUnfollows (7) = 43
    expect(result.netFollowerGrowth).toBe(43);
    expect(result.totalNewFollows).toBe(50);
  });

  it("buckets posts by calendar day (uses postedAt, not dailyStats)", async () => {
    prismaMock.socialPost.findMany.mockResolvedValue([
      {
        externalPostId: "1",
        postUrl: null,
        postedAt: new Date("2026-04-10T09:00:00Z"),
        text: "a",
        postType: "POST",
        impressions: 0,
        engagements: 0,
        likes: 0,
      },
      {
        externalPostId: "2",
        postUrl: null,
        postedAt: new Date("2026-04-10T18:00:00Z"),
        text: "b",
        postType: "POST",
        impressions: 0,
        engagements: 0,
        likes: 0,
      },
      {
        externalPostId: "3",
        postUrl: null,
        postedAt: new Date("2026-04-11T12:00:00Z"),
        text: "c",
        postType: "POST",
        impressions: 0,
        engagements: 0,
        likes: 0,
      },
    ]);
    prismaMock.socialDailyStats.findMany.mockResolvedValue([]);
    prismaMock.socialFollowersSnapshot.findMany.mockResolvedValue([]);

    const result = await getSocialAnalyticsSummary("LINKEDIN", FROM, TO);
    expect(result.postsByDay).toEqual([
      { date: "2026-04-10", posts: 2 },
      { date: "2026-04-11", posts: 1 },
    ]);
  });

  it("filters every read by (userId, platform) within the window", async () => {
    prismaMock.socialPost.findMany.mockResolvedValue([]);
    prismaMock.socialDailyStats.findMany.mockResolvedValue([]);
    prismaMock.socialFollowersSnapshot.findMany.mockResolvedValue([]);

    await getSocialAnalyticsSummary("THREADS", FROM, TO);

    expect(prismaMock.socialPost.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: USER_ID, platform: "THREADS", postedAt: { gte: FROM, lte: TO } },
      })
    );
    expect(prismaMock.socialDailyStats.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: USER_ID, platform: "THREADS", date: { gte: FROM, lte: TO } },
      })
    );
    expect(prismaMock.socialFollowersSnapshot.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: USER_ID, platform: "THREADS", date: { gte: FROM, lte: TO } },
      })
    );
  });
});
