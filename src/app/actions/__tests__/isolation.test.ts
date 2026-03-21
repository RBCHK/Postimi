import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ───────────────────────────────────────────────

const TEST_USER_ID = "user-1";

vi.mock("@/lib/auth", () => ({
  requireUserId: vi.fn().mockResolvedValue(TEST_USER_ID),
  requireUser: vi.fn().mockResolvedValue({ id: TEST_USER_ID, timezone: "UTC" }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/generated/prisma", () => ({
  ContentType: {},
  ConversationStatus: {},
  XPostType: {},
  SlotType: {},
}));

vi.mock("@/lib/date-utils", () => ({
  calendarDateStr: vi.fn().mockReturnValue("2099-01-01"),
}));

// Prisma mock with spies
const prismaMock = {
  xPost: {
    findMany: vi.fn().mockResolvedValue([]),
    findUnique: vi.fn().mockResolvedValue(null),
    aggregate: vi.fn().mockResolvedValue({ _min: { date: null }, _max: { date: null } }),
  },
  dailyAccountStats: {
    findMany: vi.fn().mockResolvedValue([]),
    aggregate: vi.fn().mockResolvedValue({ _min: { date: null }, _max: { date: null } }),
  },
  scheduledSlot: {
    findMany: vi.fn().mockResolvedValue([]),
    findFirst: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({
      id: "new-slot-1",
      date: new Date("2026-01-06T00:00:00.000Z"),
      timeSlot: "9:00 AM",
    }),
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
  },
  trendSnapshot: {
    findFirst: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
    createMany: vi.fn().mockResolvedValue({ count: 0 }),
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
  },
  conversation: {
    findMany: vi.fn().mockResolvedValue([]),
    findFirst: vi.fn().mockResolvedValue(null),
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
  },
  postEngagementSnapshot: {
    groupBy: vi.fn().mockResolvedValue([]),
    findMany: vi.fn().mockResolvedValue([]),
  },
  strategyConfig: {
    findFirst: vi.fn().mockResolvedValue(null),
  },
};

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/parse-tweet", () => ({
  fetchTweetFromText: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/x-api", () => ({ fetchTweetById: vi.fn() }));
vi.mock("@/app/actions/x-token", () => ({
  getXApiTokenForUserInternal: vi.fn().mockResolvedValue(null),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Tests ───────────────────────────────────────────────

describe("userId isolation — analytics", () => {
  it("getPostsForPeriod filters by userId", async () => {
    const { getPostsForPeriod } = await import("../analytics");
    const from = new Date("2026-01-01");
    const to = new Date("2026-01-31");

    await getPostsForPeriod(from, to);

    expect(prismaMock.xPost.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: TEST_USER_ID }),
      })
    );
  });

  it("getDailyStatsForPeriod filters by userId", async () => {
    const { getDailyStatsForPeriod } = await import("../analytics");
    const from = new Date("2026-01-01");
    const to = new Date("2026-01-31");

    await getDailyStatsForPeriod(from, to);

    expect(prismaMock.dailyAccountStats.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: TEST_USER_ID }),
      })
    );
  });

  it("getRecentPostsWithSnapshots filters by userId", async () => {
    const { getRecentPostsWithSnapshots } = await import("../analytics");

    await getRecentPostsWithSnapshots();

    expect(prismaMock.postEngagementSnapshot.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: TEST_USER_ID }),
      })
    );
  });

  it("getPostVelocity filters by userId", async () => {
    const { getPostVelocity } = await import("../analytics");

    await getPostVelocity("post-123");

    expect(prismaMock.xPost.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId_postId: { userId: TEST_USER_ID, postId: "post-123" },
        }),
      })
    );
  });

  it("getEngagementHeatmap filters by userId", async () => {
    const { getEngagementHeatmap } = await import("../analytics");
    const from = new Date("2026-01-01");
    const to = new Date("2026-01-31");

    await getEngagementHeatmap(from, to);

    expect(prismaMock.xPost.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: TEST_USER_ID }),
      })
    );
  });
});

describe("userId isolation — schedule", () => {
  it("getScheduledSlots fetches only FILLED/POSTED (not EMPTY) for userId", async () => {
    const { getScheduledSlots } = await import("../schedule");

    await getScheduledSlots();

    expect(prismaMock.scheduledSlot.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: TEST_USER_ID,
          status: { in: ["FILLED", "POSTED"] },
        }),
      })
    );
  });

  it("deleteSlot checks userId before deleting", async () => {
    const { deleteSlot } = await import("../schedule");

    await deleteSlot("slot-1");

    expect(prismaMock.scheduledSlot.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "slot-1", userId: TEST_USER_ID }),
      })
    );
  });

  it("hasEmptySlots returns false when no schedule config", async () => {
    prismaMock.strategyConfig.findFirst.mockResolvedValueOnce(null);
    const { hasEmptySlots } = await import("../schedule");

    const result = await hasEmptySlots("POST");

    expect(result).toBe(false);
    expect(prismaMock.strategyConfig.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: TEST_USER_ID }),
      })
    );
  });

  it("addToQueue creates FILLED slot with correct userId", async () => {
    prismaMock.strategyConfig.findFirst.mockResolvedValueOnce({
      scheduleConfig: {
        posts: {
          slots: [
            {
              id: "s1",
              time: "09:00",
              days: { Mon: true, Tue: true, Wed: true, Thu: true, Fri: true, Sat: true, Sun: true },
            },
          ],
        },
        replies: { slots: [] },
        threads: { slots: [] },
        articles: { slots: [] },
        quotes: { slots: [] },
      },
    });

    const { addToQueue } = await import("../schedule");
    await addToQueue("test content", undefined, "POST");

    expect(prismaMock.scheduledSlot.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: TEST_USER_ID, status: "FILLED" }),
      })
    );
  });
});

describe("userId isolation — trends", () => {
  it("getLatestTrends filters by userId", async () => {
    const { getLatestTrends } = await import("../trends");

    await getLatestTrends();

    expect(prismaMock.trendSnapshot.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: TEST_USER_ID }),
      })
    );
  });

  it("cleanupOldTrends filters by userId", async () => {
    const { cleanupOldTrends } = await import("../trends");

    await cleanupOldTrends(10);

    expect(prismaMock.trendSnapshot.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: TEST_USER_ID }),
      })
    );
  });
});

describe("userId isolation — conversations", () => {
  it("getConversations filters by userId", async () => {
    const { getConversations } = await import("../conversations");

    await getConversations();

    expect(prismaMock.conversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: TEST_USER_ID }),
      })
    );
  });

  it("deleteConversation filters by userId", async () => {
    const { deleteConversation } = await import("../conversations");

    await deleteConversation("conv-1");

    expect(prismaMock.conversation.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "conv-1", userId: TEST_USER_ID }),
      })
    );
  });
});
