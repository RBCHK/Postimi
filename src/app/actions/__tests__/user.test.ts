import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ───────────────────────────────────────────────

const TEST_USER_ID = "user-1";

vi.mock("@/lib/auth", () => ({
  requireUserId: vi.fn().mockResolvedValue(TEST_USER_ID),
}));

const prismaMock = {
  user: {
    findUnique: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
  },
};

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Tests ───────────────────────────────────────────────

describe("syncTimezone", () => {
  it("skips DB write when timezone is already up to date", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ timezone: "America/Vancouver" });

    const { syncTimezone } = await import("../user");
    await syncTimezone("America/Vancouver");

    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("updates DB when timezone has changed", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ timezone: "UTC" });

    const { syncTimezone } = await import("../user");
    await syncTimezone("America/Vancouver");

    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: TEST_USER_ID },
      data: { timezone: "America/Vancouver" },
    });
  });

  it("updates DB when user has no timezone yet (null)", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ timezone: null });

    const { syncTimezone } = await import("../user");
    await syncTimezone("Europe/Moscow");

    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: TEST_USER_ID },
      data: { timezone: "Europe/Moscow" },
    });
  });
});
