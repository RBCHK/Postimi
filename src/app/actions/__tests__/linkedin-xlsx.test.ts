import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

// ADR-008 Phase 3.1 server-action tests.
//
// These cover action-level guards that are *not* enforced by the parser
// itself: size cap, magic-byte check, authenticated user isolation,
// Sentry on unexpected errors, and the correct upsert-key shape so data
// lands in `SocialPost WHERE platform="LINKEDIN"`.

vi.mock("@/lib/auth", () => ({ requireUserId: vi.fn() }));

const sentryMock = vi.hoisted(() => ({ captureException: vi.fn() }));
vi.mock("@sentry/nextjs", () => sentryMock);

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const prismaMock = vi.hoisted(() => ({
  socialPost: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
  },
  socialDailyStats: {
    upsert: vi.fn(),
  },
  socialFollowersSnapshot: {
    upsert: vi.fn(),
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

import { requireUserId } from "@/lib/auth";
import { importLinkedInXlsx } from "../linkedin-xlsx";

const USER_ID = "user-li-1";

const WEEKLY_PATH = path.join(process.cwd(), "tests/fixtures/linkedin/sample-weekly.xlsx");
const QUARTERLY_PATH = path.join(process.cwd(), "tests/fixtures/linkedin/sample-quarterly.xlsx");

function loadFile(p: string, name = "export.xlsx"): File {
  const raw = fs.readFileSync(p);
  // Copy into a fresh ArrayBuffer so tests can't accidentally share state.
  const ab = new ArrayBuffer(raw.byteLength);
  new Uint8Array(ab).set(raw);
  return new File([ab], name, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

function formDataWith(file: File): FormData {
  const fd = new FormData();
  fd.set("file", file);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  (requireUserId as ReturnType<typeof vi.fn>).mockResolvedValue(USER_ID);
  prismaMock.socialPost.findUnique.mockResolvedValue(null);
  prismaMock.socialPost.upsert.mockResolvedValue({ id: "sp-1" });
  prismaMock.socialDailyStats.upsert.mockResolvedValue({});
  prismaMock.socialFollowersSnapshot.upsert.mockResolvedValue({});
});

describe("importLinkedInXlsx — guards", () => {
  it("rejects missing file with a specific error", async () => {
    await expect(importLinkedInXlsx(new FormData())).rejects.toThrow(/No file uploaded/);
    expect(prismaMock.socialPost.upsert).not.toHaveBeenCalled();
  });

  it("rejects files larger than the 5 MB cap", async () => {
    // PK magic header so the size check runs before the magic-byte check.
    const blob = new Uint8Array(6 * 1024 * 1024);
    blob[0] = 0x50;
    blob[1] = 0x4b;
    const file = new File([blob], "oversized.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    await expect(importLinkedInXlsx(formDataWith(file))).rejects.toThrow(/max 5 MB/);
  });

  it("rejects non-xlsx bytes (magic-byte sniff catches misnamed CSV)", async () => {
    // A renamed CSV: correct extension, wrong magic bytes.
    const csv = "Post URL,Impressions\nhttps://x,1\n";
    const file = new File([csv], "notxlsx.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    await expect(importLinkedInXlsx(formDataWith(file))).rejects.toThrow(/not a valid xlsx/);
    expect(prismaMock.socialPost.upsert).not.toHaveBeenCalled();
  });
});

describe("importLinkedInXlsx — happy path", () => {
  it("weekly fixture: upserts posts/daily/followers with platform=LINKEDIN scoped to the caller", async () => {
    const result = await importLinkedInXlsx(formDataWith(loadFile(WEEKLY_PATH)));

    // 3 top posts in the fixture.
    expect(prismaMock.socialPost.upsert).toHaveBeenCalledTimes(3);
    expect(result.postsImported).toBe(3);
    expect(result.postsUpdated).toBe(0);

    // Every post upsert is scoped to the authenticated user and platform.
    for (const call of prismaMock.socialPost.upsert.mock.calls) {
      const args = call[0];
      expect(args.where.userId_platform_externalPostId.userId).toBe(USER_ID);
      expect(args.where.userId_platform_externalPostId.platform).toBe("LINKEDIN");
      expect(args.create.userId).toBe(USER_ID);
      expect(args.create.platform).toBe("LINKEDIN");
      expect(args.create.platformMetadata.platform).toBe("LINKEDIN");
      expect(args.create.dataSource).toBe("CSV");
    }

    // 7 days of engagement + 7 days of follower snapshots.
    expect(prismaMock.socialDailyStats.upsert).toHaveBeenCalledTimes(7);
    expect(prismaMock.socialFollowersSnapshot.upsert).toHaveBeenCalledTimes(7);
    expect(result.dailyStatsUpserted).toBe(7);
    expect(result.followerSnapshotsUpserted).toBe(7);

    // Daily + followers scoping check.
    for (const call of prismaMock.socialDailyStats.upsert.mock.calls) {
      expect(call[0].where.userId_platform_date.userId).toBe(USER_ID);
      expect(call[0].where.userId_platform_date.platform).toBe("LINKEDIN");
    }
    for (const call of prismaMock.socialFollowersSnapshot.upsert.mock.calls) {
      expect(call[0].where.userId_platform_date.userId).toBe(USER_ID);
      expect(call[0].where.userId_platform_date.platform).toBe("LINKEDIN");
    }

    expect(result.totalFollowers).toBe(1531);
  });

  it("uses the permanent activity ID from the URL as externalPostId", async () => {
    await importLinkedInXlsx(formDataWith(loadFile(WEEKLY_PATH)));
    const ids = prismaMock.socialPost.upsert.mock.calls
      .map((c) => c[0].create.externalPostId as string)
      .sort();
    expect(ids).toEqual(["1000000000000000001", "1000000000000000002", "1000000000000000003"]);
  });

  it("quarterly fixture: dedupes by URL and reconciles metrics across both sides", async () => {
    await importLinkedInXlsx(formDataWith(loadFile(QUARTERLY_PATH)));
    // Fixture has 4 unique top-post URLs across both sides (one merged).
    expect(prismaMock.socialPost.upsert).toHaveBeenCalledTimes(4);

    const merged = prismaMock.socialPost.upsert.mock.calls.find(
      (c) => c[0].create.externalPostId === "1000000000000000001"
    );
    expect(merged).toBeDefined();
    expect(merged![0].create.impressions).toBe(5993);
    expect(merged![0].create.engagements).toBe(19);
  });
});

describe("importLinkedInXlsx — idempotency and isolation", () => {
  it("returns updated count when SocialPost already exists for this user+platform+postId", async () => {
    prismaMock.socialPost.findUnique.mockResolvedValue({
      id: "prev-1",
      impressions: 0,
      engagements: 0,
    });
    const result = await importLinkedInXlsx(formDataWith(loadFile(WEEKLY_PATH)));
    expect(result.postsImported).toBe(0);
    expect(result.postsUpdated).toBe(3);
  });

  it("keeps the larger of existing vs incoming metrics so a quarterly re-import never regresses a weekly one", async () => {
    prismaMock.socialPost.findUnique.mockResolvedValue({
      id: "prev-1",
      impressions: 10000, // previously imported from a larger quarterly
      engagements: 50,
    });
    await importLinkedInXlsx(formDataWith(loadFile(WEEKLY_PATH)));
    // Weekly fixture's max impressions for any post is 14; existing 10000
    // must win on every upsert.
    for (const call of prismaMock.socialPost.upsert.mock.calls) {
      expect(call[0].create.impressions).toBe(10000);
      expect(call[0].create.engagements).toBe(50);
    }
  });

  it("reports unexpected prisma errors to Sentry with action + userId tags", async () => {
    prismaMock.socialPost.upsert.mockRejectedValueOnce(new Error("DB gone"));
    await expect(importLinkedInXlsx(formDataWith(loadFile(WEEKLY_PATH)))).rejects.toThrow(
      "DB gone"
    );
    expect(sentryMock.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: expect.objectContaining({ action: "importLinkedInXlsx", userId: USER_ID }),
      })
    );
  });

  it("does not call Sentry on expected user errors (e.g. bad file)", async () => {
    const file = new File(["nope"], "notxlsx.xlsx", { type: "text/csv" });
    await expect(importLinkedInXlsx(formDataWith(file))).rejects.toThrow();
    expect(sentryMock.captureException).not.toHaveBeenCalled();
  });
});
