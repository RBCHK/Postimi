import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/prisma";
import { ensureSlotsForWeekInternal } from "@/app/actions/schedule";
import { withCronLogging } from "@/lib/cron-helpers";

export const maxDuration = 30;

export const GET = withCronLogging("ensure-slots", async () => {
  const users = await prisma.user.findMany({ select: { id: true, timezone: true } });
  const results: { userId: string; skipped?: boolean; error?: string }[] = [];

  for (const user of users) {
    try {
      await ensureSlotsForWeekInternal(user.id, user.timezone);
      results.push({ userId: user.id });
    } catch (err) {
      Sentry.captureException(err);
      console.error(`[ensure-slots] user=${user.id}`, err);
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
