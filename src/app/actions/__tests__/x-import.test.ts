import { describe, it, expect, vi, beforeEach } from "vitest";

// importFromXApi is the manual "Import from X" Server Action. It fetches
// new tweets via the X API, upserts them as SocialPost rows with
// platform:X, and classifies each as imported vs updated.
//
// Security-critical assertions:
//   - must authenticate before any DB/API call,
//   - throws XApiNoTokenError when the user has no token (no API call),
//   - every Prisma lookup and upsert carries userId + platform:"X" so a
//     forged externalPostId can't flip another user's row.

const { USER_ID } = vi.hoisted(() => ({ USER_ID: "user-x-import-1" }));

vi.mock("@/lib/auth", () => ({
  requireUserId: vi.fn().mockResolvedValue(USER_ID),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const xApiMock = vi.hoisted(() => ({
  fetchUserTweets: vi.fn(),
  XApiNoTokenError: class XApiNoTokenError extends Error {
    constructor(userId?: string) {
      super(`No X API token for user ${userId}`);
      this.name = "XApiNoTokenError";
    }
  },
}));
vi.mock("@/lib/x-api", () => xApiMock);

const xTokenMock = vi.hoisted(() => ({ getXApiTokenForUser: vi.fn() }));
vi.mock("@/lib/server/x-token", () => xTokenMock);

const prismaMock = vi.hoisted(() => ({
  socialPost: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    upsert: vi.fn(),
  },
  $transaction: vi.fn().mockImplementation(async (ops: Promise<unknown>[]) => Promise.all(ops)),
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

import { revalidatePath } from "next/cache";
import { importFromXApi } from "../x-import";

function tweet(overrides: Partial<{ postId: string; text: string }> = {}) {
  return {
    postId: "t-1",
    createdAt: new Date("2026-04-20"),
    text: "hello",
    postLink: "https://x.com/u/1",
    impressions: 10,
    likes: 1,
    engagements: 2,
    bookmarks: 0,
    replies: 0,
    reposts: 0,
    quoteCount: 0,
    urlClicks: 0,
    profileVisits: undefined,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  xTokenMock.getXApiTokenForUser.mockResolvedValue({
    accessToken: "tok",
    refreshToken: "r",
    expiresAt: new Date(Date.now() + 3600_000),
  });
  xApiMock.fetchUserTweets.mockResolvedValue([]);
  prismaMock.socialPost.findFirst.mockResolvedValue(null);
  prismaMock.socialPost.findMany.mockResolvedValue([]);
  prismaMock.socialPost.upsert.mockResolvedValue({});
});

describe("importFromXApi — auth & token handling", () => {
  it("throws XApiNoTokenError when the user has no X connection", async () => {
    xTokenMock.getXApiTokenForUser.mockResolvedValue(null);

    await expect(importFromXApi()).rejects.toThrow(/No X API token/);

    // No tweets fetched, no DB writes.
    expect(xApiMock.fetchUserTweets).not.toHaveBeenCalled();
    expect(prismaMock.socialPost.upsert).not.toHaveBeenCalled();
  });

  it("scopes the latest-post lookup by (userId, platform:X)", async () => {
    await importFromXApi();

    expect(prismaMock.socialPost.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: USER_ID, platform: "X" },
        orderBy: { postedAt: "desc" },
      })
    );
  });

  it("passes maxResults and latest externalPostId to fetchUserTweets", async () => {
    prismaMock.socialPost.findFirst.mockResolvedValue({ externalPostId: "t-prev" });

    await importFromXApi(50);

    expect(xApiMock.fetchUserTweets).toHaveBeenCalledWith(
      expect.any(Object), // credentials
      50,
      "t-prev"
    );
  });
});

describe("importFromXApi — upsert scoping & classification", () => {
  it("returns zeros without touching DB when no new tweets come back", async () => {
    xApiMock.fetchUserTweets.mockResolvedValue([]);

    const result = await importFromXApi();

    expect(result).toEqual({ imported: 0, updated: 0, total: 0 });
    expect(prismaMock.socialPost.findMany).not.toHaveBeenCalled();
    expect(prismaMock.socialPost.upsert).not.toHaveBeenCalled();
  });

  it("scopes the existing-rows lookup by (userId, platform:X)", async () => {
    xApiMock.fetchUserTweets.mockResolvedValue([tweet()]);

    await importFromXApi();

    expect(prismaMock.socialPost.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: USER_ID,
          platform: "X",
        }),
      })
    );
  });

  it("upsert composite key embeds userId so a forged externalPostId can't cross tenants", async () => {
    xApiMock.fetchUserTweets.mockResolvedValue([tweet({ postId: "t-1" })]);

    await importFromXApi();

    expect(prismaMock.socialPost.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_platform_externalPostId: {
            userId: USER_ID,
            platform: "X",
            externalPostId: "t-1",
          },
        },
        create: expect.objectContaining({
          userId: USER_ID,
          platform: "X",
          externalPostId: "t-1",
        }),
      })
    );
  });

  it("classifies each tweet as imported (new) or updated (pre-existing)", async () => {
    xApiMock.fetchUserTweets.mockResolvedValue([
      tweet({ postId: "t-existing" }),
      tweet({ postId: "t-new" }),
    ]);
    prismaMock.socialPost.findMany.mockResolvedValue([{ externalPostId: "t-existing" }]);

    const result = await importFromXApi();

    expect(result).toEqual({ imported: 1, updated: 1, total: 2 });
  });

  it("revalidates /analytics after a successful run", async () => {
    xApiMock.fetchUserTweets.mockResolvedValue([tweet()]);

    await importFromXApi();

    expect(revalidatePath).toHaveBeenCalledWith("/analytics");
  });

  it("auto-detects REPLY postType when tweet text starts with @", async () => {
    xApiMock.fetchUserTweets.mockResolvedValue([tweet({ postId: "t-reply", text: "@user hi" })]);

    await importFromXApi();

    expect(prismaMock.socialPost.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          postType: "REPLY",
          platformMetadata: { platform: "X", postType: "REPLY" },
        }),
      })
    );
  });
});
