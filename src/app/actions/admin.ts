"use server";

import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";

/**
 * Wrapper that structurally guarantees requireAdmin() is called
 * before any admin action. Impossible to forget auth check.
 */
function adminAction<T extends unknown[], R>(fn: (adminUserId: string, ...args: T) => Promise<R>) {
  return async (...args: T): Promise<R> => {
    const userId = await requireAdmin();
    return fn(userId, ...args);
  };
}

// ─── Cron Configs ──────────────────────────────────────────

export const getCronConfigs = adminAction(async () => {
  const configs = await prisma.cronJobConfig.findMany({
    orderBy: { jobName: "asc" },
  });

  // Attach last run info for each job
  const jobNames = configs.map((c) => c.jobName);
  const lastRuns = await prisma.cronJobRun.findMany({
    where: { jobName: { in: jobNames } },
    orderBy: { startedAt: "desc" },
    distinct: ["jobName"],
    select: {
      jobName: true,
      status: true,
      startedAt: true,
      durationMs: true,
    },
  });

  const lastRunMap = new Map(lastRuns.map((r) => [r.jobName, r]));

  return configs.map((c) => ({
    jobName: c.jobName,
    enabled: c.enabled,
    description: c.description,
    schedule: c.schedule,
    updatedAt: c.updatedAt,
    lastRun: lastRunMap.get(c.jobName) ?? null,
  }));
});

export const toggleCronJob = adminAction(
  async (_adminUserId: string, jobName: string, enabled: boolean) => {
    const { userId: clerkId } = await import("@clerk/nextjs/server").then((m) => m.auth());

    await prisma.cronJobConfig.update({
      where: { jobName },
      data: {
        enabled,
        updatedBy: clerkId,
      },
    });

    return { jobName, enabled };
  }
);

// ─── Cron Runs ─────────────────────────────────────────────

export const getCronRuns = adminAction(
  async (_adminUserId: string, options: { jobName?: string; limit?: number } = {}) => {
    const { jobName, limit = 50 } = options;

    const runs = await prisma.cronJobRun.findMany({
      where: jobName ? { jobName } : undefined,
      orderBy: { startedAt: "desc" },
      take: limit,
      select: {
        id: true,
        jobName: true,
        status: true,
        durationMs: true,
        resultJson: true,
        error: true,
        startedAt: true,
      },
    });

    return runs;
  }
);

// ─── API Cost Summary ──────────────────────────────────────

export const getApiCostSummary = adminAction(
  async (_adminUserId: string, period: "today" | "week" | "month") => {
    const now = new Date();
    const start = new Date(now);

    if (period === "today") {
      start.setUTCHours(0, 0, 0, 0);
    } else if (period === "week") {
      start.setUTCDate(start.getUTCDate() - 7);
    } else {
      start.setUTCDate(start.getUTCDate() - 30);
    }

    const result = await prisma.xApiCallLog.aggregate({
      where: { calledAt: { gte: start } },
      _sum: { costCents: true, resourceCount: true },
      _count: true,
    });

    return {
      period,
      totalCostCents: result._sum.costCents ?? 0,
      totalResources: result._sum.resourceCount ?? 0,
      totalCalls: result._count,
    };
  }
);

export const getApiCostDaily = adminAction(async (_adminUserId: string, days: number = 14) => {
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - days);

  const logs = await prisma.xApiCallLog.findMany({
    where: { calledAt: { gte: start } },
    select: {
      calledAt: true,
      costCents: true,
      resourceType: true,
      resourceCount: true,
    },
    orderBy: { calledAt: "asc" },
  });

  // Group by date
  const byDate = new Map<
    string,
    { date: string; costCents: number; calls: number; resources: number }
  >();

  for (const log of logs) {
    const date = log.calledAt.toISOString().split("T")[0];
    const existing = byDate.get(date) ?? { date, costCents: 0, calls: 0, resources: 0 };
    existing.costCents += log.costCents;
    existing.calls += 1;
    existing.resources += log.resourceCount;
    byDate.set(date, existing);
  }

  return Array.from(byDate.values());
});
