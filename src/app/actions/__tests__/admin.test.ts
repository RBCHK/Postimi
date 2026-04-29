import { describe, it, expect, vi, beforeEach } from "vitest";

// Admin actions are gated by `requireAdmin()` — the `adminAction` wrapper
// calls it first and passes the adminUserId into the handler. This file
// covers every export OTHER THAN `runCronJob` (which has its own file):
// getCronConfigs, toggleCronJob, getCronRuns, getApiCostSummary,
// getApiCostDaily. These are the read/audit surfaces of /admin — if
// requireAdmin() is bypassed, a regular user can list every cron's
// enabled state and daily API cost.

const prismaMock = vi.hoisted(() => ({
  cronJobConfig: { findMany: vi.fn(), update: vi.fn() },
  cronJobRun: { findMany: vi.fn() },
  xApiCallLog: { aggregate: vi.fn(), findMany: vi.fn() },
}));

const requireAdminMock = vi.hoisted(() => vi.fn<() => Promise<string>>());

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/auth", () => ({ requireAdmin: requireAdminMock }));

// toggleCronJob dynamically imports `@clerk/nextjs/server` to read the
// current clerkId for the updatedBy audit column — mock it.
const clerkAuthMock = vi.fn<() => Promise<{ userId: string | null }>>();
vi.mock("@clerk/nextjs/server", () => ({ auth: clerkAuthMock }));

beforeEach(() => {
  vi.clearAllMocks();
  requireAdminMock.mockResolvedValue("admin-1");
  clerkAuthMock.mockResolvedValue({ userId: "clerk-admin-1" });
  prismaMock.cronJobConfig.findMany.mockResolvedValue([]);
  prismaMock.cronJobConfig.update.mockResolvedValue({});
  prismaMock.cronJobRun.findMany.mockResolvedValue([]);
  prismaMock.xApiCallLog.aggregate.mockResolvedValue({
    _sum: { costCents: 0, resourceCount: 0 },
    _count: 0,
  });
  prismaMock.xApiCallLog.findMany.mockResolvedValue([]);
});

describe("getCronConfigs", () => {
  it("rejects non-admin callers before any DB read", async () => {
    requireAdminMock.mockRejectedValueOnce(new Error("Not admin"));
    const { getCronConfigs } = await import("../admin");

    await expect(getCronConfigs()).rejects.toThrow("Not admin");

    expect(prismaMock.cronJobConfig.findMany).not.toHaveBeenCalled();
  });

  it("returns configs joined with each job's most recent run", async () => {
    prismaMock.cronJobConfig.findMany.mockResolvedValue([
      {
        jobName: "social-import",
        enabled: true,
        description: "X import",
        schedule: "0 * * * *",
        updatedAt: new Date("2026-04-20"),
      },
      {
        jobName: "strategist",
        enabled: false,
        description: "Strategist",
        schedule: "0 9 * * *",
        updatedAt: new Date("2026-04-19"),
      },
    ]);
    prismaMock.cronJobRun.findMany.mockResolvedValue([
      {
        jobName: "social-import",
        status: "SUCCESS",
        startedAt: new Date("2026-04-20T10:00:00.000Z"),
        durationMs: 1234,
      },
    ]);

    const { getCronConfigs } = await import("../admin");
    const result = await getCronConfigs();

    expect(result).toHaveLength(2);
    // Joined — social-import has a lastRun, strategist does not.
    expect(result[0]).toMatchObject({
      jobName: "social-import",
      enabled: true,
      lastRun: expect.objectContaining({ status: "SUCCESS" }),
    });
    expect(result[1]).toMatchObject({
      jobName: "strategist",
      enabled: false,
      lastRun: null,
    });
  });

  it("asks Prisma for latest-run-per-jobName via distinct", async () => {
    prismaMock.cronJobConfig.findMany.mockResolvedValue([
      {
        jobName: "social-import",
        enabled: true,
        description: "",
        schedule: "",
        updatedAt: new Date(),
      },
    ]);

    const { getCronConfigs } = await import("../admin");
    await getCronConfigs();

    expect(prismaMock.cronJobRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { jobName: { in: ["social-import"] } },
        distinct: ["jobName"],
        orderBy: { startedAt: "desc" },
      })
    );
  });
});

describe("toggleCronJob", () => {
  it("rejects non-admin callers before writing", async () => {
    requireAdminMock.mockRejectedValueOnce(new Error("Not admin"));
    const { toggleCronJob } = await import("../admin");

    await expect(toggleCronJob("social-import", false)).rejects.toThrow("Not admin");

    expect(prismaMock.cronJobConfig.update).not.toHaveBeenCalled();
  });

  it("updates the config with the new flag and audit clerkId", async () => {
    const { toggleCronJob } = await import("../admin");

    const result = await toggleCronJob("social-import", false);

    expect(prismaMock.cronJobConfig.update).toHaveBeenCalledWith({
      where: { jobName: "social-import" },
      data: { enabled: false, updatedBy: "clerk-admin-1" },
    });
    expect(result).toEqual({ jobName: "social-import", enabled: false });
  });
});

describe("getCronRuns", () => {
  it("rejects non-admin callers before reading", async () => {
    requireAdminMock.mockRejectedValueOnce(new Error("Not admin"));
    const { getCronRuns } = await import("../admin");

    await expect(getCronRuns()).rejects.toThrow("Not admin");

    expect(prismaMock.cronJobRun.findMany).not.toHaveBeenCalled();
  });

  it("defaults limit to 50 and omits the where clause when no jobName passed", async () => {
    const { getCronRuns } = await import("../admin");
    await getCronRuns();

    expect(prismaMock.cronJobRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: undefined,
        take: 50,
        orderBy: { startedAt: "desc" },
      })
    );
  });

  it("passes an explicit jobName filter through", async () => {
    const { getCronRuns } = await import("../admin");
    await getCronRuns({ jobName: "social-import", limit: 10 });

    expect(prismaMock.cronJobRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { jobName: "social-import" },
        take: 10,
      })
    );
  });
});

describe("getApiCostSummary — period handling", () => {
  it("rejects non-admin callers before reading", async () => {
    requireAdminMock.mockRejectedValueOnce(new Error("Not admin"));
    const { getApiCostSummary } = await import("../admin");

    await expect(getApiCostSummary("today")).rejects.toThrow("Not admin");

    expect(prismaMock.xApiCallLog.aggregate).not.toHaveBeenCalled();
  });

  it("today: aggregates since UTC midnight of the current day", async () => {
    const { getApiCostSummary } = await import("../admin");

    const before = Date.now();
    await getApiCostSummary("today");
    const after = Date.now();

    const gte = prismaMock.xApiCallLog.aggregate.mock.calls[0]![0].where.calledAt.gte as Date;
    // Start is UTC midnight of today — same calendar day as before/after.
    const todayMidnightUtc = new Date(before);
    todayMidnightUtc.setUTCHours(0, 0, 0, 0);
    expect(gte.getTime()).toBe(todayMidnightUtc.getTime());
    expect(gte.getTime()).toBeLessThanOrEqual(after);
  });

  it("week: aggregates since now - 7 days (UTC)", async () => {
    const { getApiCostSummary } = await import("../admin");

    const before = Date.now();
    await getApiCostSummary("week");

    const gte = prismaMock.xApiCallLog.aggregate.mock.calls[0]![0].where.calledAt.gte as Date;
    // ~7 days before "now".
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    expect(gte.getTime()).toBeGreaterThanOrEqual(before - sevenDays - 1000);
    expect(gte.getTime()).toBeLessThanOrEqual(before + 1000);
  });

  it("month: aggregates since now - 30 days (UTC)", async () => {
    const { getApiCostSummary } = await import("../admin");

    const before = Date.now();
    await getApiCostSummary("month");

    const gte = prismaMock.xApiCallLog.aggregate.mock.calls[0]![0].where.calledAt.gte as Date;
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    expect(gte.getTime()).toBeGreaterThanOrEqual(before - thirtyDays - 1000);
  });

  it("returns totals with nullish defaults when aggregate returns nulls", async () => {
    prismaMock.xApiCallLog.aggregate.mockResolvedValue({
      _sum: { costCents: null, resourceCount: null },
      _count: 0,
    });

    const { getApiCostSummary } = await import("../admin");
    const result = await getApiCostSummary("today");

    expect(result).toEqual({
      period: "today",
      totalCostCents: 0,
      totalResources: 0,
      totalCalls: 0,
    });
  });

  it("propagates real totals into the response", async () => {
    prismaMock.xApiCallLog.aggregate.mockResolvedValue({
      _sum: { costCents: 999, resourceCount: 42 },
      _count: 7,
    });

    const { getApiCostSummary } = await import("../admin");
    const result = await getApiCostSummary("today");

    expect(result).toEqual({
      period: "today",
      totalCostCents: 999,
      totalResources: 42,
      totalCalls: 7,
    });
  });
});

describe("getApiCostDaily — grouping", () => {
  it("rejects non-admin callers before reading", async () => {
    requireAdminMock.mockRejectedValueOnce(new Error("Not admin"));
    const { getApiCostDaily } = await import("../admin");

    await expect(getApiCostDaily()).rejects.toThrow("Not admin");

    expect(prismaMock.xApiCallLog.findMany).not.toHaveBeenCalled();
  });

  it("defaults to 14 days back and orders by calledAt asc", async () => {
    const { getApiCostDaily } = await import("../admin");

    const before = Date.now();
    await getApiCostDaily();

    const call = prismaMock.xApiCallLog.findMany.mock.calls[0]![0];
    expect(call.orderBy).toEqual({ calledAt: "asc" });
    const gte = call.where.calledAt.gte as Date;
    const fourteenDays = 14 * 24 * 60 * 60 * 1000;
    expect(gte.getTime()).toBeGreaterThanOrEqual(before - fourteenDays - 1000);
  });

  it("groups logs by ISO date and sums cost/calls/resources per day", async () => {
    prismaMock.xApiCallLog.findMany.mockResolvedValue([
      {
        calledAt: new Date("2026-04-20T08:00:00.000Z"),
        costCents: 5,
        resourceType: "tweet",
        resourceCount: 1,
      },
      {
        calledAt: new Date("2026-04-20T14:00:00.000Z"),
        costCents: 3,
        resourceType: "tweet",
        resourceCount: 2,
      },
      {
        calledAt: new Date("2026-04-21T00:10:00.000Z"),
        costCents: 10,
        resourceType: "tweet",
        resourceCount: 5,
      },
    ]);

    const { getApiCostDaily } = await import("../admin");
    const result = await getApiCostDaily();

    expect(result).toHaveLength(2);
    expect(result).toEqual(
      expect.arrayContaining([
        { date: "2026-04-20", costCents: 8, calls: 2, resources: 3 },
        { date: "2026-04-21", costCents: 10, calls: 1, resources: 5 },
      ])
    );
  });
});
