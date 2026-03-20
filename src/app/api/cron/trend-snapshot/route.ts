import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/prisma";
import { fetchPersonalizedTrends } from "@/lib/x-api";
import { getXApiTokenForUserInternal } from "@/app/actions/x-token";
import { saveTrendSnapshotsInternal, cleanupOldTrendsInternal } from "@/app/actions/trends";
import { withCronLogging } from "@/lib/cron-helpers";

const TREND_RETENTION_DAYS = 10;

export const maxDuration = 30;

export const GET = withCronLogging("trend-snapshot", async () => {
  const users = await prisma.user.findMany({ select: { id: true } });
  const results: {
    userId: string;
    trendsFound?: number;
    saved?: number;
    cleanedUp?: number;
    skipped?: boolean;
    error?: string;
  }[] = [];

  for (const user of users) {
    try {
      const credentials = await getXApiTokenForUserInternal(user.id);
      if (!credentials) {
        results.push({ userId: user.id, skipped: true });
        continue;
      }

      const trends = await fetchPersonalizedTrends(credentials);

      let saved = 0;
      if (trends.length > 0) {
        const now = new Date();
        saved = await saveTrendSnapshotsInternal(user.id, now, trends, now.getUTCHours());
      }

      const cleanedUp = await cleanupOldTrendsInternal(user.id, TREND_RETENTION_DAYS);

      results.push({
        userId: user.id,
        trendsFound: trends.length,
        saved,
        cleanedUp,
      });
    } catch (err) {
      Sentry.captureException(err);
      console.error(`[trend-snapshot] user=${user.id}`, err);
      results.push({
        userId: user.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const hasErrors = results.some((r) => r.error);
  return {
    status: hasErrors ? "PARTIAL" : "SUCCESS",
    data: { results },
  };
});
