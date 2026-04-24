import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Regression coverage for the N+1 → $transaction batching refactor.
// Asserts:
//   1. `$transaction` is called once per batch (posts + snapshots),
//      not per-post as before.
//   2. Each transaction receives an array of Prisma ops.
//   3. Per-tweet classification (imported vs updated) still matches the
//      pre-refactor counts when some posts are already in the DB.
//   4. Zero tweets skips DB work entirely.

const CRON_SECRET = "test-secret";
process.env.CRON_SECRET = CRON_SECRET;

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// Passthrough wrapper so we test the handler directly.
vi.mock("@/lib/cron-helpers", () => ({
  withCronLogging:
    (_name: string, handler: (req: NextRequest) => Promise<unknown>) => (req: NextRequest) =>
      handler(req),
}));

vi.mock("@/lib/server/x-token", () => ({
  getXApiTokenForUser: vi.fn().mockResolvedValue({ accessToken: "x-token" }),
}));

const fetchUserTweetsPaginatedMock = vi.fn();
vi.mock("@/lib/x-api", () => ({
  fetchUserTweetsPaginated: fetchUserTweetsPaginatedMock,
}));

const prismaMock = {
  user: { findMany: vi.fn() },
  socialPost: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    upsert: vi.fn(),
  },
  socialPostEngagementSnapshot: { upsert: vi.fn() },
  $transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops)),
};
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

function makeTweet(postId: string, createdAt = new Date()) {
  return {
    postId,
    createdAt,
    text: "hello world",
    postLink: `https://x.com/u/status/${postId}`,
    impressions: 100,
    likes: 10,
    engagements: 12,
    bookmarks: 1,
    replies: 0,
    reposts: 2,
    quoteCount: 0,
    urlClicks: 0,
    profileVisits: 0,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.user.findMany.mockResolvedValue([{ id: "user-1" }]);
  prismaMock.socialPost.findFirst.mockResolvedValue(null);
  prismaMock.socialPost.findMany.mockResolvedValue([]);
  prismaMock.socialPost.upsert.mockImplementation(
    async ({ create }: { create: { externalPostId: string } }) => ({
      id: `sp-${create.externalPostId}`,
      externalPostId: create.externalPostId,
    })
  );
  prismaMock.socialPostEngagementSnapshot.upsert.mockResolvedValue({});
  prismaMock.$transaction.mockImplementation(async (ops: unknown[]) => Promise.all(ops));
});

function buildRequest(mode?: "refresh") {
  const url = new URL("https://example.com/api/cron/x-import");
  if (mode) url.searchParams.set("mode", mode);
  return new NextRequest(url, {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
}

describe("x-import cron", () => {
  it("skips DB work when the API returns zero tweets", async () => {
    fetchUserTweetsPaginatedMock.mockResolvedValueOnce([]);

    const { GET } = await import("../route");
    await GET(buildRequest());

    expect(prismaMock.socialPost.findMany).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.socialPost.upsert).not.toHaveBeenCalled();
  });

  it("routes tweet upserts + snapshot upserts through $transaction batches", async () => {
    fetchUserTweetsPaginatedMock.mockResolvedValueOnce([
      makeTweet("t-1"),
      makeTweet("t-2"),
      makeTweet("t-3"),
    ]);

    const { GET } = await import("../route");
    await GET(buildRequest());

    // One findMany replaces the pre-refactor N × findUnique calls.
    expect(prismaMock.socialPost.findMany).toHaveBeenCalledTimes(1);

    // Two $transactions: one for the 3 SocialPost upserts, one for the
    // 3 snapshot upserts (all tweets are younger than REFRESH_DAYS).
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(2);
    for (const call of prismaMock.$transaction.mock.calls) {
      const ops = call[0] as unknown[];
      expect(Array.isArray(ops)).toBe(true);
      expect(ops.length).toBe(3);
    }

    // The per-model upsert fn is still called 3×+3× — counts match the
    // pre-refactor behavior; only the network shape has changed.
    expect(prismaMock.socialPost.upsert).toHaveBeenCalledTimes(3);
    expect(prismaMock.socialPostEngagementSnapshot.upsert).toHaveBeenCalledTimes(3);
  });

  it("classifies tweets as updated when findMany reports them pre-existing", async () => {
    fetchUserTweetsPaginatedMock.mockResolvedValueOnce([
      makeTweet("existing-1"),
      makeTweet("new-1"),
    ]);
    // Only the first externalPostId shows up as already in the DB.
    prismaMock.socialPost.findMany.mockResolvedValueOnce([{ externalPostId: "existing-1" }]);

    const { GET } = await import("../route");
    const result = (await GET(buildRequest())) as unknown as {
      data: { results: Array<{ imported?: number; updated?: number }> };
    };

    expect(result.data.results[0]!.imported).toBe(1);
    expect(result.data.results[0]!.updated).toBe(1);
  });

  it("skips snapshots for tweets older than REFRESH_DAYS", async () => {
    const oldCreatedAt = new Date();
    oldCreatedAt.setUTCDate(oldCreatedAt.getUTCDate() - 30);
    fetchUserTweetsPaginatedMock.mockResolvedValueOnce([makeTweet("t-old", oldCreatedAt)]);

    const { GET } = await import("../route");
    await GET(buildRequest());

    // One $transaction for the upsert; snapshot batch is skipped because
    // nothing qualified → no second $transaction.
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(prismaMock.socialPostEngagementSnapshot.upsert).not.toHaveBeenCalled();
  });
});
