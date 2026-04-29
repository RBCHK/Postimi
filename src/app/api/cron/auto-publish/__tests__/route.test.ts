/**
 * Contract test for the post-2026-04 auto-publish cron.
 *
 * Covers the invariants the new cron must uphold:
 *   1. Bearer auth — 401 on missing/wrong token (covered by e2e auth-
 *      boundaries spec; not duplicated here).
 *   2. Empty claim → SUCCESS, no publisher calls.
 *   3. Happy path → publisher invoked, row marked PUBLISHED.
 *   4. PlatformDisconnectedError → FAILED terminal (attemptCount cap),
 *      no retry. Sentry warning fired.
 *   5. Static-rules validation rejects the row before publisher runs.
 *   6. Transient error increments attemptCount and resets to PENDING.
 *   7. attemptCount cap reached → FAILED, not retried.
 *   8. Backfill is invoked at the top of every tick (idempotent on
 *      runs without orphans).
 *   9. Per-platform isolation — one row's failure does not affect others.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import type { Platform } from "@/lib/types";

const CRON_SECRET = "test-secret";
process.env.CRON_SECRET = CRON_SECRET;

vi.mock("next/server", async () => {
  const actual = (await vi.importActual("next/server")) as Record<string, unknown>;
  return {
    ...actual,
    after: (cb: () => Promise<void> | void) => {
      void Promise.resolve()
        .then(cb)
        .catch(() => {});
    },
  };
});
vi.mock("@/lib/cron-helpers", () => ({
  withCronLogging:
    (_name: string, handler: (req: NextRequest) => Promise<unknown>) => (req: NextRequest) =>
      handler(req),
}));
const sentryMock = vi.hoisted(() => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));
vi.mock("@sentry/nextjs", () => sentryMock);

const backfillMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/auto-publish-backfill", () => ({
  backfillOrphanScheduledSlots: backfillMock,
}));

const xTokenMock = vi.hoisted(() => vi.fn());
const liTokenMock = vi.hoisted(() => vi.fn());
const thTokenMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/x-token", () => ({ getXApiTokenForUser: xTokenMock }));
vi.mock("@/lib/server/linkedin-token", () => ({ getLinkedInApiTokenForUser: liTokenMock }));
vi.mock("@/lib/server/threads-token", () => ({ getThreadsApiTokenForUser: thTokenMock }));

const getMediaMock = vi.hoisted(() => vi.fn().mockResolvedValue([]));
vi.mock("@/lib/server/media", () => ({ getMediaForConversation: getMediaMock }));

const uploadMediaToXMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/x-api", () => ({ uploadMediaToX: uploadMediaToXMock }));

vi.mock("@/lib/fetch-with-timeout", () => ({
  fetchWithTimeout: vi.fn(),
}));

const publishMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/platform/publishers", async () => {
  return {
    getPublisher: () => ({ publish: publishMock }),
  };
});

const prismaMock = {
  scheduledPublish: {
    updateMany: vi.fn(),
    update: vi.fn(),
  },
  post: {
    findUnique: vi.fn(),
  },
  $queryRaw: vi.fn(),
};
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

interface ClaimedRow {
  id: string;
  userId: string;
  postId: string;
  platform: Platform;
  attemptCount: number;
}

function makeClaim(overrides?: Partial<ClaimedRow>): ClaimedRow {
  return {
    id: "sp-1",
    userId: "user-1",
    postId: "post-1",
    platform: "X",
    attemptCount: 0,
    ...overrides,
  };
}

function makePost(overrides?: { content?: string; userId?: string }) {
  return {
    id: "post-1",
    userId: overrides?.userId ?? "user-1",
    content: overrides?.content ?? "hello world",
    conversationId: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  backfillMock.mockResolvedValue(0);
  prismaMock.scheduledPublish.updateMany.mockResolvedValue({ count: 0 });
  prismaMock.scheduledPublish.update.mockResolvedValue({});
  prismaMock.$queryRaw.mockResolvedValue([]);
  prismaMock.post.findUnique.mockResolvedValue(null);
  xTokenMock.mockResolvedValue({ accessToken: "x", xUserId: "u", xUsername: "u" });
  liTokenMock.mockResolvedValue({
    accessToken: "li",
    linkedinUserId: "u",
    linkedinName: "u",
  });
  thTokenMock.mockResolvedValue({
    accessToken: "th",
    threadsUserId: "u",
    threadsUsername: "u",
  });
  publishMock.mockResolvedValue({
    externalPostId: "ext-1",
    externalUrl: "https://example.com/p/ext-1",
  });
});

function authedReq() {
  return new NextRequest("http://localhost/api/cron/auto-publish", {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
}

describe("auto-publish cron — structure", () => {
  it("invokes backfill and stale-sweep on every tick (even with empty claim)", async () => {
    const { GET } = await import("../route");
    const res = (await GET(authedReq())) as unknown as {
      status: string;
      data: { published: number; due: number };
    };
    expect(res.status).toBe("SUCCESS");
    expect(res.data.published).toBe(0);
    expect(res.data.due).toBe(0);
    expect(backfillMock).toHaveBeenCalledTimes(1);
    expect(prismaMock.scheduledPublish.updateMany).toHaveBeenCalledTimes(1);
    expect(publishMock).not.toHaveBeenCalled();
  });
});

describe("auto-publish cron — happy path", () => {
  it("publishes a claimed row and marks it PUBLISHED with externalPostId", async () => {
    const claim = makeClaim();
    prismaMock.$queryRaw.mockResolvedValueOnce([claim]);
    prismaMock.post.findUnique.mockResolvedValueOnce(makePost());

    const { GET } = await import("../route");
    const res = (await GET(authedReq())) as unknown as {
      status: string;
      data: { published: number; details: Array<{ status: string }> };
    };
    expect(res.status).toBe("SUCCESS");
    expect(res.data.published).toBe(1);
    expect(res.data.details[0]!.status).toBe("PUBLISHED");

    expect(publishMock).toHaveBeenCalledTimes(1);
    expect(publishMock).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "hello world",
        userId: "user-1",
        callerJob: "auto-publish",
      })
    );
    expect(prismaMock.scheduledPublish.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "sp-1" },
        data: expect.objectContaining({
          status: "PUBLISHED",
          externalPostId: "ext-1",
          externalUrl: "https://example.com/p/ext-1",
        }),
      })
    );
  });
});

describe("auto-publish cron — error paths", () => {
  it("PlatformDisconnectedError marks FAILED terminal, no retry", async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([makeClaim()]);
    prismaMock.post.findUnique.mockResolvedValueOnce(makePost());
    const { PlatformDisconnectedError } = await import("@/lib/platform/errors");
    publishMock.mockRejectedValueOnce(
      new PlatformDisconnectedError("X", "user-1", "token revoked")
    );

    const { GET } = await import("../route");
    const res = (await GET(authedReq())) as unknown as {
      status: string;
      data: { errors: number; details: Array<{ status: string }> };
    };
    expect(res.status).toBe("FAILURE");
    expect(res.data.errors).toBe(1);
    expect(res.data.details[0]!.status).toBe("FAILED");
    expect(prismaMock.scheduledPublish.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "FAILED", attemptCount: 3 }),
      })
    );
    expect(sentryMock.captureException).toHaveBeenCalled();
  });

  it("rejects content over the platform's textLimit before publisher runs", async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([makeClaim({ platform: "X" })]);
    prismaMock.post.findUnique.mockResolvedValueOnce(makePost({ content: "x".repeat(281) }));

    const { GET } = await import("../route");
    const res = (await GET(authedReq())) as unknown as {
      status: string;
      data: { details: Array<{ status: string; error?: string }> };
    };
    expect(res.status).toBe("FAILURE");
    expect(res.data.details[0]!.status).toBe("FAILED");
    expect(res.data.details[0]!.error).toMatch(/X limit/);
    expect(publishMock).not.toHaveBeenCalled();
  });

  it("transient error increments attemptCount, resets to PENDING", async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([makeClaim({ attemptCount: 0 })]);
    prismaMock.post.findUnique.mockResolvedValueOnce(makePost());
    publishMock.mockRejectedValueOnce(new Error("transient network blip"));

    const { GET } = await import("../route");
    await GET(authedReq());

    expect(prismaMock.scheduledPublish.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "PENDING", attemptCount: 1 }),
      })
    );
  });

  it("attemptCount approaching cap → next failure marks FAILED", async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([makeClaim({ attemptCount: 2 })]);
    prismaMock.post.findUnique.mockResolvedValueOnce(makePost());
    publishMock.mockRejectedValueOnce(new Error("still failing"));

    const { GET } = await import("../route");
    await GET(authedReq());

    expect(prismaMock.scheduledPublish.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "FAILED", attemptCount: 3 }),
      })
    );
  });

  it("missing creds (token revoked) → FAILED with platform_disconnected, no publish", async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([makeClaim({ platform: "LINKEDIN" })]);
    prismaMock.post.findUnique.mockResolvedValueOnce(makePost());
    liTokenMock.mockResolvedValueOnce(null);

    const { GET } = await import("../route");
    const res = (await GET(authedReq())) as unknown as {
      data: { details: Array<{ status: string; error?: string }> };
    };
    expect(res.data.details[0]!.status).toBe("FAILED");
    expect(res.data.details[0]!.error).toBe("platform_disconnected");
    expect(publishMock).not.toHaveBeenCalled();
  });

  it("post.userId / scheduled-publish.userId mismatch → FAILED + Sentry error", async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([makeClaim({ userId: "user-A" })]);
    prismaMock.post.findUnique.mockResolvedValueOnce(makePost({ userId: "user-B" }));

    const { GET } = await import("../route");
    const res = (await GET(authedReq())) as unknown as {
      data: { details: Array<{ status: string; error?: string }> };
    };
    expect(res.data.details[0]!.status).toBe("FAILED");
    expect(res.data.details[0]!.error).toBe("userId_mismatch");
    expect(publishMock).not.toHaveBeenCalled();
    expect(sentryMock.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining("userId / scheduled-publish.userId mismatch"),
      expect.objectContaining({ level: "error" })
    );
  });
});

describe("auto-publish cron — media handling", () => {
  function makeMedia(count: number) {
    return Array.from({ length: count }, (_, i) => ({
      id: `m-${i}`,
      url: `https://cdn/${i}.jpg`,
      thumbnailUrl: null,
      filename: `${i}.jpg`,
      mimeType: "image/jpeg",
      width: 100,
      height: 100,
      position: i,
      alt: "",
    }));
  }

  function postWithConv(overrides?: { content?: string }) {
    return {
      id: "post-1",
      userId: "user-1",
      content: overrides?.content ?? "with media",
      conversationId: "conv-1",
    };
  }

  it("forwards loaded media to publisher when conversationId is set", async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([makeClaim({ platform: "X" })]);
    prismaMock.post.findUnique.mockResolvedValueOnce(postWithConv());
    const media = makeMedia(2);
    getMediaMock.mockResolvedValueOnce(media);

    const { GET } = await import("../route");
    await GET(authedReq());

    expect(getMediaMock).toHaveBeenCalledWith("conv-1", "user-1");
    expect(publishMock).toHaveBeenCalledWith(expect.objectContaining({ media }));
  });

  it("does not call getMediaForConversation when post has no conversationId", async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([makeClaim()]);
    prismaMock.post.findUnique.mockResolvedValueOnce(makePost());

    const { GET } = await import("../route");
    await GET(authedReq());

    expect(getMediaMock).not.toHaveBeenCalled();
    expect(publishMock).toHaveBeenCalledWith(
      expect.not.objectContaining({ media: expect.anything() })
    );
  });

  it("rejects media count over the platform's limit before publisher runs (X=4)", async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([makeClaim({ platform: "X" })]);
    prismaMock.post.findUnique.mockResolvedValueOnce(postWithConv());
    getMediaMock.mockResolvedValueOnce(makeMedia(5));

    const { GET } = await import("../route");
    const res = (await GET(authedReq())) as unknown as {
      status: string;
      data: { details: Array<{ status: string; error?: string }> };
    };
    expect(res.data.details[0]!.status).toBe("FAILED");
    expect(res.data.details[0]!.error).toMatch(/X.*media|media.*X/i);
    expect(publishMock).not.toHaveBeenCalled();
  });

  it("media fetch failure (Prisma error) → retry path, not terminal", async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([makeClaim({ attemptCount: 0 })]);
    prismaMock.post.findUnique.mockResolvedValueOnce(postWithConv());
    getMediaMock.mockRejectedValueOnce(new Error("DB unreachable"));

    const { GET } = await import("../route");
    await GET(authedReq());

    expect(prismaMock.scheduledPublish.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "PENDING", attemptCount: 1 }),
      })
    );
    expect(publishMock).not.toHaveBeenCalled();
  });
});

describe("auto-publish cron — multi-platform isolation", () => {
  it("processes each claimed row independently — one failure doesn't affect others", async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([
      makeClaim({ id: "sp-x", platform: "X" }),
      makeClaim({ id: "sp-li", platform: "LINKEDIN" }),
      makeClaim({ id: "sp-th", platform: "THREADS" }),
    ]);
    prismaMock.post.findUnique.mockResolvedValue(makePost());
    publishMock
      .mockResolvedValueOnce({ externalPostId: "x-1", externalUrl: "u" })
      .mockRejectedValueOnce(new Error("LinkedIn 500"))
      .mockResolvedValueOnce({ externalPostId: "th-1", externalUrl: "u" });

    const { GET } = await import("../route");
    const res = (await GET(authedReq())) as unknown as {
      status: string;
      data: { published: number; errors: number; details: Array<{ status: string }> };
    };
    expect(res.status).toBe("PARTIAL");
    expect(res.data.published).toBe(2);
    expect(res.data.errors).toBe(1);
    const statuses = res.data.details.map((d) => d.status).sort();
    expect(statuses).toEqual(["PUBLISHED", "PUBLISHED", "RETRY"]);
  });
});
