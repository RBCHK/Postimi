import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Regression coverage for the PR that wired auto-publish into vercel.json +
// withCronLogging + CronJobConfig. Asserts:
//   1. handler iterates due SCHEDULED slots, posts to X, flips them to POSTED.
//   2. Conversation status update is scoped by userId (defense-in-depth).
//   3. Zero due slots → SUCCESS with published=0, no side effects.
//   4. Media downloads run in parallel with a timeout; any fetch
//      failure aborts the slot (X requires all-or-nothing media) and
//      Sentry captures with per-item tags.

const CRON_SECRET = "test-secret";
process.env.CRON_SECRET = CRON_SECRET;

const captureExceptionMock = vi.hoisted(() => vi.fn());
vi.mock("@sentry/nextjs", () => ({ captureException: captureExceptionMock }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// Passthrough wrapper so we test the handler directly.
vi.mock("@/lib/cron-helpers", () => ({
  withCronLogging:
    (_name: string, handler: (req: NextRequest) => Promise<unknown>) => (req: NextRequest) =>
      handler(req),
}));

vi.mock("@/lib/server/x-token", () => ({
  getXApiTokenForUser: vi.fn().mockResolvedValue({ accessToken: "x" }),
}));

const postTweetMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ tweetUrl: "https://x.com/u/status/1" })
);
const uploadMediaToXMock = vi.hoisted(() => vi.fn().mockResolvedValue("media-id-1"));
vi.mock("@/lib/x-api", () => ({
  postTweet: postTweetMock,
  uploadMediaToX: uploadMediaToXMock,
}));

const getMediaForConversationMock = vi.hoisted(() => vi.fn().mockResolvedValue([]));
vi.mock("@/lib/server/media", () => ({
  getMediaForConversation: getMediaForConversationMock,
}));

// Media downloads go through fetchWithTimeout. The cron route calls it
// directly for image bytes; mock at that boundary so we can assert
// parallelism + timeout propagation without hitting the network.
const fetchWithTimeoutMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/fetch-with-timeout", () => ({
  fetchWithTimeout: fetchWithTimeoutMock,
}));

// Real slotToUtcDate is timezone-sensitive; return the raw slot date so the
// handler's `dueSlots` filter is driven by the date we choose in the fixture.
vi.mock("@/lib/date-utils", () => ({
  slotToUtcDate: (d: Date) => d,
}));

const prismaMock = {
  scheduledSlot: {
    findMany: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
  },
  conversation: {
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    update: vi.fn().mockResolvedValue({}),
  },
};
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

beforeEach(() => {
  vi.clearAllMocks();
  // Default: no media rows. Specific tests override.
  getMediaForConversationMock.mockResolvedValue([]);
  uploadMediaToXMock.mockResolvedValue("media-id-default");
  postTweetMock.mockResolvedValue({ tweetUrl: "https://x.com/u/status/1" });
});

function req() {
  return new NextRequest("http://localhost/api/cron/auto-publish", {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
}

describe("auto-publish cron", () => {
  it("returns SUCCESS and no side effects when nothing is due", async () => {
    prismaMock.scheduledSlot.findMany.mockResolvedValueOnce([]);

    const { GET } = await import("../route");
    const result = (await GET(req())) as unknown as {
      status: string;
      data: { published: number };
    };

    expect(result.status).toBe("SUCCESS");
    expect(result.data.published).toBe(0);
    expect(prismaMock.scheduledSlot.update).not.toHaveBeenCalled();
    expect(prismaMock.conversation.updateMany).not.toHaveBeenCalled();
  });

  it("scopes Conversation update by userId (defense-in-depth)", async () => {
    const past = new Date("2020-01-01T00:00:00Z");
    prismaMock.scheduledSlot.findMany.mockResolvedValueOnce([
      {
        id: "slot-1",
        conversationId: "conv-1",
        content: "hello world",
        date: past,
        timeSlot: "9:00 AM",
        status: "SCHEDULED",
        user: { id: "user-1", timezone: "UTC" },
      },
    ]);

    const { GET } = await import("../route");
    await GET(req());

    // Slot flipped to POSTED
    expect(prismaMock.scheduledSlot.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "slot-1" },
        data: expect.objectContaining({ status: "POSTED" }),
      })
    );

    // Conversation update MUST be updateMany scoped by userId — not update()
    expect(prismaMock.conversation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "conv-1", userId: "user-1" }),
        data: expect.objectContaining({ status: "POSTED" }),
      })
    );
    expect(prismaMock.conversation.update).not.toHaveBeenCalled();
  });

  it("skips slots whose scheduled time is still in the future", async () => {
    const future = new Date(Date.now() + 24 * 3600_000);
    prismaMock.scheduledSlot.findMany.mockResolvedValueOnce([
      {
        id: "slot-future",
        conversationId: null,
        content: "later",
        date: future,
        timeSlot: "9:00 AM",
        status: "SCHEDULED",
        user: { id: "user-1", timezone: "UTC" },
      },
    ]);

    const { GET } = await import("../route");
    const result = (await GET(req())) as unknown as { data: { published: number } };

    expect(result.data.published).toBe(0);
    expect(prismaMock.scheduledSlot.update).not.toHaveBeenCalled();
  });

  it("downloads media in parallel and uploads all to X on happy path", async () => {
    const past = new Date("2020-01-01T00:00:00Z");
    prismaMock.scheduledSlot.findMany.mockResolvedValueOnce([
      {
        id: "slot-media-ok",
        conversationId: "conv-media-ok",
        content: "tweet with images",
        date: past,
        timeSlot: "9:00 AM",
        status: "SCHEDULED",
        user: { id: "user-1", timezone: "UTC" },
      },
    ]);

    const media = [
      { id: "m-1", url: "https://cdn.test/a.jpg", mimeType: "image/jpeg" },
      { id: "m-2", url: "https://cdn.test/b.jpg", mimeType: "image/jpeg" },
      { id: "m-3", url: "https://cdn.test/c.jpg", mimeType: "image/jpeg" },
    ];
    getMediaForConversationMock.mockResolvedValueOnce(media);

    // Track concurrent in-flight calls so we can assert parallelism —
    // not all three have to peak at once (the loop may still be
    // queueing), but the max concurrency must exceed 1. Sequential
    // fetches would plateau at 1.
    let inFlight = 0;
    let maxInFlight = 0;
    fetchWithTimeoutMock.mockImplementation(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => new ArrayBuffer(8),
      };
    });
    uploadMediaToXMock
      .mockResolvedValueOnce("x-media-a")
      .mockResolvedValueOnce("x-media-b")
      .mockResolvedValueOnce("x-media-c");

    const { GET } = await import("../route");
    const result = (await GET(req())) as unknown as {
      status: string;
      data: { published: number };
    };

    expect(result.status).toBe("SUCCESS");
    expect(result.data.published).toBe(1);
    expect(fetchWithTimeoutMock).toHaveBeenCalledTimes(3);
    // The three timeouts must all be explicit (not the 30s default).
    for (const call of fetchWithTimeoutMock.mock.calls) {
      const [, init] = call as [string, { timeoutMs?: number }];
      expect(init?.timeoutMs).toBeGreaterThan(0);
      expect(init?.timeoutMs).toBeLessThanOrEqual(30_000);
    }
    expect(maxInFlight).toBeGreaterThan(1);

    // All three medias uploaded to X in order.
    expect(uploadMediaToXMock).toHaveBeenCalledTimes(3);
    expect(postTweetMock).toHaveBeenCalledWith(
      expect.anything(),
      "tweet with images",
      expect.objectContaining({ mediaIds: ["x-media-a", "x-media-b", "x-media-c"] })
    );
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it("aborts the slot and captures per-item Sentry when one media fetch fails", async () => {
    const past = new Date("2020-01-01T00:00:00Z");
    prismaMock.scheduledSlot.findMany.mockResolvedValueOnce([
      {
        id: "slot-media-partial",
        conversationId: "conv-media-partial",
        content: "tweet with one bad image",
        date: past,
        timeSlot: "9:00 AM",
        status: "SCHEDULED",
        user: { id: "user-1", timezone: "UTC" },
      },
    ]);

    const media = [
      { id: "m-good", url: "https://cdn.test/good.jpg", mimeType: "image/jpeg" },
      { id: "m-bad", url: "https://cdn.test/bad.jpg", mimeType: "image/jpeg" },
    ];
    getMediaForConversationMock.mockResolvedValueOnce(media);

    fetchWithTimeoutMock.mockImplementation(async (url: string) => {
      if (url === "https://cdn.test/bad.jpg") {
        throw new Error("simulated timeout");
      }
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => new ArrayBuffer(8),
      };
    });

    const { GET } = await import("../route");
    const result = (await GET(req())) as unknown as {
      status: string;
      data: { published: number; errors: number };
    };

    // Slot failed — but overall-cron status propagates the error.
    expect(result.data.published).toBe(0);
    expect(result.data.errors).toBe(1);
    // Neither media uploaded (all-or-nothing) and no tweet posted.
    expect(uploadMediaToXMock).not.toHaveBeenCalled();
    expect(postTweetMock).not.toHaveBeenCalled();
    // Slot NOT flipped to POSTED.
    expect(prismaMock.scheduledSlot.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "POSTED" }) })
    );

    // Sentry captures: one for the specific media item (tagged with
    // mediaId + url), plus one for the slot-level error thrown from the
    // try/catch. We assert the per-item capture landed at minimum.
    const perItemCalls = captureExceptionMock.mock.calls.filter((c) => {
      const opts = c[1] as { tags?: { area?: string; mediaId?: string } } | undefined;
      return opts?.tags?.area === "auto-publish-media" && opts?.tags?.mediaId === "m-bad";
    });
    expect(perItemCalls).toHaveLength(1);
  });
});
