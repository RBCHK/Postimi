import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveTitleFromInput } from "../conversations";

// Mock fetchTweetFromText
vi.mock("@/lib/parse-tweet", () => ({
  fetchTweetFromText: vi.fn(),
}));

import { fetchTweetFromText } from "@/lib/parse-tweet";
const mockFetchTweet = vi.mocked(fetchTweetFromText);

// resolveTitleFromInput is a server action — it imports prisma/next internals,
// so we mock those too
vi.mock("@/lib/auth", () => ({
  requireUserId: vi.fn().mockResolvedValue("test-user-id"),
}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/x-api", () => ({ fetchTweetById: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/generated/prisma", () => ({
  ContentType: {},
  ConversationStatus: {},
}));

beforeEach(() => {
  mockFetchTweet.mockReset();
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
