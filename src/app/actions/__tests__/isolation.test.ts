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
  SlotType: {},
}));

vi.mock("@/lib/date-utils", () => ({
  calendarDateStr: vi.fn().mockReturnValue("2099-01-01"),
  nowInTimezone: vi
    .fn()
    .mockReturnValue({ dateStr: "2099-01-01", timeSlot: "12:00 AM", date: new Date() }),
  time24to12: vi.fn().mockImplementation((t: string) => t),
  isSlotFuture: vi.fn().mockReturnValue(true),
  addUTCDays: vi.fn().mockImplementation((d: Date, n: number) => {
    const r = new Date(d);
    r.setUTCDate(r.getUTCDate() + n);
    return r;
  }),
  slotToUtcDate: vi.fn().mockImplementation((d: Date) => d),
}));

// Prisma mock with spies
const prismaMock = {
  socialPost: {
    findMany: vi.fn().mockResolvedValue([]),
    findFirst: vi.fn().mockResolvedValue(null),
    findUnique: vi.fn().mockResolvedValue(null),
    aggregate: vi.fn().mockResolvedValue({ _min: { postedAt: null }, _max: { postedAt: null } }),
  },
  socialDailyStats: {
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
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
  },
  socialPostEngagementSnapshot: {
    groupBy: vi.fn().mockResolvedValue([]),
    findMany: vi.fn().mockResolvedValue([]),
  },
  strategyConfig: {
    findFirst: vi.fn().mockResolvedValue(null),
  },
  media: {
    findMany: vi.fn().mockResolvedValue([]),
  },
};

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/supabase", () => ({
  getSupabase: vi.fn().mockReturnValue({
    storage: {
      from: vi.fn().mockReturnValue({
        remove: vi.fn().mockResolvedValue({ data: null, error: null }),
      }),
    },
  }),
  MEDIA_BUCKET: "media",
}));
vi.mock("@/lib/parse-tweet", () => ({
  fetchTweetFromText: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/x-api", () => ({ fetchTweetById: vi.fn() }));
vi.mock("@/lib/server/x-token", () => ({
  getXApiTokenForUser: vi.fn().mockResolvedValue(null),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Tests ───────────────────────────────────────────────

describe("userId isolation — analytics", () => {
  it("getPostsForPeriod filters by userId + platform=X", async () => {
    const { getPostsForPeriod } = await import("../analytics");
    const from = new Date("2026-01-01");
    const to = new Date("2026-01-31");

    await getPostsForPeriod(from, to);

    expect(prismaMock.socialPost.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: TEST_USER_ID, platform: "X" }),
      })
    );
  });

  it("getDailyStatsForPeriod filters by userId + platform=X", async () => {
    const { getDailyStatsForPeriod } = await import("../analytics");
    const from = new Date("2026-01-01");
    const to = new Date("2026-01-31");

    await getDailyStatsForPeriod(from, to);

    expect(prismaMock.socialDailyStats.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: TEST_USER_ID, platform: "X" }),
      })
    );
  });

  it("getRecentPostsWithSnapshots filters by userId + platform=X", async () => {
    const { getRecentPostsWithSnapshots } = await import("../analytics");

    await getRecentPostsWithSnapshots();

    expect(prismaMock.socialPostEngagementSnapshot.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: TEST_USER_ID, platform: "X" }),
      })
    );
  });

  it("getPostVelocity filters by userId + platform=X", async () => {
    const { getPostVelocity } = await import("../analytics");

    await getPostVelocity("post-123");

    expect(prismaMock.socialPost.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "post-123",
          userId: TEST_USER_ID,
          platform: "X",
        }),
      })
    );
  });

  it("getEngagementHeatmap filters by userId + platform=X", async () => {
    const { getEngagementHeatmap } = await import("../analytics");
    const from = new Date("2026-01-01");
    const to = new Date("2026-01-31");

    await getEngagementHeatmap(from, to);

    expect(prismaMock.socialPost.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: TEST_USER_ID, platform: "X" }),
      })
    );
  });
});

describe("userId isolation — schedule", () => {
  it("getScheduledSlots fetches only SCHEDULED/POSTED (not EMPTY) for userId", async () => {
    const { getScheduledSlots } = await import("../schedule");

    await getScheduledSlots();

    expect(prismaMock.scheduledSlot.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: TEST_USER_ID,
          status: { in: ["SCHEDULED", "POSTED"] },
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

  it("addToQueue creates SCHEDULED slot with correct userId", async () => {
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
        data: expect.objectContaining({ userId: TEST_USER_ID, status: "SCHEDULED" }),
      })
    );
  });

  // ─── Regression: cross-tenant Conversation.update via Server Action parameter ───

  it("addToQueue rejects a conversationId owned by another user", async () => {
    // Victim's conversationId, attacker's userId → findFirst returns null → throw
    prismaMock.conversation.findFirst.mockResolvedValueOnce(null);

    const { addToQueue } = await import("../schedule");

    await expect(addToQueue("attack", "victim-conv-id", "POST")).rejects.toThrow(
      "Conversation not found"
    );

    // Must NOT have reached the slot-creation or conversation-update code paths
    expect(prismaMock.scheduledSlot.create).not.toHaveBeenCalled();
    expect(prismaMock.conversation.updateMany).not.toHaveBeenCalled();
  });

  it("addToQueue scopes Conversation.updateMany by userId (defense-in-depth)", async () => {
    // Conversation exists for the current user (ownership check passes)
    prismaMock.conversation.findFirst.mockResolvedValueOnce({ id: "own-conv" });
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
    await addToQueue("test content", "own-conv", "POST");

    // The atomic update must carry userId in the WHERE clause
    expect(prismaMock.conversation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "own-conv", userId: TEST_USER_ID }),
        data: expect.objectContaining({ status: "SCHEDULED" }),
      })
    );
  });

  it("publishPost rejects a conversationId owned by another user", async () => {
    prismaMock.conversation.findFirst.mockResolvedValueOnce(null);

    const { publishPost } = await import("../schedule");

    await expect(publishPost("victim-conv-id", "attack-text")).rejects.toThrow(
      "Conversation not found"
    );

    // Must abort before any platform post, slot creation, or conversation update
    expect(prismaMock.scheduledSlot.create).not.toHaveBeenCalled();
    expect(prismaMock.conversation.updateMany).not.toHaveBeenCalled();
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
