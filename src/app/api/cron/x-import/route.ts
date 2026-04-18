import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/prisma";
import { fetchUserTweetsPaginated } from "@/lib/x-api";
import { getXApiTokenForUserInternal } from "@/app/actions/x-token";
import { revalidatePath } from "next/cache";
import { withCronLogging } from "@/lib/cron-helpers";
import type { XPostType as PrismaXPostType } from "@/generated/prisma";

export const maxDuration = 60;

const REFRESH_DAYS = 7;

function detectPostType(text: string): PrismaXPostType {
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
      const credentials = await getXApiTokenForUserInternal(user.id);
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
        const latest = await prisma.xPost.findFirst({
          where: { userId: user.id },
          orderBy: { date: "desc" },
          select: { postId: true },
        });
        tweets = await fetchUserTweetsPaginated(credentials, {
          sinceId: latest?.postId,
        });
      }

      let imported = 0;
      let updated = 0;
      let snapshots = 0;

      const snapshotDate = new Date();
      snapshotDate.setUTCHours(0, 0, 0, 0);

      for (const tweet of tweets) {
        const existing = await prisma.xPost.findUnique({
          where: { userId_postId: { userId: user.id, postId: tweet.postId } },
          select: { createdAt: true },
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
        };

        const updateData: Record<string, unknown> = {
          ...apiMetrics,
          dataSource: "API",
        };
        if (tweet.profileVisits !== undefined) {
          updateData.profileVisits = tweet.profileVisits;
        }

        const postType = detectPostType(tweet.text);

        await prisma.xPost.upsert({
          where: { userId_postId: { userId: user.id, postId: tweet.postId } },
          create: {
            userId: user.id,
            postId: tweet.postId,
            date: tweet.createdAt,
            text: tweet.text,
            postLink: tweet.postLink,
            postType,
            ...apiMetrics,
            profileVisits: tweet.profileVisits ?? 0,
            dataSource: "API",
          },
          update: updateData,
        });

        if (existing) updated++;
        else imported++;

        // ADR-008 Phase 1a: dual-write to platform-agnostic SocialPost.
        // Wrapped in its own try/catch so a schema/Zod regression on the
        // new table never rolls back the legacy XPost write. The Phase 1b
        // cutover removes the legacy branch and this `.catch` safety net.
        let socialPostId: string | null = null;
        try {
          const socialMetrics = {
            ...apiMetrics,
            profileVisits: tweet.profileVisits ?? 0,
          };
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
              ...socialMetrics,
              dataSource: "API",
            },
            update: {
              ...socialMetrics,
              dataSource: "API",
            },
            select: { id: true },
          });
          socialPostId = socialPost.id;
        } catch (socialErr) {
          Sentry.captureException(socialErr, {
            tags: { phase: "1a-dual-write", model: "SocialPost", platform: "X" },
            extra: { userId: user.id, externalPostId: tweet.postId },
          });
        }

        // Save engagement snapshot for velocity tracking
        const postAgeDays = (Date.now() - tweet.createdAt.getTime()) / (1000 * 60 * 60 * 24);
        if (postAgeDays < REFRESH_DAYS) {
          const snapshotMetrics = {
            ...apiMetrics,
            profileVisits: tweet.profileVisits ?? 0,
          };

          await prisma.postEngagementSnapshot.upsert({
            where: {
              userId_postId_snapshotDate: {
                userId: user.id,
                postId: tweet.postId,
                snapshotDate: snapshotDate,
              },
            },
            create: {
              userId: user.id,
              postId: tweet.postId,
              snapshotDate: snapshotDate,
              ...snapshotMetrics,
            },
            update: snapshotMetrics,
          });
          snapshots++;

          // ADR-008 Phase 1a: dual-write engagement snapshot. Requires
          // SocialPost to have been created first (FK on postId). Skip
          // if the SocialPost write above failed — Sentry already captured.
          if (socialPostId) {
            try {
              await prisma.socialPostEngagementSnapshot.upsert({
                where: {
                  userId_platform_postId_snapshotDate: {
                    userId: user.id,
                    platform: "X",
                    postId: socialPostId,
                    snapshotDate,
                  },
                },
                create: {
                  userId: user.id,
                  platform: "X",
                  postId: socialPostId,
                  snapshotDate,
                  ...snapshotMetrics,
                },
                update: snapshotMetrics,
              });
            } catch (snapErr) {
              Sentry.captureException(snapErr, {
                tags: {
                  phase: "1a-dual-write",
                  model: "SocialPostEngagementSnapshot",
                  platform: "X",
                },
                extra: { userId: user.id, externalPostId: tweet.postId },
              });
            }
          }
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
