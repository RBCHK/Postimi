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

// Fraction of `maxDuration` we're willing to burn before bailing on
// remaining users. Refresh mode paginates up to ~35 X pages per highly
// active user + batched upserts, so a single stuck user can easily
// stall the batch close to the Vercel kill line. At 85% we still have
// ~9s headroom to finish withCronLogging's after() work cleanly.
const BUDGET_FRACTION = 0.85;

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
    budgetExhausted?: boolean;
    error?: string;
  }[] = [];

  const start = Date.now();
  const budgetMs = Math.floor(maxDuration * 1000 * BUDGET_FRACTION);

  for (let userIndex = 0; userIndex < users.length; userIndex++) {
    const user = users[userIndex]!;

    // Wall-clock guard: once we've consumed 85% of the function
    // budget, stop taking on new users. Remaining users are marked
    // `budgetExhausted` in the result so the next scheduled run can
    // pick them up (Sentry warning surfaces this in ops).
    const elapsedMs = Date.now() - start;
    if (elapsedMs > budgetMs) {
      const remaining = users.length - userIndex;
      Sentry.captureMessage("x-import budget exhausted", {
        level: "warning",
        tags: { area: "x-import", mode: mode ?? "default" },
        extra: {
          processedUsers: userIndex,
          usersRemaining: remaining,
          elapsedMs,
          budgetMs,
        },
      });
      for (let j = userIndex; j < users.length; j++) {
        allResults.push({ userId: users[j]!.id, budgetExhausted: true });
      }
      break;
    }

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

      if (tweets.length > 0) {
        // One findMany replaces N findUnique calls to classify each tweet
        // as new vs existing.
        const existingRows = await prisma.socialPost.findMany({
          where: {
            userId: user.id,
            platform: "X",
            externalPostId: { in: tweets.map((t) => t.postId) },
          },
          select: { externalPostId: true },
        });
        const existingSet = new Set(existingRows.map((r) => r.externalPostId));

        // Postgres caps bound parameters per query near 65k. With ~10 columns
        // per upsert branch, 200 posts per transaction stays well inside
        // that limit while collapsing N round-trips into ⌈N/200⌉.
        const BATCH_SIZE = 200;

        for (let start = 0; start < tweets.length; start += BATCH_SIZE) {
          const chunk = tweets.slice(start, start + BATCH_SIZE);

          const upserted = await prisma.$transaction(
            chunk.map((tweet) => {
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
              const postType = detectPostType(tweet.text);
              const updateData: Record<string, unknown> = {
                ...apiMetrics,
                dataSource: "API",
              };
              return prisma.socialPost.upsert({
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
                select: { id: true, externalPostId: true },
              });
            })
          );

          const snapshotOps: ReturnType<typeof prisma.socialPostEngagementSnapshot.upsert>[] = [];
          for (let i = 0; i < chunk.length; i++) {
            const tweet = chunk[i]!;
            const sp = upserted[i]!;

            if (existingSet.has(sp.externalPostId)) updated++;
            else imported++;

            const postAgeDays = (Date.now() - tweet.createdAt.getTime()) / (1000 * 60 * 60 * 24);
            if (postAgeDays < REFRESH_DAYS) {
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
              snapshotOps.push(
                prisma.socialPostEngagementSnapshot.upsert({
                  where: {
                    userId_platform_postId_snapshotDate: {
                      userId: user.id,
                      platform: "X",
                      postId: sp.id,
                      snapshotDate,
                    },
                  },
                  create: {
                    userId: user.id,
                    platform: "X",
                    postId: sp.id,
                    snapshotDate,
                    ...apiMetrics,
                  },
                  update: apiMetrics,
                })
              );
              snapshots++;
            }
          }

          if (snapshotOps.length > 0) {
            await prisma.$transaction(snapshotOps);
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
  const hasBudgetSkips = allResults.some((r) => r.budgetExhausted);
  const status = hasErrors || hasBudgetSkips ? "PARTIAL" : "SUCCESS";
  return {
    status,
    data: { mode: mode ?? "default", results: allResults },
  };
});
