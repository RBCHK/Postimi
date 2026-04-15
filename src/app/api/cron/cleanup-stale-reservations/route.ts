import { withCronLogging } from "@/lib/cron-helpers";
import { sweepStaleReservations } from "@/lib/ai-quota";

export const maxDuration = 30;

/**
 * Manual-trigger endpoint for sweeping zombie RESERVED rows. Not on Vercel cron
 * (10-cron plan limit) — daily-insight cron invokes sweepStaleReservations()
 * automatically. Kept as Bearer-gated route for on-demand cleanup.
 */
export const GET = withCronLogging("cleanup-stale-reservations", async () => {
  const swept = await sweepStaleReservations();
  return { status: "SUCCESS", data: { swept } };
});
