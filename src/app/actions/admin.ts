"use server";

import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";

/**
 * Whitelist of cron paths the admin "Run now" button is allowed to hit.
 * Lives server-side so the client can never coerce us into fetching an
 * arbitrary URL with CRON_SECRET attached. Keep in sync with
 * `CRON_PATHS` in admin-view.tsx — that one is a UI map, this one is
 * the security boundary.
 */
const ALLOWED_CRON_PATHS: Record<string, string> = {
  "followers-snapshot": "/api/cron/followers-snapshot",
  "trend-snapshot": "/api/cron/trend-snapshot",
  "daily-insight": "/api/cron/daily-insight",
  "x-import": "/api/cron/x-import",
  "social-import": "/api/cron/social-import",
  researcher: "/api/cron/researcher",
  strategist: "/api/cron/strategist",
  "auto-publish": "/api/cron/auto-publish",
};

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

/**
 * Trigger a cron job on demand from the admin panel.
 *
 * Why a Server Action and not a direct client-side fetch: the cron
 * routes authenticate via `Bearer ${CRON_SECRET}`, which must never
 * reach the browser. We proxy the call server-side so the secret
 * stays in env, then surface the same response shape the UI expects.
 *
 * The path is resolved against a server-side whitelist — the client
 * passes only a `jobName`, never a URL.
 */
export const runCronJob = adminAction(async (_adminUserId: string, jobName: string) => {
  const path = ALLOWED_CRON_PATHS[jobName];
  if (!path) {
    return { ok: false, error: `Unknown job: ${jobName}` } as const;
  }

  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return { ok: false, error: "CRON_SECRET is not configured" } as const;
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) {
    return { ok: false, error: "NEXT_PUBLIC_APP_URL is not configured" } as const;
  }

  // `?manual=1` tells withCronLogging this is admin-intended, not a scheduled
  // Vercel invocation, and bypasses the enabled toggle. Admins pause the
  // schedule with the toggle; deliberate ▷ Run now should still fire. Without
  // this, a disabled cron returns ok:false with reason "Job disabled" and
  // the admin sees "unknown error" in the toast.
  const url = new URL(path, appUrl);
  url.searchParams.set("manual", "1");

  try {
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${secret}` },
      // Cron handlers may do DB work + external API calls; don't cache.
      cache: "no-store",
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      status?: string;
      reason?: string;
      skipped?: boolean;
    };

    if (!res.ok) {
      return {
        ok: false,
        error: data.error ?? `HTTP ${res.status}`,
      } as const;
    }

    // Defense-in-depth: if any future skip path in withCronLogging fires
    // despite manual=1, surface the reason so the UI can show it instead
    // of falling through to "unknown error".
    if (data.skipped) {
      return {
        ok: false,
        skipped: true,
        reason: data.reason ?? "Skipped (no reason given)",
      } as const;
    }

    return {
      ok: data.ok !== false,
      status: data.status,
      error: data.error,
    } as const;
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    } as const;
  }
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
