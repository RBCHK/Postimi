import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ADR-008 Phase 2 cron tests.
//
// Covers the four invariants social-import must uphold:
//   1. Iterate every registered importer for every user.
//   2. A failure in one platform must not abort the next platform's run,
//      and must end up in Sentry with `{ platform, userId }` tags.
//   3. A ThreadsScopeError must strip grantedScopes so the UI can reconnect.
//   4. Users without credentials for a platform are silently skipped.

const CRON_SECRET = "test-secret";
process.env.CRON_SECRET = CRON_SECRET;

const sentryMock = { captureException: vi.fn(), captureMessage: vi.fn() };
vi.mock("@sentry/nextjs", () => sentryMock);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// Passthrough the cron wrapper — we test the handler directly.
vi.mock("@/lib/cron-helpers", () => ({
  withCronLogging:
    (_name: string, handler: (req: NextRequest) => Promise<unknown>) => (req: NextRequest) =>
      handler(req),
}));

// The init side-effect normally registers real clients. Stub it out so
// we can drive the registry directly from the test.
vi.mock("@/lib/platform/init", () => ({}));

// `$transaction([...])` returns results in the same order as input. The
// route passes upsert calls (which are lazy Prisma query objects) into it
// via `chunk.map(...)` — in the mocked world each such call returns
// whatever `socialPost.upsert.mockResolvedValue(...)` is set to return, so
// we simply resolve the input array as-is.
const prismaMock = {
  user: { findMany: vi.fn() },
  socialPost: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    upsert: vi.fn(),
  },
  socialPostEngagementSnapshot: { upsert: vi.fn() },
  socialFollowersSnapshot: {
    findFirst: vi.fn(),
    upsert: vi.fn(),
  },
  threadsApiToken: { update: vi.fn() },
  $transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops)),
};
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

// Control the registry. Each test pushes its own importer(s) into this
// list before importing the route module.
type MockPlatform = "X" | "LINKEDIN" | "THREADS";
interface MockEntry {
  token: {
    platform: MockPlatform;
    getForUser: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  };
  importer?: {
    platform: MockPlatform;
    fetchPosts: ReturnType<typeof vi.fn>;
    fetchFollowers: ReturnType<typeof vi.fn>;
  };
}

const registryEntries: MockEntry[] = [];

vi.mock("@/lib/platform/registry", () => ({
  listImportablePlatforms: () => registryEntries.filter((e) => e.importer),
}));

beforeEach(() => {
  vi.clearAllMocks();
  sentryMock.captureException.mockClear();
  registryEntries.length = 0;
  prismaMock.user.findMany.mockResolvedValue([{ id: "user-1" }]);
  prismaMock.socialPost.findFirst.mockResolvedValue(null);
  prismaMock.socialPost.findUnique.mockResolvedValue(null);
  prismaMock.socialPost.findMany.mockResolvedValue([]);
  prismaMock.socialPost.upsert.mockResolvedValue({ id: "sp-1", externalPostId: "tp-1" });
  prismaMock.socialPostEngagementSnapshot.upsert.mockResolvedValue({});
  prismaMock.socialFollowersSnapshot.findFirst.mockResolvedValue(null);
  prismaMock.socialFollowersSnapshot.upsert.mockResolvedValue({});
  prismaMock.threadsApiToken.update.mockResolvedValue({});
  prismaMock.$transaction.mockImplementation(async (ops: unknown[]) => Promise.all(ops));
});

function buildRequest() {
  return new NextRequest("https://example.com/api/cron/social-import", {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
}

function threadsPost(overrides: Record<string, unknown> = {}) {
  return {
    platform: "THREADS" as const,
    externalPostId: "tp-1",
    text: "hello threads",
    postedAt: new Date(),
    postUrl: "https://threads.net/@u/post/tp-1",
    metadata: {
      platform: "THREADS" as const,
      mediaType: "TEXT_POST" as const,
      replyToId: null,
      permalink: "https://threads.net/@u/post/tp-1",
    },
    metrics: {
      impressions: 100,
      likes: 10,
      replies: 1,
      reposts: 0,
      shares: 2,
      bookmarks: 3,
    },
    ...overrides,
  };
}

function threadsFollowers(overrides: Record<string, unknown> = {}) {
  return {
    platform: "THREADS" as const,
    date: new Date("2026-04-15T00:00:00Z"),
    followersCount: 500,
    followingCount: null,
    ...overrides,
  };
}

function registerThreads(
  fetchPostsImpl?: () => AsyncIterable<unknown>,
  fetchFollowersImpl?: () => Promise<unknown>
) {
  const fetchPosts = vi.fn(
    fetchPostsImpl ??
      async function* () {
        yield threadsPost();
      }
  );
  const fetchFollowers = vi.fn(fetchFollowersImpl ?? (async () => threadsFollowers()));
  registryEntries.push({
    token: {
      platform: "THREADS",
      getForUser: vi.fn().mockResolvedValue({
        platform: "THREADS",
        accessToken: "t",
        threadsUserId: "tid",
        threadsUsername: "u",
      }),
      disconnect: vi.fn(),
    },
    importer: {
      platform: "THREADS",
      fetchPosts,
      fetchFollowers,
    },
  });
  return { fetchPosts, fetchFollowers };
}

function xPost(overrides: Record<string, unknown> = {}) {
  return {
    platform: "X" as const,
    externalPostId: "xp-1",
    text: "hello x",
    postedAt: new Date(),
    postUrl: "https://x.com/u/status/xp-1",
    metadata: {
      platform: "X" as const,
      postType: "POST" as const,
    },
    metrics: {
      impressions: 200,
      likes: 20,
      replies: 1,
      reposts: 5,
      shares: 0,
      bookmarks: 3,
      engagements: 22,
      quoteCount: 1,
      urlClicks: 4,
      profileVisits: 7,
    },
    ...overrides,
  };
}

function xFollowers(overrides: Record<string, unknown> = {}) {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return {
    platform: "X" as const,
    date: today,
    followersCount: 999,
    followingCount: 100,
    ...overrides,
  };
}

function registerX(
  fetchPostsImpl?: () => AsyncIterable<unknown>,
  fetchFollowersImpl?: () => Promise<unknown>
) {
  const fetchPosts = vi.fn(
    fetchPostsImpl ??
      async function* () {
        yield xPost();
      }
  );
  const fetchFollowers = vi.fn(fetchFollowersImpl ?? (async () => xFollowers()));
  registryEntries.push({
    token: {
      platform: "X",
      getForUser: vi.fn().mockResolvedValue({
        platform: "X",
        accessToken: "x-tok",
        xUserId: "xid",
        xUsername: "u",
      }),
      disconnect: vi.fn(),
    },
    importer: {
      platform: "X",
      fetchPosts,
      fetchFollowers,
    },
  });
  return { fetchPosts, fetchFollowers };
}

describe("social-import cron", () => {
  it("upserts SocialPost, snapshot, and followers for each Threads post", async () => {
    registerThreads();
    const { GET } = await import("../route");
    await GET(buildRequest());

    expect(prismaMock.socialPost.upsert).toHaveBeenCalledTimes(1);
    const args = prismaMock.socialPost.upsert.mock.calls[0]![0];
    expect(args.where.userId_platform_externalPostId).toEqual({
      userId: "user-1",
      platform: "THREADS",
      externalPostId: "tp-1",
    });
    expect(args.create.platform).toBe("THREADS");
    expect(args.create.platformMetadata.platform).toBe("THREADS");

    expect(prismaMock.socialPostEngagementSnapshot.upsert).toHaveBeenCalledTimes(1);
    expect(prismaMock.socialFollowersSnapshot.upsert).toHaveBeenCalledTimes(1);
  });

  it("skips users who aren't connected to the platform", async () => {
    registryEntries.push({
      token: {
        platform: "THREADS",
        getForUser: vi.fn().mockResolvedValue(null),
        disconnect: vi.fn(),
      },
      importer: {
        platform: "THREADS",
        fetchPosts: vi.fn(),
        fetchFollowers: vi.fn(),
      },
    });
    const { GET } = await import("../route");
    await GET(buildRequest());

    expect(registryEntries[0]!.importer!.fetchPosts).not.toHaveBeenCalled();
    expect(prismaMock.socialPost.upsert).not.toHaveBeenCalled();
  });

  it("on ThreadsScopeError: strips grantedScopes and captures Sentry at warning level", async () => {
    const { ThreadsScopeError } = await import("@/lib/threads-api");
    registerThreads(async function* () {
      throw new ThreadsScopeError("threads_manage_insights", 403, "scope denied");
      // Generator never reaches here, but satisfies the async iterable contract.
      yield threadsPost();
    });

    const { GET } = await import("../route");
    await GET(buildRequest());

    expect(prismaMock.threadsApiToken.update).toHaveBeenCalledTimes(1);
    const updateArgs = prismaMock.threadsApiToken.update.mock.calls[0]![0];
    expect(updateArgs.where.userId).toBe("user-1");
    expect(updateArgs.data.grantedScopes.set).toEqual([]);

    expect(sentryMock.captureException).toHaveBeenCalledTimes(1);
    const sentryArgs = sentryMock.captureException.mock.calls[0]![1];
    expect(sentryArgs.level).toBe("warning");
    expect(sentryArgs.tags).toMatchObject({
      platform: "THREADS",
      kind: "scope-denied",
    });
  });

  it("captures Sentry on generic import failure without aborting other users", async () => {
    prismaMock.user.findMany.mockResolvedValue([{ id: "user-1" }, { id: "user-2" }]);
    const throwingImporter = vi.fn(async function* () {
      throw new Error("threads 500");
      yield threadsPost();
    });
    const goodImporter = vi.fn(async function* () {
      yield threadsPost({ externalPostId: "ok-1" });
    });
    const getCreds = vi.fn();
    getCreds.mockResolvedValueOnce({
      platform: "THREADS",
      accessToken: "t",
      threadsUserId: "tid",
      threadsUsername: "u",
    });
    getCreds.mockResolvedValueOnce({
      platform: "THREADS",
      accessToken: "t",
      threadsUserId: "tid",
      threadsUsername: "u",
    });

    let callCount = 0;
    registryEntries.push({
      token: {
        platform: "THREADS",
        getForUser: getCreds,
        disconnect: vi.fn(),
      },
      importer: {
        platform: "THREADS",
        fetchPosts: vi.fn(() => {
          callCount++;
          return callCount === 1 ? throwingImporter() : goodImporter();
        }),
        fetchFollowers: vi.fn(async () => threadsFollowers()),
      },
    });

    const { GET } = await import("../route");
    await GET(buildRequest());

    expect(sentryMock.captureException).toHaveBeenCalledTimes(1);
    expect(sentryMock.captureException.mock.calls[0]![1].tags).toMatchObject({
      job: "social-import",
      platform: "THREADS",
      userId: "user-1",
    });
    // user-2's run completes.
    expect(prismaMock.socialPost.upsert).toHaveBeenCalledTimes(1);
  });

  it("computes followers delta from previous snapshot", async () => {
    prismaMock.socialFollowersSnapshot.findFirst.mockResolvedValueOnce({
      followersCount: 480,
      followingCount: null,
    });
    registerThreads();
    const { GET } = await import("../route");
    await GET(buildRequest());

    const args = prismaMock.socialFollowersSnapshot.upsert.mock.calls[0]![0];
    expect(args.create.deltaFollowers).toBe(20); // 500 - 480
    expect(args.create.followingCount).toBeNull();
  });

  // ─── X platform path (post-2026-04 refactor) ────────────

  describe("X platform via registry", () => {
    it("upserts X SocialPost with X postType and X-specific metric columns", async () => {
      registerX();
      const { GET } = await import("../route");
      await GET(buildRequest());

      expect(prismaMock.socialPost.upsert).toHaveBeenCalledTimes(1);
      const args = prismaMock.socialPost.upsert.mock.calls[0]![0];
      expect(args.where.userId_platform_externalPostId).toEqual({
        userId: "user-1",
        platform: "X",
        externalPostId: "xp-1",
      });
      expect(args.create.platform).toBe("X");
      expect(args.create.platformMetadata).toEqual({ platform: "X", postType: "POST" });
      // postType derived from metadata.postType (not Threads' replyToId logic)
      expect(args.create.postType).toBe("POST");
      // X-specific metrics flow through buildMetrics + spread
      expect(args.create.engagements).toBe(22);
      expect(args.create.quoteCount).toBe(1);
      expect(args.create.urlClicks).toBe(4);
      expect(args.create.profileVisits).toBe(7);
      // Cross-platform fields preserved
      expect(args.create.impressions).toBe(200);
      expect(args.create.likes).toBe(20);
      // X must NOT set views (legacy x-import behavior — Threads-only field)
      expect(args.create).not.toHaveProperty("views");
    });

    it("derives postType=REPLY from X metadata when set", async () => {
      registerX(async function* () {
        yield xPost({
          externalPostId: "xp-reply",
          metadata: { platform: "X" as const, postType: "REPLY" as const },
        });
      });
      const { GET } = await import("../route");
      await GET(buildRequest());

      const args = prismaMock.socialPost.upsert.mock.calls[0]![0];
      expect(args.create.postType).toBe("REPLY");
    });

    it("classifies X posts as imported vs updated based on findMany lookup", async () => {
      registerX(async function* () {
        yield xPost({ externalPostId: "existing-1" });
        yield xPost({ externalPostId: "new-1" });
      });
      // First post is already in the DB; second is new.
      prismaMock.socialPost.findMany.mockResolvedValueOnce([{ externalPostId: "existing-1" }]);
      prismaMock.socialPost.upsert
        .mockResolvedValueOnce({ id: "sp-existing", externalPostId: "existing-1" })
        .mockResolvedValueOnce({ id: "sp-new", externalPostId: "new-1" });

      const { GET } = await import("../route");
      const res = (await GET(buildRequest())) as unknown as {
        data: {
          results: Array<{
            userId: string;
            platform: string;
            imported?: number;
            updated?: number;
          }>;
        };
      };

      const xResult = res.data.results.find((r) => r.platform === "X")!;
      expect(xResult.imported).toBe(1);
      expect(xResult.updated).toBe(1);
    });

    it("records followers snapshot for X with computed delta", async () => {
      prismaMock.socialFollowersSnapshot.findFirst.mockResolvedValueOnce({
        followersCount: 950,
        followingCount: 100,
      });
      registerX();
      const { GET } = await import("../route");
      await GET(buildRequest());

      const args = prismaMock.socialFollowersSnapshot.upsert.mock.calls[0]![0];
      expect(args.where.userId_platform_date.platform).toBe("X");
      expect(args.create.followersCount).toBe(999);
      expect(args.create.followingCount).toBe(100);
      expect(args.create.deltaFollowers).toBe(49); // 999 - 950
    });
  });

  // ─── Wall-clock budget guard (migrated from legacy x-import) ──

  describe("wall-clock budget guard", () => {
    it("bails on remaining users once elapsed exceeds 85% of maxDuration", async () => {
      // Three users; first one consumes the whole budget, the rest must
      // be marked budgetExhausted across all platforms without the
      // importer being called.
      prismaMock.user.findMany.mockResolvedValue([
        { id: "user-slow" },
        { id: "user-2" },
        { id: "user-3" },
      ]);
      const { fetchPosts: fetchXPosts } = registerX();

      // Date.now sequence — minimum advance pattern:
      // [0] handler start
      // [1] iter 0 wall-clock check — under budget
      // [2] iter 1 wall-clock check — over budget (55s > 0.85 * 60s = 51s)
      const base = 1_000_000;
      const sequence = [base, base + 1_000, base + 55_000];
      let callIdx = 0;
      const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => {
        const v = sequence[Math.min(callIdx, sequence.length - 1)]!;
        callIdx++;
        return v;
      });

      try {
        const { GET } = await import("../route");
        const res = (await GET(buildRequest())) as unknown as {
          status: string;
          data: {
            results: Array<{
              userId: string;
              platform: string;
              budgetExhausted?: boolean;
            }>;
          };
        };

        // Only user-slow ran; the other two get budgetExhausted markers
        // for every registered platform.
        expect(fetchXPosts).toHaveBeenCalledTimes(1);
        const exhausted = res.data.results.filter((r) => r.budgetExhausted);
        expect(exhausted.map((r) => r.userId).sort()).toEqual(["user-2", "user-3"]);
        // Status degrades to PARTIAL — next run picks the skipped users.
        expect(res.status).toBe("PARTIAL");

        expect(sentryMock.captureException).not.toHaveBeenCalled();
      } finally {
        nowSpy.mockRestore();
      }
    });
  });

  it("batches SocialPost + snapshot writes through $transaction (not per-post round-trips)", async () => {
    // Yield 3 posts so we can assert the batch carries all of them in one
    // $transaction invocation instead of the pre-refactor N round-trips.
    registerThreads(async function* () {
      yield threadsPost({ externalPostId: "tp-1" });
      yield threadsPost({ externalPostId: "tp-2" });
      yield threadsPost({ externalPostId: "tp-3" });
    });

    // Return distinct ids so the snapshot upsert can't accidentally see
    // the same `postId` three times.
    prismaMock.socialPost.upsert
      .mockResolvedValueOnce({ id: "sp-1", externalPostId: "tp-1" })
      .mockResolvedValueOnce({ id: "sp-2", externalPostId: "tp-2" })
      .mockResolvedValueOnce({ id: "sp-3", externalPostId: "tp-3" });

    const { GET } = await import("../route");
    await GET(buildRequest());

    // Two $transaction calls: one for the 3 SocialPost upserts, one for
    // the 3 engagement-snapshot upserts (all posts are young enough).
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(2);

    // Both transactions receive an array of upsert operations (not nested
    // promises, not objects) — this is the contract N+1 relies on.
    for (const call of prismaMock.$transaction.mock.calls) {
      const ops = call[0] as unknown[];
      expect(Array.isArray(ops)).toBe(true);
      expect(ops.length).toBe(3);
    }

    // The per-model upsert was called 3×+3× even though only two network
    // hops happened (one per $transaction batch).
    expect(prismaMock.socialPost.upsert).toHaveBeenCalledTimes(3);
    expect(prismaMock.socialPostEngagementSnapshot.upsert).toHaveBeenCalledTimes(3);
  });
});
