import { describe, it, expect, vi, beforeEach } from "vitest";

// ADR-008 Phase 4: connected-platforms detection.
//
// A platform is "connected" iff the user has signal for it:
//   - X: has XApiToken or SocialPost(platform=X)
//   - LinkedIn: has SocialPost(platform=LINKEDIN) (CSV-only, no token path)
//   - Threads: has ThreadsApiToken or SocialPost(platform=THREADS)

vi.mock("@/lib/auth", () => ({ requireUserId: vi.fn() }));

const prismaMock = vi.hoisted(() => ({
  xApiToken: { findUnique: vi.fn() },
  threadsApiToken: { findUnique: vi.fn() },
  socialPost: { groupBy: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

import { requireUserId } from "@/lib/auth";
import { getConnectedPlatforms } from "../platforms";

const USER_ID = "user-phase4";

beforeEach(() => {
  // resetAllMocks (not just clearAllMocks) drains the `mockResolvedValueOnce`
  // queue so leftover values from previous tests don't leak into the next one.
  vi.resetAllMocks();
  (requireUserId as ReturnType<typeof vi.fn>).mockResolvedValue(USER_ID);
});

describe("getConnectedPlatforms", () => {
  it("returns empty list + null primary for a brand-new user", async () => {
    prismaMock.xApiToken.findUnique.mockResolvedValue(null);
    prismaMock.threadsApiToken.findUnique.mockResolvedValue(null);
    prismaMock.socialPost.groupBy
      .mockResolvedValueOnce([]) // count by platform
      .mockResolvedValueOnce([]); // max postedAt per platform

    const result = await getConnectedPlatforms();
    expect(result.platforms).toEqual([]);
    expect(result.primary).toBeNull();
  });

  it("detects X from XApiToken alone (no posts yet)", async () => {
    prismaMock.xApiToken.findUnique.mockResolvedValue({ userId: USER_ID });
    prismaMock.threadsApiToken.findUnique.mockResolvedValue(null);
    prismaMock.socialPost.groupBy.mockResolvedValueOnce([]);

    const result = await getConnectedPlatforms();
    expect(result.platforms).toEqual(["X"]);
    expect(result.primary).toBe("X");
  });

  it("detects LinkedIn via SocialPost rows only (CSV-imported, no token path)", async () => {
    prismaMock.xApiToken.findUnique.mockResolvedValue(null);
    prismaMock.threadsApiToken.findUnique.mockResolvedValue(null);
    prismaMock.socialPost.groupBy
      .mockResolvedValueOnce([{ platform: "LINKEDIN", _count: { platform: 12 } }])
      .mockResolvedValueOnce([
        { platform: "LINKEDIN", _max: { postedAt: new Date("2026-04-10") } },
      ]);

    const result = await getConnectedPlatforms();
    expect(result.platforms).toEqual(["LINKEDIN"]);
    expect(result.primary).toBe("LINKEDIN");
  });

  it("returns all three when the user has signal for each, picks primary by latest postedAt", async () => {
    prismaMock.xApiToken.findUnique.mockResolvedValue({ userId: USER_ID });
    prismaMock.threadsApiToken.findUnique.mockResolvedValue({ userId: USER_ID });
    prismaMock.socialPost.groupBy
      .mockResolvedValueOnce([
        { platform: "X", _count: { platform: 50 } },
        { platform: "LINKEDIN", _count: { platform: 10 } },
        { platform: "THREADS", _count: { platform: 3 } },
      ])
      .mockResolvedValueOnce([
        { platform: "X", _max: { postedAt: new Date("2026-04-05") } },
        { platform: "LINKEDIN", _max: { postedAt: new Date("2026-04-15") } },
        { platform: "THREADS", _max: { postedAt: new Date("2026-04-10") } },
      ]);

    const result = await getConnectedPlatforms();
    // PLATFORMS array order preserved in `platforms` (X, LINKEDIN, THREADS),
    // but `primary` is the one with latest postedAt.
    expect(result.platforms).toEqual(["X", "LINKEDIN", "THREADS"]);
    expect(result.primary).toBe("LINKEDIN");
  });

  it("never returns a platform for another user (enforces per-user isolation in where clause)", async () => {
    prismaMock.xApiToken.findUnique.mockResolvedValue(null);
    prismaMock.threadsApiToken.findUnique.mockResolvedValue(null);
    prismaMock.socialPost.groupBy.mockResolvedValueOnce([]);

    await getConnectedPlatforms();

    // Verify every query filtered by userId — critical for data isolation.
    expect(prismaMock.xApiToken.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: USER_ID } })
    );
    expect(prismaMock.threadsApiToken.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: USER_ID } })
    );
    expect(prismaMock.socialPost.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: USER_ID }) })
    );
  });
});
