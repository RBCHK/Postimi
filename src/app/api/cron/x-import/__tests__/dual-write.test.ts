import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ADR-008 Phase 1a cron contract: the x-import cron dual-writes each
// imported tweet to SocialPost (platform=X) and, for posts under the
// refresh window, to SocialPostEngagementSnapshot. These tests verify
// the dual-write path runs alongside the legacy writes, including
// Sentry-capture-on-failure without aborting the legacy path.

const TEST_USER_ID = "user-cron-phase1a";
const CRON_SECRET = "test-secret";
process.env.CRON_SECRET = CRON_SECRET;

const sentryMock = { captureException: vi.fn() };
vi.mock("@sentry/nextjs", () => sentryMock);

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// Bypass withCronLogging — run the handler directly.
vi.mock("@/lib/cron-helpers", () => ({
  withCronLogging:
    (_name: string, handler: (req: NextRequest) => Promise<unknown>) => (req: NextRequest) =>
      handler(req),
}));

vi.mock("@/app/actions/x-token", () => ({
  getXApiTokenForUserInternal: vi.fn().mockResolvedValue({
    platform: "X",
    accessToken: "tok",
    xUserId: "x-123",
    xUsername: "user",
  }),
}));

const fetchMock = vi.fn();
vi.mock("@/lib/x-api", () => ({
  fetchUserTweetsPaginated: fetchMock,
}));

const prismaMock = {
  user: { findMany: vi.fn().mockResolvedValue([{ id: TEST_USER_ID }]) },
  xPost: {
    findFirst: vi.fn().mockResolvedValue(null),
    findUnique: vi.fn().mockResolvedValue(null),
    upsert: vi.fn().mockResolvedValue({}),
  },
  postEngagementSnapshot: {
    upsert: vi.fn().mockResolvedValue({}),
  },
  socialPost: {
    upsert: vi.fn(),
  },
  socialPostEngagementSnapshot: {
    upsert: vi.fn().mockResolvedValue({}),
  },
};

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

beforeEach(() => {
  vi.clearAllMocks();
  sentryMock.captureException.mockClear();
  prismaMock.user.findMany.mockResolvedValue([{ id: TEST_USER_ID }]);
  prismaMock.xPost.findFirst.mockResolvedValue(null);
  prismaMock.xPost.findUnique.mockResolvedValue(null);
});

function buildRequest() {
  return new NextRequest("https://example.com/api/cron/x-import", {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
}

function buildTweet(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    postId: "tw-1",
    text: "hello world",
    postLink: "https://x.com/user/status/tw-1",
    createdAt: new Date(),
    impressions: 100,
    likes: 5,
    engagements: 10,
    bookmarks: 1,
    replies: 0,
    reposts: 2,
    quoteCount: 0,
    urlClicks: 3,
    profileVisits: 1,
    ...overrides,
  };
}

describe("x-import cron — dual-write to SocialPost + SocialPostEngagementSnapshot", () => {
  it("upserts SocialPost with platform=X and correct metadata", async () => {
    fetchMock.mockResolvedValueOnce([buildTweet()]);
    prismaMock.socialPost.upsert.mockResolvedValue({ id: "sp-1" });

    const { GET } = await import("../route");
    await GET(buildRequest());

    expect(prismaMock.xPost.upsert).toHaveBeenCalledTimes(1);
    expect(prismaMock.socialPost.upsert).toHaveBeenCalledTimes(1);

    const args = prismaMock.socialPost.upsert.mock.calls[0]![0];
    expect(args.where.userId_platform_externalPostId).toEqual({
      userId: TEST_USER_ID,
      platform: "X",
      externalPostId: "tw-1",
    });
    expect(args.create.platform).toBe("X");
    expect(args.create.externalPostId).toBe("tw-1");
    expect(args.create.postType).toBe("POST");
    expect(args.create.platformMetadata).toEqual({ platform: "X", postType: "POST" });
    expect(args.create.impressions).toBe(100);
    expect(args.select).toEqual({ id: true });
  });

  it("detects REPLY postType for tweets starting with @", async () => {
    fetchMock.mockResolvedValueOnce([buildTweet({ text: "@someone hi" })]);
    prismaMock.socialPost.upsert.mockResolvedValue({ id: "sp-2" });

    const { GET } = await import("../route");
    await GET(buildRequest());

    const args = prismaMock.socialPost.upsert.mock.calls[0]![0];
    expect(args.create.postType).toBe("REPLY");
    expect(args.create.platformMetadata).toEqual({ platform: "X", postType: "REPLY" });
  });

  it("creates SocialPostEngagementSnapshot using the SocialPost.id returned from upsert", async () => {
    fetchMock.mockResolvedValueOnce([buildTweet()]);
    prismaMock.socialPost.upsert.mockResolvedValue({ id: "sp-42" });

    const { GET } = await import("../route");
    await GET(buildRequest());

    expect(prismaMock.postEngagementSnapshot.upsert).toHaveBeenCalledTimes(1);
    expect(prismaMock.socialPostEngagementSnapshot.upsert).toHaveBeenCalledTimes(1);

    const args = prismaMock.socialPostEngagementSnapshot.upsert.mock.calls[0]![0];
    expect(args.where.userId_platform_postId_snapshotDate.platform).toBe("X");
    expect(args.where.userId_platform_postId_snapshotDate.postId).toBe("sp-42");
    expect(args.create.platform).toBe("X");
    expect(args.create.postId).toBe("sp-42");
  });

  it("SocialPost upsert failure is captured in Sentry and skips the snapshot dual-write", async () => {
    fetchMock.mockResolvedValueOnce([buildTweet()]);
    prismaMock.socialPost.upsert.mockRejectedValueOnce(new Error("schema drift"));

    const { GET } = await import("../route");
    await GET(buildRequest());

    // Legacy path survives:
    expect(prismaMock.xPost.upsert).toHaveBeenCalledTimes(1);
    expect(prismaMock.postEngagementSnapshot.upsert).toHaveBeenCalledTimes(1);

    // SocialPost failure captured, snapshot dual-write skipped (no FK):
    expect(prismaMock.socialPostEngagementSnapshot.upsert).not.toHaveBeenCalled();
    expect(sentryMock.captureException).toHaveBeenCalledTimes(1);
    const tags = sentryMock.captureException.mock.calls[0]![1]?.tags;
    expect(tags).toMatchObject({
      phase: "1a-dual-write",
      model: "SocialPost",
      platform: "X",
    });
  });

  it("Snapshot dual-write failure does not abort legacy snapshot write", async () => {
    fetchMock.mockResolvedValueOnce([buildTweet()]);
    prismaMock.socialPost.upsert.mockResolvedValue({ id: "sp-ok" });
    prismaMock.socialPostEngagementSnapshot.upsert.mockRejectedValueOnce(new Error("FK violation"));

    const { GET } = await import("../route");
    await GET(buildRequest());

    expect(prismaMock.postEngagementSnapshot.upsert).toHaveBeenCalledTimes(1);
    expect(sentryMock.captureException).toHaveBeenCalledTimes(1);
    expect(sentryMock.captureException.mock.calls[0]![1]?.tags).toMatchObject({
      phase: "1a-dual-write",
      model: "SocialPostEngagementSnapshot",
      platform: "X",
    });
  });

  it("skips users without X credentials — no dual-write attempted", async () => {
    const { getXApiTokenForUserInternal } = await import("@/app/actions/x-token");
    (getXApiTokenForUserInternal as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

    const { GET } = await import("../route");
    await GET(buildRequest());

    expect(prismaMock.xPost.upsert).not.toHaveBeenCalled();
    expect(prismaMock.socialPost.upsert).not.toHaveBeenCalled();
    expect(prismaMock.socialPostEngagementSnapshot.upsert).not.toHaveBeenCalled();
  });
});
