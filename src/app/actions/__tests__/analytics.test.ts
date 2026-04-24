import { describe, it, expect, vi, beforeEach } from "vitest";

// Analytics actions are a mix of CSV imports (write path) and read-only
// wrappers that fan out to `@/lib/server/analytics`. Every Prisma call
// must be tenant-scoped (`userId` in the WHERE) — a missing filter would
// let one user read another user's post metrics or daily stats.

const { USER_ID } = vi.hoisted(() => ({ USER_ID: "user-analytics-1" }));

vi.mock("@/lib/auth", () => ({
  requireUserId: vi.fn().mockResolvedValue(USER_ID),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const prismaMock = vi.hoisted(() => ({
  socialPost: {
    findMany: vi.fn(),
    update: vi.fn(),
  },
  socialDailyStats: {
    findMany: vi.fn(),
    upsert: vi.fn(),
  },
  $transaction: vi.fn().mockImplementation(async (ops: Promise<unknown>[]) => Promise.all(ops)),
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const serverAnalyticsMock = vi.hoisted(() => ({
  getAnalyticsDateRange: vi.fn(),
  getAnalyticsSummary: vi.fn(),
  getEngagementHeatmap: vi.fn(),
  getRecentPostsWithSnapshots: vi.fn(),
  getPostVelocity: vi.fn(),
}));
vi.mock("@/lib/server/analytics", () => serverAnalyticsMock);

import { revalidatePath } from "next/cache";
import {
  importContentData,
  importDailyStats,
  getAnalyticsDateRange,
  getDailyStatsForPeriod,
  getPostsForPeriod,
  getAnalyticsSummary,
  getEngagementHeatmap,
  getRecentPostsWithSnapshots,
  getPostVelocity,
} from "../analytics";

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.socialPost.findMany.mockResolvedValue([]);
  prismaMock.socialDailyStats.findMany.mockResolvedValue([]);
  prismaMock.socialPost.update.mockResolvedValue({});
  prismaMock.socialDailyStats.upsert.mockResolvedValue({});
  serverAnalyticsMock.getAnalyticsDateRange.mockResolvedValue(null);
  serverAnalyticsMock.getAnalyticsSummary.mockResolvedValue({});
  serverAnalyticsMock.getEngagementHeatmap.mockResolvedValue([]);
  serverAnalyticsMock.getRecentPostsWithSnapshots.mockResolvedValue([]);
  serverAnalyticsMock.getPostVelocity.mockResolvedValue(null);
});

describe("importContentData — userId scoping & filtering", () => {
  it("short-circuits on all-invalid input without hitting DB", async () => {
    // Per source: when every row has a bad date, validRows is empty and
    // the function returns early with {0,0} — no findMany, no transaction.
    // (Note: skipped:0 here is by design of the early-return path; the
    // invalid-count only feeds into `skipped` when at least one valid row
    // reaches the DB.)
    const result = await importContentData([
      {
        date: "not-a-date",
        postId: "x-1",
        newFollowers: 0,
        detailExpands: 0,
      } as never,
    ]);

    expect(result).toEqual({ enriched: 0, skipped: 0 });
    expect(prismaMock.socialPost.findMany).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith("/analytics");
  });

  it("counts invalid-date rows toward skipped when mixed with valid rows", async () => {
    prismaMock.socialPost.findMany.mockResolvedValue([{ id: "row-1", externalPostId: "x-1" }]);

    const result = await importContentData([
      { date: "2026-04-01", postId: "x-1", newFollowers: 5, detailExpands: 1 } as never,
      { date: "not-a-date", postId: "x-bad", newFollowers: 0, detailExpands: 0 } as never,
    ]);

    // One valid+matched (enriched=1), one invalid-date (skipped=1).
    expect(result).toEqual({ enriched: 1, skipped: 1 });
  });

  it("scopes the socialPost.findMany lookup by (userId, platform:X)", async () => {
    await importContentData([
      {
        date: "2026-04-01",
        postId: "x-1",
        newFollowers: 10,
        detailExpands: 2,
      } as never,
    ]);

    expect(prismaMock.socialPost.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: USER_ID,
          platform: "X",
        }),
      })
    );
  });

  it("updates only rows the caller owns (skipped if not in existingByExternalId)", async () => {
    prismaMock.socialPost.findMany.mockResolvedValue([{ id: "row-1", externalPostId: "x-1" }]);

    const result = await importContentData([
      {
        date: "2026-04-01",
        postId: "x-1",
        newFollowers: 5,
        detailExpands: 1,
      } as never,
      {
        date: "2026-04-02",
        postId: "victim-id",
        newFollowers: 99,
        detailExpands: 99,
      } as never,
    ]);

    expect(result).toEqual({ enriched: 1, skipped: 1 });
    expect(prismaMock.socialPost.update).toHaveBeenCalledTimes(1);
    expect(prismaMock.socialPost.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "row-1" },
        data: expect.objectContaining({ newFollowers: 5, detailExpands: 1 }),
      })
    );
  });
});

describe("importDailyStats — userId scoping & classification", () => {
  it("scopes the existing-rows lookup by (userId, platform:X)", async () => {
    await importDailyStats([
      {
        date: "2026-04-01",
        impressions: 100,
      } as never,
    ]);

    expect(prismaMock.socialDailyStats.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: USER_ID,
          platform: "X",
        }),
      })
    );
  });

  it("classifies rows as imported vs updated based on existing set", async () => {
    // One date exists already, one is new.
    const existingDay = new Date(Date.UTC(2026, 3, 1));
    prismaMock.socialDailyStats.findMany.mockResolvedValue([{ date: existingDay }]);

    const result = await importDailyStats([
      { date: "2026-04-01", impressions: 5 } as never,
      { date: "2026-04-02", impressions: 7 } as never,
    ]);

    expect(result.imported).toBe(1);
    expect(result.updated).toBe(1);
  });

  it("upserts with userId in the composite key (no cross-tenant write)", async () => {
    await importDailyStats([{ date: "2026-04-01", impressions: 9 } as never]);

    expect(prismaMock.socialDailyStats.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_platform_date: {
            userId: USER_ID,
            platform: "X",
            date: expect.any(Date),
          },
        },
        create: expect.objectContaining({ userId: USER_ID, platform: "X" }),
      })
    );
  });

  it("returns zero imports when all rows have invalid dates", async () => {
    const result = await importDailyStats([
      { date: "not-a-date" } as never,
      { date: "also-not" } as never,
    ]);

    expect(result).toEqual({ imported: 0, updated: 0 });
    expect(prismaMock.socialDailyStats.findMany).not.toHaveBeenCalled();
  });
});

describe("read-only wrappers — delegate to server helpers with userId", () => {
  it("getAnalyticsDateRange forwards userId", async () => {
    await getAnalyticsDateRange();
    expect(serverAnalyticsMock.getAnalyticsDateRange).toHaveBeenCalledWith(USER_ID);
  });

  it("getAnalyticsSummary forwards (userId, from, to)", async () => {
    const from = new Date("2026-04-01");
    const to = new Date("2026-04-30");
    await getAnalyticsSummary(from, to);
    expect(serverAnalyticsMock.getAnalyticsSummary).toHaveBeenCalledWith(USER_ID, from, to);
  });

  it("getEngagementHeatmap forwards (userId, from, to)", async () => {
    const from = new Date("2026-04-01");
    const to = new Date("2026-04-30");
    await getEngagementHeatmap(from, to);
    expect(serverAnalyticsMock.getEngagementHeatmap).toHaveBeenCalledWith(USER_ID, from, to);
  });

  it("getRecentPostsWithSnapshots forwards (userId, limit)", async () => {
    await getRecentPostsWithSnapshots(5);
    expect(serverAnalyticsMock.getRecentPostsWithSnapshots).toHaveBeenCalledWith(USER_ID, 5);
  });

  it("getPostVelocity forwards (userId, postId) — ownership enforced downstream", async () => {
    await getPostVelocity("post-1");
    expect(serverAnalyticsMock.getPostVelocity).toHaveBeenCalledWith(USER_ID, "post-1");
  });

  it("getDailyStatsForPeriod scopes by userId + platform:X", async () => {
    const from = new Date("2026-04-01");
    const to = new Date("2026-04-30");
    await getDailyStatsForPeriod(from, to);

    expect(prismaMock.socialDailyStats.findMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, platform: "X", date: { gte: from, lte: to } },
      orderBy: { date: "asc" },
    });
  });

  it("getPostsForPeriod scopes by userId + platform:X", async () => {
    const from = new Date("2026-04-01");
    const to = new Date("2026-04-30");
    await getPostsForPeriod(from, to);

    expect(prismaMock.socialPost.findMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, platform: "X", postedAt: { gte: from, lte: to } },
      orderBy: { postedAt: "desc" },
    });
  });
});
