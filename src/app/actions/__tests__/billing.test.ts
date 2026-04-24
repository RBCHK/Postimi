import { describe, it, expect, vi, beforeEach } from "vitest";

// Billing info is assembled from 5 separate Prisma reads. Every single one
// must be scoped to the current user, otherwise a tenant could read
// another tenant's quota/usage numbers.

vi.mock("@/lib/auth", () => ({ requireUserId: vi.fn() }));

// AiUsageStatus is imported as a value in billing.ts — the mock must carry
// the enum members the code actually reads.
vi.mock("@/generated/prisma", () => ({
  AiUsageStatus: { RESERVED: "RESERVED", COMPLETED: "COMPLETED", ABORTED: "ABORTED" },
}));

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  subscription: { findUnique: vi.fn() },
  aiUsage: {
    aggregate: vi.fn(),
    groupBy: vi.fn(),
    findMany: vi.fn(),
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

// Plans ships an env-derived stripePriceId; pin the quota the test asserts.
vi.mock("@/lib/plans", () => ({
  PLANS: { pro: { monthlyAiQuotaUsd: 10, stripePriceId: "price_test" } },
}));

import { requireUserId } from "@/lib/auth";
import { getBillingInfo } from "../billing";

const USER_ID = "user-billing-1";

beforeEach(() => {
  vi.clearAllMocks();
  (requireUserId as ReturnType<typeof vi.fn>).mockResolvedValue(USER_ID);
  prismaMock.user.findUnique.mockResolvedValue(null);
  prismaMock.subscription.findUnique.mockResolvedValue(null);
  prismaMock.aiUsage.aggregate.mockResolvedValue({ _sum: { costUsd: 0 } });
  prismaMock.aiUsage.groupBy.mockResolvedValue([]);
  prismaMock.aiUsage.findMany.mockResolvedValue([]);
});

describe("getBillingInfo — auth & userId scoping", () => {
  it("calls requireUserId before any Prisma read", async () => {
    await getBillingInfo();
    expect(requireUserId).toHaveBeenCalledTimes(1);
  });

  it("scopes user.findUnique by the resolved userId", async () => {
    await getBillingInfo();
    expect(prismaMock.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: USER_ID } })
    );
  });

  it("scopes subscription.findUnique by the resolved userId", async () => {
    await getBillingInfo();
    expect(prismaMock.subscription.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: USER_ID } })
    );
  });

  it("scopes every aiUsage read by userId (aggregate, groupBy, findMany)", async () => {
    await getBillingInfo();

    for (const call of prismaMock.aiUsage.aggregate.mock.calls) {
      expect(call[0].where.userId).toBe(USER_ID);
    }
    for (const call of prismaMock.aiUsage.groupBy.mock.calls) {
      expect(call[0].where.userId).toBe(USER_ID);
    }
    for (const call of prismaMock.aiUsage.findMany.mock.calls) {
      expect(call[0].where.userId).toBe(USER_ID);
    }
  });
});

describe("getBillingInfo — quota & period handling", () => {
  it("falls back to PLANS.pro quota when user has no override", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ monthlyAiQuotaUsd: null });

    const info = await getBillingInfo();
    expect(info.quotaUsd).toBe(10);
  });

  it("uses the user-level quota override when present", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ monthlyAiQuotaUsd: 25 });

    const info = await getBillingInfo();
    expect(info.quotaUsd).toBe(25);
  });

  it("aggregates usage from subscription currentPeriodStart when subscribed", async () => {
    const periodStart = new Date("2026-04-01T00:00:00.000Z");
    prismaMock.subscription.findUnique.mockResolvedValue({
      status: "ACTIVE",
      currentPeriodStart: periodStart,
      currentPeriodEnd: new Date("2026-05-01T00:00:00.000Z"),
      cancelAtPeriodEnd: false,
    });

    await getBillingInfo();
    const aggCall = prismaMock.aiUsage.aggregate.mock.calls[0]![0];
    expect(aggCall.where.createdAt.gte).toBe(periodStart);
  });

  it("falls back to 30-day window for aggregation when no subscription exists", async () => {
    const before = Date.now();
    await getBillingInfo();
    const after = Date.now();

    const gte = prismaMock.aiUsage.aggregate.mock.calls[0]![0].where.createdAt.gte as Date;
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    expect(gte.getTime()).toBeGreaterThanOrEqual(before - thirtyDays - 1000);
    expect(gte.getTime()).toBeLessThanOrEqual(after - thirtyDays + 1000);
  });

  it("counts RESERVED + COMPLETED + ABORTED in the quota window (not PENDING/FAILED)", async () => {
    await getBillingInfo();
    const statuses = prismaMock.aiUsage.aggregate.mock.calls[0]![0].where.status.in;
    expect(statuses).toEqual(expect.arrayContaining(["RESERVED", "COMPLETED", "ABORTED"]));
    expect(statuses).not.toContain("PENDING");
    expect(statuses).not.toContain("FAILED");
  });
});

describe("getBillingInfo — response shape", () => {
  it("returns hasSubscription=false and null statuses when no subscription row", async () => {
    const info = await getBillingInfo();
    expect(info.hasSubscription).toBe(false);
    expect(info.status).toBeNull();
    expect(info.currentPeriodStart).toBeNull();
    expect(info.currentPeriodEnd).toBeNull();
    expect(info.cancelAtPeriodEnd).toBe(false);
  });

  it("serializes Date fields to ISO strings", async () => {
    const start = new Date("2026-04-01T00:00:00.000Z");
    const end = new Date("2026-05-01T00:00:00.000Z");
    prismaMock.subscription.findUnique.mockResolvedValue({
      status: "ACTIVE",
      currentPeriodStart: start,
      currentPeriodEnd: end,
      cancelAtPeriodEnd: true,
    });

    const info = await getBillingInfo();
    expect(info.currentPeriodStart).toBe(start.toISOString());
    expect(info.currentPeriodEnd).toBe(end.toISOString());
    expect(info.cancelAtPeriodEnd).toBe(true);
    expect(info.hasSubscription).toBe(true);
    expect(info.status).toBe("ACTIVE");
  });

  it("sorts the breakdown by costUsd descending", async () => {
    prismaMock.aiUsage.groupBy.mockResolvedValue([
      { operation: "cheap", _sum: { costUsd: 0.5 }, _count: { _all: 10 } },
      { operation: "expensive", _sum: { costUsd: 3.2 }, _count: { _all: 2 } },
      { operation: "mid", _sum: { costUsd: 1.1 }, _count: { _all: 5 } },
    ]);

    const info = await getBillingInfo();
    expect(info.breakdown.map((b) => b.operation)).toEqual(["expensive", "mid", "cheap"]);
    expect(info.breakdown[0]).toEqual({ operation: "expensive", costUsd: 3.2, count: 2 });
  });

  it("maps recent aiUsage rows into serialized history items", async () => {
    const created = new Date("2026-04-20T10:00:00.000Z");
    prismaMock.aiUsage.findMany.mockResolvedValue([
      {
        id: "u1",
        operation: "chat",
        model: "claude-opus",
        status: "COMPLETED",
        costUsd: 0.123,
        tokensIn: 100,
        tokensOut: 50,
        createdAt: created,
      },
    ]);

    const info = await getBillingInfo();
    expect(info.recent).toEqual([
      {
        id: "u1",
        operation: "chat",
        model: "claude-opus",
        status: "COMPLETED",
        costUsd: 0.123,
        tokensIn: 100,
        tokensOut: 50,
        createdAt: created.toISOString(),
      },
    ]);
  });

  it("applies LIMIT 20 and orderBy desc when loading recent usage", async () => {
    await getBillingInfo();
    const call = prismaMock.aiUsage.findMany.mock.calls[0]![0];
    expect(call.take).toBe(20);
    expect(call.orderBy).toEqual({ createdAt: "desc" });
  });
});
