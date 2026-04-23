import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Regression coverage for the PR that wired auto-publish into vercel.json +
// withCronLogging + CronJobConfig. Asserts:
//   1. handler iterates due SCHEDULED slots, posts to X, flips them to POSTED.
//   2. Conversation status update is scoped by userId (defense-in-depth).
//   3. Zero due slots → SUCCESS with published=0, no side effects.

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
  getXApiTokenForUser: vi.fn().mockResolvedValue({ accessToken: "x" }),
}));

vi.mock("@/lib/x-api", () => ({
  postTweet: vi.fn().mockResolvedValue({ tweetUrl: "https://x.com/u/status/1" }),
  uploadMediaToX: vi.fn().mockResolvedValue("media-id-1"),
}));

vi.mock("@/lib/server/media", () => ({
  getMediaForConversation: vi.fn().mockResolvedValue([]),
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
});
