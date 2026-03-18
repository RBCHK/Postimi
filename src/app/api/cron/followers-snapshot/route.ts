import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/prisma";
import { fetchUserData } from "@/lib/x-api";
import { saveFollowersSnapshotInternal } from "@/app/actions/followers";
import { withCronLogging } from "@/lib/cron-helpers";

export const maxDuration = 10;

export const GET = withCronLogging("followers-snapshot", async () => {
  const users = await prisma.user.findMany({ select: { id: true } });
  const results: {
    userId: string;
    followers?: number;
    deltaFollowers?: number;
    error?: string;
  }[] = [];

  for (const user of users) {
    try {
      const userData = await fetchUserData();
      const snapshot = await saveFollowersSnapshotInternal(user.id, {
        followersCount: userData.followersCount,
        followingCount: userData.followingCount,
      });

      results.push({
        userId: user.id,
        followers: snapshot.followersCount,
        deltaFollowers: snapshot.deltaFollowers,
      });
    } catch (err) {
      Sentry.captureException(err);
      console.error(`[followers-snapshot] user=${user.id}`, err);
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
