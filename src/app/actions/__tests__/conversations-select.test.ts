import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ─────────────────────────────────────────────────
//
// Guards the Track G perf fix: `getConversations` / `getConversation`
// must return only the whitelisted columns and cap message history at
// 100 rows. Regressions here silently re-inflate every sidebar load and
// every conversation-page navigation with tens of KB of JSON per row
// (composerContent, pendingInput, originalPostText, etc.).

const { TEST_USER_ID } = vi.hoisted(() => ({ TEST_USER_ID: "test-user-id" }));

vi.mock("@/lib/auth", () => ({
  requireUserId: vi.fn().mockResolvedValue(TEST_USER_ID),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// No mock for @/generated/prisma — enums are only used as TypeScript type
// annotations in the SUT (erased at compile time). Loading the real
// generated enum exports means any future code that starts comparing
// values at runtime will actually work; the empty `{}` mock would have
// silently returned undefined.

vi.mock("@/lib/server/media", () => ({
  deleteMediaStorageForConversation: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/parse-tweet", () => ({
  fetchTweetFromText: vi.fn(),
  extractTweetUrl: vi.fn().mockReturnValue(null),
}));

vi.mock("@/lib/x-api", () => ({ fetchTweetById: vi.fn() }));
vi.mock("@/lib/server/x-token", () => ({
  getXApiTokenForUser: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/ai-quota", () => ({
  checkRateLimit: vi.fn().mockResolvedValue(undefined),
}));

const prismaMock = vi.hoisted(() => ({
  conversation: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.conversation.findMany.mockResolvedValue([]);
  prismaMock.conversation.findFirst.mockResolvedValue(null);
});

// ─── getConversations ─────────────────────────────────────

describe("getConversations — select + pagination", () => {
  it("selects only the fields the Draft type consumes (no composerContent / originalPostText / pendingInput)", async () => {
    const { getConversations } = await import("../conversations");
    await getConversations();

    const args = prismaMock.conversation.findMany.mock.calls[0]![0];
    expect(args.select).toEqual({
      id: true,
      title: true,
      contentType: true,
      status: true,
      pinned: true,
      updatedAt: true,
      originalPostUrl: true,
    });
    // Explicit: any of these fields would re-inflate bandwidth.
    expect(args.select).not.toHaveProperty("composerContent");
    expect(args.select).not.toHaveProperty("originalPostText");
    expect(args.select).not.toHaveProperty("pendingInput");
  });

  it("caps results at 200 rows via `take`", async () => {
    const { getConversations } = await import("../conversations");
    await getConversations();

    const args = prismaMock.conversation.findMany.mock.calls[0]![0];
    expect(args.take).toBe(200);
  });

  it("filters by the caller's userId and DRAFT status", async () => {
    const { getConversations } = await import("../conversations");
    await getConversations();

    const args = prismaMock.conversation.findMany.mock.calls[0]![0];
    expect(args.where.userId).toBe(TEST_USER_ID);
    expect(args.where.status).toEqual({ in: ["DRAFT"] });
  });

  it("maps Prisma rows to the Draft shape without extra columns", async () => {
    prismaMock.conversation.findMany.mockResolvedValueOnce([
      {
        id: "c-1",
        title: "Sample",
        contentType: "POST",
        status: "DRAFT",
        pinned: false,
        updatedAt: new Date("2026-04-01"),
        originalPostUrl: null,
      },
    ]);

    const { getConversations } = await import("../conversations");
    const result = await getConversations();

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: "c-1",
      title: "Sample",
      contentType: "Post",
      status: "draft",
      pinned: false,
      updatedAt: new Date("2026-04-01"),
      originalPostUrl: undefined,
    });
  });
});

// ─── getConversation ──────────────────────────────────────

describe("getConversation — select on messages + notes", () => {
  it("requests only the columns the client consumes, including message / note whitelists", async () => {
    prismaMock.conversation.findFirst.mockResolvedValueOnce({
      id: "c-1",
      title: "t",
      contentType: "POST",
      status: "DRAFT",
      originalPostText: null,
      originalPostUrl: null,
      composerContent: null,
      composerPlatform: null,
      pendingInput: null,
      updatedAt: new Date(),
      messages: [],
      notes: [],
    });

    const { getConversation } = await import("../conversations");
    await getConversation("c-1");

    const args = prismaMock.conversation.findFirst.mock.calls[0]![0];
    // Top-level select whitelist.
    expect(args.select.id).toBe(true);
    expect(args.select.composerContent).toBe(true);
    expect(args.select.messages).toEqual({
      select: { id: true, role: true, content: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    expect(args.select.notes).toEqual({
      select: { id: true, messageId: true, content: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
  });

  it("reverses the `desc + take` window so the client sees messages in chronological order", async () => {
    // Prisma returns the latest 3 messages in desc order; the consumer
    // expects them ordered oldest-first (the index uses the
    // `conversationId, createdAt` index either way).
    const t0 = new Date("2026-04-01T10:00:00Z");
    const t1 = new Date("2026-04-01T10:01:00Z");
    const t2 = new Date("2026-04-01T10:02:00Z");
    prismaMock.conversation.findFirst.mockResolvedValueOnce({
      id: "c-1",
      title: "t",
      contentType: "POST",
      status: "DRAFT",
      originalPostText: null,
      originalPostUrl: null,
      composerContent: null,
      composerPlatform: null,
      pendingInput: null,
      updatedAt: new Date(),
      messages: [
        { id: "m3", role: "assistant", content: "c", createdAt: t2 },
        { id: "m2", role: "user", content: "b", createdAt: t1 },
        { id: "m1", role: "assistant", content: "a", createdAt: t0 },
      ],
      notes: [],
    });

    const { getConversation } = await import("../conversations");
    const result = await getConversation("c-1");

    expect(result).not.toBeNull();
    expect(result!.messages.map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
  });

  it("returns null for a conversation owned by another user (findFirst returned null)", async () => {
    prismaMock.conversation.findFirst.mockResolvedValueOnce(null);

    const { getConversation } = await import("../conversations");
    const result = await getConversation("foreign-id");

    expect(result).toBeNull();
  });
});
