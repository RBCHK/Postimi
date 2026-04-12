import { describe, it, expect, vi, beforeEach } from "vitest";
import { SubscriptionStatus } from "@/generated/prisma";

// ─── Mocks ───────────────────────────────────────────────

const prismaMock = {
  subscription: {
    findFirst: vi.fn(),
  },
};

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Tests ───────────────────────────────────────────────

describe("getActiveSubscription", () => {
  it("returns subscription when active and period not ended", async () => {
    const mockSub = {
      id: "sub-1",
      userId: "user-1",
      status: SubscriptionStatus.ACTIVE,
      currentPeriodEnd: new Date(Date.now() + 86400000),
    };
    prismaMock.subscription.findFirst.mockResolvedValue(mockSub);

    const { getActiveSubscription } = await import("../subscription");
    const result = await getActiveSubscription("user-1");

    expect(result).toEqual(mockSub);
    expect(prismaMock.subscription.findFirst).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING] },
        currentPeriodEnd: { gt: expect.any(Date) },
      },
    });
  });

  it("returns null when no active subscription", async () => {
    prismaMock.subscription.findFirst.mockResolvedValue(null);

    const { getActiveSubscription } = await import("../subscription");
    const result = await getActiveSubscription("user-1");

    expect(result).toBeNull();
  });

  it("returns trialing subscription", async () => {
    const mockSub = {
      id: "sub-2",
      userId: "user-1",
      status: SubscriptionStatus.TRIALING,
      currentPeriodEnd: new Date(Date.now() + 86400000),
    };
    prismaMock.subscription.findFirst.mockResolvedValue(mockSub);

    const { getActiveSubscription } = await import("../subscription");
    const result = await getActiveSubscription("user-1");

    expect(result).toEqual(mockSub);
  });
});

describe("requireActiveSubscription", () => {
  it("returns subscription when active", async () => {
    const mockSub = {
      id: "sub-1",
      userId: "user-1",
      status: SubscriptionStatus.ACTIVE,
    };
    prismaMock.subscription.findFirst.mockResolvedValue(mockSub);

    const { requireActiveSubscription } = await import("../subscription");
    const result = await requireActiveSubscription("user-1");

    expect(result).toEqual(mockSub);
  });

  it("throws SubscriptionRequiredError when no subscription", async () => {
    prismaMock.subscription.findFirst.mockResolvedValue(null);

    const { requireActiveSubscription } = await import("../subscription");

    await expect(requireActiveSubscription("user-1")).rejects.toThrow(
      "Active subscription required"
    );
  });
});
