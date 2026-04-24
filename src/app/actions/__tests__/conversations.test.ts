import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveTitleFromInput } from "../conversations";

// Mock fetchTweetFromText
vi.mock("@/lib/parse-tweet", () => ({
  fetchTweetFromText: vi.fn(),
  extractTweetUrl: vi.fn().mockReturnValue(null),
}));

import { fetchTweetFromText } from "@/lib/parse-tweet";
const mockFetchTweet = vi.mocked(fetchTweetFromText);

// `vi.mock` hoists above `const` initializers — use `vi.hoisted` for any
// binding the factory touches.
const { TEST_USER_ID } = vi.hoisted(() => ({ TEST_USER_ID: "test-user-id" }));

// resolveTitleFromInput and addMessage are server actions — they import
// prisma/next internals, so we mock those too.
vi.mock("@/lib/auth", () => ({
  requireUserId: vi.fn().mockResolvedValue(TEST_USER_ID),
}));
// `vi.mock` is hoisted above any module-level `const`, so top-level
// references inside the factory fail with "Cannot access X before
// initialization". `vi.hoisted` lets us declare mock spies in the
// hoisted region and then use them from both the factory and the tests.
const prismaConversationsMock = vi.hoisted(() => ({
  conversation: {
    findFirst: vi.fn(),
    updateMany: vi.fn(),
  },
  message: {
    create: vi.fn(),
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaConversationsMock }));
vi.mock("@/lib/x-api", () => ({ fetchTweetById: vi.fn() }));
vi.mock("@/lib/server/x-token", () => ({
  getXApiTokenForUser: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/ai-quota", () => ({
  checkRateLimit: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/generated/prisma", () => ({
  ContentType: {},
  ConversationStatus: {},
}));

beforeEach(() => {
  mockFetchTweet.mockReset();
  // Reset both implementation AND call history across tests so spies start
  // fresh each iteration. `mockResolvedValue` alone preserves prior calls.
  prismaConversationsMock.conversation.findFirst.mockReset();
  prismaConversationsMock.conversation.findFirst.mockResolvedValue({ id: "conv-1" });
  prismaConversationsMock.conversation.updateMany.mockReset();
  prismaConversationsMock.conversation.updateMany.mockResolvedValue({ count: 1 });
  prismaConversationsMock.message.create.mockReset();
  prismaConversationsMock.message.create.mockImplementation(({ data }: { data: { id?: string } }) =>
    Promise.resolve({ id: data.id ?? "generated-cuid" })
  );
});

describe("resolveTitleFromInput", () => {
  it("returns input as-is when no tweet URL", async () => {
    mockFetchTweet.mockResolvedValueOnce(null);

    const result = await resolveTitleFromInput("my custom topic");
    expect(result).toBe("my custom topic");
  });

  it("returns tweet text when URL resolves", async () => {
    mockFetchTweet.mockResolvedValueOnce({ text: "This is the tweet text" });

    const result = await resolveTitleFromInput("https://x.com/user/status/123");
    expect(result).toBe("This is the tweet text");
  });

  it("truncates tweet text longer than 80 chars", async () => {
    const longText = "A".repeat(100);
    mockFetchTweet.mockResolvedValueOnce({ text: longText });

    const result = await resolveTitleFromInput("https://x.com/user/status/123");
    expect(result).toBe("A".repeat(80) + "…");
    expect(result.length).toBe(81);
  });

  it("does not truncate tweet text of exactly 80 chars", async () => {
    const exactText = "B".repeat(80);
    mockFetchTweet.mockResolvedValueOnce({ text: exactText });

    const result = await resolveTitleFromInput("https://x.com/user/status/123");
    expect(result).toBe(exactText);
  });
});

// ─── addMessage id validation ──────────────────────────────

describe("addMessage — client-supplied id guard", () => {
  it("forwards a cuid-shaped id to Prisma unchanged", async () => {
    const { addMessage } = await import("../conversations");
    const cuid = "clh1x2q3v0000abcd8tf4hqrs"; // cuid v1 shape

    await addMessage("conv-1", "assistant", "hello", cuid);

    expect(prismaConversationsMock.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ id: cuid, conversationId: "conv-1" }),
      })
    );
  });

  it("drops a malformed id and lets Prisma generate one", async () => {
    const { addMessage } = await import("../conversations");
    // Garbage: slash, spaces, and SQL-ish syntax are not allowed
    const malformed = "'; DROP TABLE messages; --";

    await addMessage("conv-1", "user", "hello", malformed);

    const createArgs = prismaConversationsMock.message.create.mock.calls[0][0];
    expect(createArgs.data.id).toBeUndefined();
    expect(createArgs.data.content).toBe("hello");
  });

  it("rejects an id longer than the 48-char cap", async () => {
    const { addMessage } = await import("../conversations");
    const tooLong = "a".repeat(49);

    await addMessage("conv-1", "user", "hello", tooLong);

    const createArgs = prismaConversationsMock.message.create.mock.calls[0][0];
    expect(createArgs.data.id).toBeUndefined();
  });

  it("returns null without touching Prisma when conversation is not owned by current user", async () => {
    prismaConversationsMock.conversation.findFirst.mockResolvedValueOnce(null);
    const { addMessage } = await import("../conversations");

    const result = await addMessage("foreign-conv", "user", "hello");

    expect(result).toBeNull();
    expect(prismaConversationsMock.message.create).not.toHaveBeenCalled();
    expect(prismaConversationsMock.conversation.updateMany).not.toHaveBeenCalled();
  });
});
