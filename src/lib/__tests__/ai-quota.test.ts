import { describe, it, expect, vi, beforeEach } from "vitest";
import { AiUsageStatus, SubscriptionStatus } from "@/generated/prisma";
import {
  QuotaExceededError,
  RateLimitExceededError,
  SubscriptionRequiredError,
} from "@/lib/errors";

// ─── Prisma mock ─────────────────────────────────────────

const aiUsageMock = {
  aggregate: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
};

const userMock = {
  findUnique: vi.fn(),
  update: vi.fn(),
};

const prismaMock = {
  aiUsage: aiUsageMock,
  user: userMock,
  // $transaction executes the callback with tx = same prisma client
  $transaction: vi.fn(async (fn, _opts?: unknown) => {
    void _opts;
    if (typeof fn === "function") return fn(prismaMock);
    return Promise.all(fn);
  }),
};

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

// subscription mock
const requireActiveSubscriptionMock = vi.fn();
vi.mock("@/lib/subscription", () => ({
  requireActiveSubscription: (userId: string) => requireActiveSubscriptionMock(userId),
}));

// auth mock
vi.mock("@/lib/auth", () => ({
  isAdminClerkId: (id: string | null | undefined) => id === "admin-clerk-id",
}));

// system-user constant — must match the value reserveQuota checks against.
vi.mock("@/lib/server/system-user", () => ({
  SYSTEM_USER_CLERK_ID: "system_global_research",
}));

// Sentry mock — silence
vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

beforeEach(() => {
  vi.resetAllMocks();
  // re-install $transaction default impl (resetAllMocks wipes implementations)
  prismaMock.$transaction.mockImplementation(async (fn, _opts?: unknown) => {
    void _opts;
    if (typeof fn === "function") return fn(prismaMock);
    return Promise.all(fn);
  });
});

// ─── Tests ───────────────────────────────────────────────

describe("reserveQuota", () => {
  const periodStart = new Date("2026-04-01T00:00:00Z");
  const activeSub = {
    id: "sub-1",
    userId: "user-1",
    status: SubscriptionStatus.ACTIVE,
    currentPeriodStart: periodStart,
    currentPeriodEnd: new Date("2026-05-01T00:00:00Z"),
  };

  function mockRateLimitOk() {
    userMock.findUnique
      // rate-limit tx
      .mockResolvedValueOnce({ rateLimitWindowStart: null, rateLimitRequestCount: 0 })
      // reserveQuota's user fetch
      .mockResolvedValueOnce({ clerkId: "user-clerk-id", monthlyAiQuotaUsd: null });
    userMock.update.mockResolvedValue({});
  }

  it("throws SubscriptionRequiredError when no active subscription", async () => {
    userMock.findUnique.mockResolvedValueOnce({
      rateLimitWindowStart: null,
      rateLimitRequestCount: 0,
    });
    userMock.findUnique.mockResolvedValueOnce({
      clerkId: "user-clerk-id",
      monthlyAiQuotaUsd: null,
    });
    userMock.update.mockResolvedValue({});
    requireActiveSubscriptionMock.mockRejectedValueOnce(new SubscriptionRequiredError());

    const { reserveQuota } = await import("../ai-quota");
    await expect(reserveQuota({ userId: "user-1", operation: "chat" })).rejects.toBeInstanceOf(
      SubscriptionRequiredError
    );
  });

  it("throws QuotaExceededError when spent + estimate > quota", async () => {
    mockRateLimitOk();
    requireActiveSubscriptionMock.mockResolvedValueOnce(activeSub);
    // Chat estimate = 0.15, default quota = 10. Spent = 9.9 → 9.9 + 0.15 > 10.
    aiUsageMock.aggregate.mockResolvedValueOnce({ _sum: { costUsd: 9.9 } });

    const { reserveQuota } = await import("../ai-quota");
    await expect(reserveQuota({ userId: "user-1", operation: "chat" })).rejects.toBeInstanceOf(
      QuotaExceededError
    );
  });

  it("throws RateLimitExceededError at 31st request in window", async () => {
    userMock.findUnique.mockResolvedValue({
      rateLimitWindowStart: new Date(),
      rateLimitRequestCount: 30,
    });

    const { reserveQuota } = await import("../ai-quota");
    await expect(reserveQuota({ userId: "user-1", operation: "chat" })).rejects.toBeInstanceOf(
      RateLimitExceededError
    );
  });

  it("resets rate limit window when expired (>60s old)", async () => {
    userMock.findUnique
      .mockResolvedValueOnce({
        rateLimitWindowStart: new Date(Date.now() - 120 * 1000),
        rateLimitRequestCount: 100,
      })
      .mockResolvedValueOnce({ clerkId: "user-clerk-id", monthlyAiQuotaUsd: null });
    userMock.update.mockResolvedValue({});
    requireActiveSubscriptionMock.mockResolvedValueOnce(activeSub);
    aiUsageMock.aggregate.mockResolvedValueOnce({ _sum: { costUsd: 0 } });
    aiUsageMock.create.mockResolvedValueOnce({ id: "res-1" });

    const { reserveQuota } = await import("../ai-quota");
    await expect(reserveQuota({ userId: "user-1", operation: "chat" })).resolves.toEqual({
      reservationId: "res-1",
      model: "claude-sonnet-4-6",
    });
  });

  it("admin bypasses rate limit, subscription, and quota checks", async () => {
    userMock.findUnique.mockResolvedValueOnce({
      clerkId: "admin-clerk-id",
      monthlyAiQuotaUsd: null,
    });
    aiUsageMock.create.mockResolvedValueOnce({ id: "res-admin" });

    const { reserveQuota } = await import("../ai-quota");
    const result = await reserveQuota({ userId: "admin-user", operation: "chat" });
    expect(result).toEqual({ reservationId: "res-admin", model: "claude-sonnet-4-6" });
    expect(requireActiveSubscriptionMock).not.toHaveBeenCalled();
    expect(aiUsageMock.aggregate).not.toHaveBeenCalled();
  });

  it("SYSTEM_USER bypasses rate limit, subscription, and quota checks", async () => {
    // Researcher Phase A reserves AiUsage under SYSTEM_USER. SYSTEM_USER
    // has no subscription and no rate-limit row; without the bypass,
    // requireActiveSubscription would reject and Phase A would fail with
    // "Active subscription required" (regression PR fixed in 2026-04
    // when researcher cron was first re-enabled in prod).
    userMock.findUnique.mockResolvedValueOnce({
      clerkId: "system_global_research",
      monthlyAiQuotaUsd: null,
    });
    aiUsageMock.create.mockResolvedValueOnce({ id: "res-system" });

    const { reserveQuota } = await import("../ai-quota");
    const result = await reserveQuota({
      userId: "system-user-id",
      operation: "researcher",
    });
    expect(result).toEqual({ reservationId: "res-system", model: "claude-sonnet-4-6" });
    expect(requireActiveSubscriptionMock).not.toHaveBeenCalled();
    expect(aiUsageMock.aggregate).not.toHaveBeenCalled();
    // AiUsage row still created — cost stays auditable in admin dashboard.
    expect(aiUsageMock.create).toHaveBeenCalledWith({
      data: {
        userId: "system-user-id",
        operation: "researcher",
        model: "claude-sonnet-4-6",
        costUsd: 0,
        status: AiUsageStatus.RESERVED,
      },
      select: { id: true },
    });
  });

  it("creates RESERVED row with estimated cost when within quota", async () => {
    mockRateLimitOk();
    requireActiveSubscriptionMock.mockResolvedValueOnce(activeSub);
    aiUsageMock.aggregate.mockResolvedValueOnce({ _sum: { costUsd: 1.0 } });
    aiUsageMock.create.mockResolvedValueOnce({ id: "res-ok" });

    const { reserveQuota } = await import("../ai-quota");
    await reserveQuota({ userId: "user-1", operation: "strategist" });

    expect(aiUsageMock.create).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        operation: "strategist",
        model: "claude-sonnet-4-6",
        costUsd: 0.5,
        status: AiUsageStatus.RESERVED,
      },
      select: { id: true },
    });
  });

  it("aggregation excludes FAILED status and gates on periodStart", async () => {
    mockRateLimitOk();
    requireActiveSubscriptionMock.mockResolvedValueOnce(activeSub);
    aiUsageMock.aggregate.mockResolvedValueOnce({ _sum: { costUsd: 0 } });
    aiUsageMock.create.mockResolvedValueOnce({ id: "res-1" });

    const { reserveQuota } = await import("../ai-quota");
    await reserveQuota({ userId: "user-1", operation: "chat" });

    expect(aiUsageMock.aggregate).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        createdAt: { gte: periodStart },
        status: {
          in: [AiUsageStatus.RESERVED, AiUsageStatus.COMPLETED, AiUsageStatus.ABORTED],
        },
      },
      _sum: { costUsd: true },
    });
  });

  it("uses Serializable isolation level for quota transaction", async () => {
    mockRateLimitOk();
    requireActiveSubscriptionMock.mockResolvedValueOnce(activeSub);
    aiUsageMock.aggregate.mockResolvedValueOnce({ _sum: { costUsd: 0 } });
    aiUsageMock.create.mockResolvedValueOnce({ id: "res-1" });

    const { reserveQuota } = await import("../ai-quota");
    await reserveQuota({ userId: "user-1", operation: "chat" });

    // Second call to $transaction is the quota transaction (first is rate limit)
    const quotaTxCall = prismaMock.$transaction.mock.calls[1];
    expect(quotaTxCall?.[1]).toEqual({ isolationLevel: "Serializable" });
  });

  it("retries on Prisma serialization failure (P2034) and succeeds", async () => {
    userMock.findUnique
      .mockResolvedValueOnce({ rateLimitWindowStart: null, rateLimitRequestCount: 0 })
      .mockResolvedValueOnce({ clerkId: "user-clerk-id", monthlyAiQuotaUsd: null });
    userMock.update.mockResolvedValue({});
    requireActiveSubscriptionMock.mockResolvedValueOnce(activeSub);

    // Quota tx: first attempt fails with P2034, second succeeds
    const serializationErr = Object.assign(new Error("serialization conflict"), { code: "P2034" });
    let callCount = 0;
    prismaMock.$transaction.mockImplementation(async (fn, opts?: unknown) => {
      if (typeof fn !== "function") return Promise.all(fn);
      // First call = rate limit tx (no opts). Pass through.
      if (!opts) return fn(prismaMock);
      // Subsequent calls = quota tx (Serializable). First throws.
      callCount++;
      if (callCount === 1) throw serializationErr;
      return fn(prismaMock);
    });

    aiUsageMock.aggregate.mockResolvedValue({ _sum: { costUsd: 0 } });
    aiUsageMock.create.mockResolvedValueOnce({ id: "res-retry" });

    const { reserveQuota } = await import("../ai-quota");
    const result = await reserveQuota({ userId: "user-1", operation: "chat" });
    expect(result.reservationId).toBe("res-retry");
    expect(callCount).toBe(2);
  });

  it("gives up after 3 serialization failures and throws", async () => {
    userMock.findUnique
      .mockResolvedValueOnce({ rateLimitWindowStart: null, rateLimitRequestCount: 0 })
      .mockResolvedValueOnce({ clerkId: "user-clerk-id", monthlyAiQuotaUsd: null });
    userMock.update.mockResolvedValue({});
    requireActiveSubscriptionMock.mockResolvedValueOnce(activeSub);

    const serializationErr = Object.assign(new Error("serialization conflict"), { code: "P2034" });
    prismaMock.$transaction.mockImplementation(async (fn, opts?: unknown) => {
      if (typeof fn !== "function") return Promise.all(fn);
      if (!opts) return fn(prismaMock);
      throw serializationErr;
    });

    const { reserveQuota } = await import("../ai-quota");
    await expect(reserveQuota({ userId: "user-1", operation: "chat" })).rejects.toMatchObject({
      code: "P2034",
    });
  });

  it("throws on unknown operation", async () => {
    const { reserveQuota } = await import("../ai-quota");
    await expect(reserveQuota({ userId: "user-1", operation: "nonexistent" })).rejects.toThrow(
      /Unknown operation/
    );
  });
});

describe("completeReservation", () => {
  it("updates row to COMPLETED with real tokens and computed cost", async () => {
    aiUsageMock.update.mockResolvedValueOnce({});

    const { completeReservation } = await import("../ai-quota");
    await completeReservation({
      reservationId: "res-1",
      model: "claude-sonnet-4-6",
      tokensIn: 1000,
      tokensOut: 500,
    });

    expect(aiUsageMock.update).toHaveBeenCalledWith({
      where: { id: "res-1" },
      data: {
        model: "claude-sonnet-4-6",
        tokensIn: 1000,
        tokensOut: 500,
        // 1000*3 + 500*15 = 10500 / 1M = 0.0105
        costUsd: 0.0105,
        status: AiUsageStatus.COMPLETED,
      },
    });
  });

  it("swallows DB errors and logs to Sentry (billing hole alert)", async () => {
    const Sentry = await import("@sentry/nextjs");
    aiUsageMock.update.mockRejectedValueOnce(new Error("db down"));
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { completeReservation } = await import("../ai-quota");
    await expect(
      completeReservation({
        reservationId: "res-x",
        model: "claude-sonnet-4-6",
        tokensIn: 0,
        tokensOut: 0,
      })
    ).resolves.toBeUndefined();

    expect(Sentry.captureException).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});

describe("abortReservation / failReservation", () => {
  it("abortReservation sets status ABORTED", async () => {
    aiUsageMock.update.mockResolvedValueOnce({});
    const { abortReservation } = await import("../ai-quota");
    await abortReservation("res-1");
    expect(aiUsageMock.update).toHaveBeenCalledWith({
      where: { id: "res-1" },
      data: { status: AiUsageStatus.ABORTED },
    });
  });

  it("failReservation sets status FAILED", async () => {
    aiUsageMock.update.mockResolvedValueOnce({});
    const { failReservation } = await import("../ai-quota");
    await failReservation("res-1");
    expect(aiUsageMock.update).toHaveBeenCalledWith({
      where: { id: "res-1" },
      data: { status: AiUsageStatus.FAILED },
    });
  });
});
