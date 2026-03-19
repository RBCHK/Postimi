import { fetchPersonalizedTrends } from "@/lib/x-api";
import { getAnyValidXApiToken } from "@/app/actions/x-token";
import { saveTrendSnapshotsInternal, cleanupOldTrendsInternal } from "@/app/actions/trends";
import { withCronLogging } from "@/lib/cron-helpers";

const TREND_RETENTION_DAYS = 10;

export const maxDuration = 30;

export const GET = withCronLogging("trend-snapshot", async () => {
  // Trends are global — use any connected user's token
  const credentials = await getAnyValidXApiToken();
  if (!credentials) {
    return {
      status: "SUCCESS",
      data: { skipped: true, reason: "No users with connected X account" },
    };
  }

  const trends = await fetchPersonalizedTrends(credentials);

  let saved = 0;
  if (trends.length > 0) {
    const now = new Date();
    saved = await saveTrendSnapshotsInternal(now, trends, now.getUTCHours());
  }

  const deleted = await cleanupOldTrendsInternal(TREND_RETENTION_DAYS);

  return {
    status: "SUCCESS",
    data: {
      trendsFound: trends.length,
      saved,
      cleanedUp: deleted,
    },
  };
});
