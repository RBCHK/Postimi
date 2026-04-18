import { describe, it, expect, vi, beforeEach } from "vitest";

// ADR-008 Phase 1a contract tests. Verify that the legacy write and the
// SocialPost / SocialDailyStats / SocialFollowersSnapshot write run in
// parallel (dual-write), that SocialPost failures never abort the legacy
// write, and that each dual-write path includes `platform: "X"`.

const TEST_USER_ID = "user-phase1a";

vi.mock("@/lib/auth", () => ({
  requireUserId: vi.fn().mockResolvedValue(TEST_USER_ID),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const sentryMock = { captureException: vi.fn() };
vi.mock("@sentry/nextjs", () => sentryMock);

// Prisma mock — only the delegates the dual-write touches.
const prismaMock = {
  xPost: {
    findUnique: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
  },
  socialPost: {
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    upsert: vi.fn(),
  },
  dailyAccountStats: {
    findUnique: vi.fn(),
    upsert: vi.fn().mockResolvedValue({}),
  },
  socialDailyStats: {
    upsert: vi.fn().mockResolvedValue({}),
  },
  followersSnapshot: {
    findFirst: vi.fn(),
    upsert: vi.fn(),
  },
  socialFollowersSnapshot: {
    upsert: vi.fn().mockResolvedValue({}),
  },
};

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

beforeEach(() => {
  vi.clearAllMocks();
  sentryMock.captureException.mockClear();
});

// ─── importContentData ───────────────────────────────────

describe("importContentData — dual-write", () => {
  it("updates XPost and SocialPost for the same externalPostId", async () => {
    prismaMock.xPost.findUnique.mockResolvedValue({ id: "xpost-1" });

    const { importContentData } = await import("../analytics");
    await importContentData([
      {
        postId: "123",
        date: "2026-04-17",
        text: "hi",
        postLink: "https://x.com/123",
        postType: "Post",
        impressions: 10,
        likes: 1,
        engagements: 2,
        bookmarks: 0,
        shares: 0,
        newFollowers: 3,
        replies: 0,
        reposts: 0,
        profileVisits: 0,
        detailExpands: 5,
        urlClicks: 0,
      },
    ]);

    expect(prismaMock.xPost.update).toHaveBeenCalledTimes(1);
    expect(prismaMock.xPost.update).toHaveBeenCalledWith({
      where: { userId_postId: { userId: TEST_USER_ID, postId: "123" } },
      data: { newFollowers: 3, detailExpands: 5 },
    });

    expect(prismaMock.socialPost.updateMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.socialPost.updateMany).toHaveBeenCalledWith({
      where: { userId: TEST_USER_ID, platform: "X", externalPostId: "123" },
      data: { newFollowers: 3, detailExpands: 5 },
    });
  });

  it("SocialPost failure is caught, Sentry captures, enriched count still increments", async () => {
    prismaMock.xPost.findUnique.mockResolvedValue({ id: "xpost-1" });
    prismaMock.socialPost.updateMany.mockRejectedValueOnce(new Error("db down"));

    const { importContentData } = await import("../analytics");
    const result = await importContentData([
      {
        postId: "456",
        date: "2026-04-17",
        text: "t",
        postLink: "",
        postType: "Post",
        impressions: 0,
        likes: 0,
        engagements: 0,
        bookmarks: 0,
        shares: 0,
        newFollowers: 0,
        replies: 0,
        reposts: 0,
        profileVisits: 0,
        detailExpands: 0,
        urlClicks: 0,
      },
    ]);

    expect(result.enriched).toBe(1);
    expect(result.skipped).toBe(0);
    expect(prismaMock.xPost.update).toHaveBeenCalledTimes(1);
    expect(sentryMock.captureException).toHaveBeenCalledTimes(1);
    const call = sentryMock.captureException.mock.calls[0]!;
    expect(call[1]?.tags).toMatchObject({
      phase: "1a-dual-write",
      model: "SocialPost",
      platform: "X",
    });
  });

  it("skips row when XPost does not exist — no dual-write either", async () => {
    prismaMock.xPost.findUnique.mockResolvedValue(null);

    const { importContentData } = await import("../analytics");
    const result = await importContentData([
      {
        postId: "999",
        date: "2026-04-17",
        text: "t",
        postLink: "",
        postType: "Post",
        impressions: 0,
        likes: 0,
        engagements: 0,
        bookmarks: 0,
        shares: 0,
        newFollowers: 0,
        replies: 0,
        reposts: 0,
        profileVisits: 0,
        detailExpands: 0,
        urlClicks: 0,
      },
    ]);

    expect(result.skipped).toBe(1);
    expect(prismaMock.xPost.update).not.toHaveBeenCalled();
    expect(prismaMock.socialPost.updateMany).not.toHaveBeenCalled();
  });
});

// ─── importDailyStats ────────────────────────────────────

describe("importDailyStats — dual-write", () => {
  it("upserts DailyAccountStats and SocialDailyStats with identical metrics and platform=X", async () => {
    prismaMock.dailyAccountStats.findUnique.mockResolvedValue(null);

    const { importDailyStats } = await import("../analytics");
    await importDailyStats([
      {
        date: "2026-04-17",
        impressions: 100,
        likes: 5,
        engagements: 10,
        bookmarks: 2,
        shares: 1,
        newFollows: 3,
        unfollows: 1,
        replies: 4,
        reposts: 2,
        profileVisits: 20,
        createPost: 1,
        videoViews: 30,
        mediaViews: 40,
      },
    ]);

    expect(prismaMock.dailyAccountStats.upsert).toHaveBeenCalledTimes(1);
    expect(prismaMock.socialDailyStats.upsert).toHaveBeenCalledTimes(1);

    const socialCall = prismaMock.socialDailyStats.upsert.mock.calls[0]![0];
    expect(socialCall.where.userId_platform_date.platform).toBe("X");
    expect(socialCall.where.userId_platform_date.userId).toBe(TEST_USER_ID);
    expect(socialCall.create.platform).toBe("X");
    expect(socialCall.create.impressions).toBe(100);
    expect(socialCall.update.impressions).toBe(100);

    // Both writes must share the same normalized `date` so later reads
    // of X data from either table align row-for-row.
    const legacyDayStart = prismaMock.dailyAccountStats.upsert.mock.calls[0]![0].where.userId_date
      .date as Date;
    const socialDayStart = socialCall.where.userId_platform_date.date as Date;
    expect(legacyDayStart.toISOString()).toBe(socialDayStart.toISOString());
  });

  it("SocialDailyStats failure does not abort legacy write", async () => {
    prismaMock.dailyAccountStats.findUnique.mockResolvedValue(null);
    prismaMock.socialDailyStats.upsert.mockRejectedValueOnce(new Error("boom"));

    const { importDailyStats } = await import("../analytics");
    const result = await importDailyStats([
      {
        date: "2026-04-17",
        impressions: 0,
        likes: 0,
        engagements: 0,
        bookmarks: 0,
        shares: 0,
        newFollows: 0,
        unfollows: 0,
        replies: 0,
        reposts: 0,
        profileVisits: 0,
        createPost: 0,
        videoViews: 0,
        mediaViews: 0,
      },
    ]);

    expect(result.imported).toBe(1);
    expect(prismaMock.dailyAccountStats.upsert).toHaveBeenCalledTimes(1);
    expect(sentryMock.captureException).toHaveBeenCalledTimes(1);
    expect(sentryMock.captureException.mock.calls[0]![1]?.tags).toMatchObject({
      phase: "1a-dual-write",
      model: "SocialDailyStats",
      platform: "X",
    });
  });
});

// ─── saveFollowersSnapshotInternal ───────────────────────

describe("saveFollowersSnapshotInternal — dual-write", () => {
  const UTC_TODAY = (() => {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    return d;
  })();

  it("upserts FollowersSnapshot and SocialFollowersSnapshot with same deltas", async () => {
    prismaMock.followersSnapshot.findFirst.mockResolvedValue({
      followersCount: 100,
      followingCount: 50,
    });
    prismaMock.followersSnapshot.upsert.mockResolvedValue({
      id: "fs-1",
      date: UTC_TODAY,
      followersCount: 110,
      followingCount: 52,
      deltaFollowers: 10,
      deltaFollowing: 2,
    });

    const { saveFollowersSnapshotInternal } = await import("../followers");
    await saveFollowersSnapshotInternal("user-xyz", {
      followersCount: 110,
      followingCount: 52,
    });

    expect(prismaMock.followersSnapshot.upsert).toHaveBeenCalledTimes(1);
    expect(prismaMock.socialFollowersSnapshot.upsert).toHaveBeenCalledTimes(1);

    const legacyArgs = prismaMock.followersSnapshot.upsert.mock.calls[0]![0];
    const socialArgs = prismaMock.socialFollowersSnapshot.upsert.mock.calls[0]![0];

    expect(socialArgs.where.userId_platform_date.platform).toBe("X");
    expect(socialArgs.where.userId_platform_date.userId).toBe("user-xyz");
    expect(socialArgs.create.platform).toBe("X");
    expect(socialArgs.create.deltaFollowers).toBe(legacyArgs.create.deltaFollowers);
    expect(socialArgs.create.deltaFollowing).toBe(legacyArgs.create.deltaFollowing);
    expect(socialArgs.create.followersCount).toBe(110);
    expect(socialArgs.create.followingCount).toBe(52);
  });

  it("SocialFollowersSnapshot failure does not abort legacy write nor return", async () => {
    prismaMock.followersSnapshot.findFirst.mockResolvedValue(null);
    prismaMock.followersSnapshot.upsert.mockResolvedValue({
      id: "fs-2",
      date: UTC_TODAY,
      followersCount: 1,
      followingCount: 1,
      deltaFollowers: 0,
      deltaFollowing: 0,
    });
    prismaMock.socialFollowersSnapshot.upsert.mockRejectedValueOnce(new Error("pg down"));

    const { saveFollowersSnapshotInternal } = await import("../followers");
    const result = await saveFollowersSnapshotInternal("user-xyz", {
      followersCount: 1,
      followingCount: 1,
    });

    expect(result.id).toBe("fs-2");
    expect(sentryMock.captureException).toHaveBeenCalledTimes(1);
    expect(sentryMock.captureException.mock.calls[0]![1]?.tags).toMatchObject({
      phase: "1a-dual-write",
      model: "SocialFollowersSnapshot",
      platform: "X",
    });
  });
});
