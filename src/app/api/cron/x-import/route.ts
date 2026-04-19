import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/prisma";
import { fetchUserTweetsPaginated } from "@/lib/x-api";
import { getXApiTokenForUser } from "@/lib/server/x-token";
import { revalidatePath } from "next/cache";
import { withCronLogging } from "@/lib/cron-helpers";

// Phase 1b: imports straight into SocialPost (`platform: "X"`). The
// legacy dual-write to XPost / PostEngagementSnapshot was removed in
// this PR along with the legacy tables themselves.

export const maxDuration = 60;

const REFRESH_DAYS = 7;

function detectPostType(text: string): "POST" | "REPLY" {
  return text.startsWith("@") ? "REPLY" : "POST";
}

export const GET = withCronLogging("x-import", async (req) => {
  const mode = req.nextUrl.searchParams.get("mode"); // "refresh" or default (new posts)

  const users = await prisma.user.findMany({ select: { id: true } });

  const allResults: {
    userId: string;
    imported?: number;
    updated?: number;
    snapshots?: number;
    skipped?: boolean;
    error?: string;
  }[] = [];

  for (const user of users) {
    try {
      // Load per-user X credentials — skip users without connected X account
      const credentials = await getXApiTokenForUser(user.id);
      if (!credentials) {
        allResults.push({ userId: user.id, skipped: true });
        continue;
      }

      let tweets;
      if (mode === "refresh") {
        const startTime = new Date();
        startTime.setUTCDate(startTime.getUTCDate() - REFRESH_DAYS);
        tweets = await fetchUserTweetsPaginated(credentials, {
          startTime: startTime.toISOString(),
        });
      } else {
        const latest = await prisma.socialPost.findFirst({
          where: { userId: user.id, platform: "X" },
          orderBy: { postedAt: "desc" },
          select: { externalPostId: true },
        });
        tweets = await fetchUserTweetsPaginated(credentials, {
          sinceId: latest?.externalPostId,
        });
      }

      let imported = 0;
      let updated = 0;
      let snapshots = 0;

      const snapshotDate = new Date();
      snapshotDate.setUTCHours(0, 0, 0, 0);

      for (const tweet of tweets) {
        const existing = await prisma.socialPost.findUnique({
          where: {
            userId_platform_externalPostId: {
              userId: user.id,
              platform: "X",
              externalPostId: tweet.postId,
            },
          },
          select: { id: true },
        });

        const apiMetrics = {
          impressions: tweet.impressions,
          likes: tweet.likes,
          engagements: tweet.engagements,
          bookmarks: tweet.bookmarks,
          replies: tweet.replies,
          reposts: tweet.reposts,
          quoteCount: tweet.quoteCount,
          urlClicks: tweet.urlClicks,
          profileVisits: tweet.profileVisits ?? 0,
        };

        const updateData: Record<string, unknown> = {
          ...apiMetrics,
          dataSource: "API",
        };

        const postType = detectPostType(tweet.text);

        const socialPost = await prisma.socialPost.upsert({
          where: {
            userId_platform_externalPostId: {
              userId: user.id,
              platform: "X",
              externalPostId: tweet.postId,
            },
          },
          create: {
            userId: user.id,
            platform: "X",
            externalPostId: tweet.postId,
            postedAt: tweet.createdAt,
            text: tweet.text,
            postUrl: tweet.postLink,
            postType,
            platformMetadata: { platform: "X", postType },
            ...apiMetrics,
            dataSource: "API",
          },
          update: updateData,
          select: { id: true },
        });

        if (existing) updated++;
        else imported++;

        // Save engagement snapshot for velocity tracking (only while the
        // post is still "young" — older posts don't change meaningfully).
        const postAgeDays = (Date.now() - tweet.createdAt.getTime()) / (1000 * 60 * 60 * 24);
        if (postAgeDays < REFRESH_DAYS) {
          await prisma.socialPostEngagementSnapshot.upsert({
            where: {
              userId_platform_postId_snapshotDate: {
                userId: user.id,
                platform: "X",
                postId: socialPost.id,
                snapshotDate,
              },
            },
            create: {
              userId: user.id,
              platform: "X",
              postId: socialPost.id,
              snapshotDate,
              ...apiMetrics,
            },
            update: apiMetrics,
          });
          snapshots++;
        }
      }

      allResults.push({ userId: user.id, imported, updated, snapshots });
    } catch (err) {
      Sentry.captureException(err);
      console.error(`[x-import] user=${user.id}`, err);
      allResults.push({
        userId: user.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  revalidatePath("/analytics");

  const hasErrors = allResults.some((r) => r.error);
  return {
    status: hasErrors ? "PARTIAL" : "SUCCESS",
    data: { mode: mode ?? "default", results: allResults },
  };
});
