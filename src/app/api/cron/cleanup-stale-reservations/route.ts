import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/prisma";
import { AiUsageStatus } from "@/generated/prisma";
import { withCronLogging } from "@/lib/cron-helpers";

export const maxDuration = 30;

/**
 * Sweeps RESERVED rows older than 10 minutes → ABORTED.
 * Catches zombie reservations from killed routes (Vercel timeout, crash)
 * that never got onFinish/onError/onAbort.
 */
export const GET = withCronLogging("cleanup-stale-reservations", async () => {
  const staleThreshold = new Date(Date.now() - 10 * 60 * 1000);

  const result = await prisma.aiUsage.updateMany({
    where: {
      status: AiUsageStatus.RESERVED,
      createdAt: { lt: staleThreshold },
    },
    data: { status: AiUsageStatus.ABORTED },
  });

  if (result.count > 0) {
    Sentry.captureMessage(
      `[cleanup-stale-reservations] swept ${result.count} stale reservations`,
      "warning"
    );
  }

  return {
    status: "SUCCESS",
    data: { swept: result.count },
  };
});
