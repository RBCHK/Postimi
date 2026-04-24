import * as Sentry from "@sentry/nextjs";
import { withCronLogging } from "@/lib/cron-helpers";
import { sweepStaleReservations } from "@/lib/ai-quota";
import { prisma } from "@/lib/prisma";

export const maxDuration = 30;

// Retention windows per track-e-schema.md MEDIUM finding. Tables grow
// linearly with no existing cleanup; these conservative windows preserve
// enough history for cost audit + quota accounting while bounding growth.
const X_API_CALL_LOG_RETENTION_DAYS = 90;
const AI_USAGE_RETENTION_DAYS = 180;
const CRON_JOB_RUN_RETENTION_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

type RetentionCounts = {
  xApiCallLog: number | { error: string };
  aiUsage: number | { error: string };
  cronJobRun: number | { error: string };
};

/**
 * Deletes rows older than each table's retention window. Every delete is
 * isolated in its own try/catch so one table's failure doesn't abort the
 * others — we want best-effort cleanup even if one query hits a lock
 * timeout or transient DB error.
 */
async function retentionCleanup(): Promise<RetentionCounts> {
  const now = Date.now();
  const counts: RetentionCounts = {
    xApiCallLog: 0,
    aiUsage: 0,
    cronJobRun: 0,
  };

  // XApiCallLog: keep 90 days for cost-audit window.
  try {
    const cutoff = new Date(now - X_API_CALL_LOG_RETENTION_DAYS * DAY_MS);
    const { count } = await prisma.xApiCallLog.deleteMany({
      where: { calledAt: { lt: cutoff } },
    });
    counts.xApiCallLog = count;
  } catch (err) {
    Sentry.captureException(err, { tags: { job: "retention", table: "XApiCallLog" } });
    counts.xApiCallLog = { error: err instanceof Error ? err.message : String(err) };
  }

  // AiUsage: keep 180 days of terminal rows. RESERVED rows are left alone —
  // sweepStaleReservations already flips zombie RESERVED → ABORTED.
  try {
    const cutoff = new Date(now - AI_USAGE_RETENTION_DAYS * DAY_MS);
    const { count } = await prisma.aiUsage.deleteMany({
      where: {
        createdAt: { lt: cutoff },
        status: { in: ["COMPLETED", "ABORTED", "FAILED"] },
      },
    });
    counts.aiUsage = count;
  } catch (err) {
    Sentry.captureException(err, { tags: { job: "retention", table: "AiUsage" } });
    counts.aiUsage = { error: err instanceof Error ? err.message : String(err) };
  }

  // CronJobRun: keep 30 days. Admin dashboards don't need older history.
  try {
    const cutoff = new Date(now - CRON_JOB_RUN_RETENTION_DAYS * DAY_MS);
    const { count } = await prisma.cronJobRun.deleteMany({
      where: { startedAt: { lt: cutoff } },
    });
    counts.cronJobRun = count;
  } catch (err) {
    Sentry.captureException(err, { tags: { job: "retention", table: "CronJobRun" } });
    counts.cronJobRun = { error: err instanceof Error ? err.message : String(err) };
  }

  return counts;
}

/**
 * Manual-trigger endpoint for (a) sweeping zombie RESERVED rows and
 * (b) deleting rows past each table's retention window. Not on Vercel
 * cron (10-cron plan limit) — daily-insight cron invokes
 * sweepStaleReservations() automatically, and admins hit ▷ Run now for
 * the retention sweep.
 */
export const GET = withCronLogging("cleanup-stale-reservations", async () => {
  const swept = await sweepStaleReservations();
  const retention = await retentionCleanup();
  return { status: "SUCCESS", data: { swept, retention } };
});
