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

const sentryMock = { captureException: vi.fn() };
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

const prismaMock = {
  user: { findMany: vi.fn() },
  socialPost: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    upsert: vi.fn(),
  },
  socialPostEngagementSnapshot: { upsert: vi.fn() },
  socialFollowersSnapshot: {
    findFirst: vi.fn(),
    upsert: vi.fn(),
  },
  threadsApiToken: { update: vi.fn() },
};
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

// Control the registry. Each test pushes its own importer(s) into this
// list before importing the route module.
type MockPlatform = "X" | "LINKEDIN" | "THREADS";
interface MockEntry {
  token: {
    platform: MockPlatform;
    getForUserInternal: ReturnType<typeof vi.fn>;
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
  prismaMock.socialPost.upsert.mockResolvedValue({ id: "sp-1" });
  prismaMock.socialPostEngagementSnapshot.upsert.mockResolvedValue({});
  prismaMock.socialFollowersSnapshot.findFirst.mockResolvedValue(null);
  prismaMock.socialFollowersSnapshot.upsert.mockResolvedValue({});
  prismaMock.threadsApiToken.update.mockResolvedValue({});
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
      getForUserInternal: vi.fn().mockResolvedValue({
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
        getForUserInternal: vi.fn().mockResolvedValue(null),
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
        getForUserInternal: getCreds,
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
});
