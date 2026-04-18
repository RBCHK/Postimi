import * as Sentry from "@sentry/nextjs";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { withCronLogging } from "@/lib/cron-helpers";
import { listImportablePlatforms } from "@/lib/platform/registry";
import { parsePlatformMetadata } from "@/lib/platform/types";
import { ThreadsScopeError } from "@/lib/threads-api";
import type { Platform } from "@/lib/types";

// ADR-008 Phase 2 / Phase 1b (in progress).
//
// Unified importer cron. Iterates every platform that registered a
// `PlatformImporter` in the registry. Today that's Threads; Phase 1b
// folds X into the same loop and retires the legacy `x-import` route.
//
// Why sequential, not Promise.all:
//   - AiQuota reservations use row-level locks; parallel writes across
//     platforms would serialize at the DB anyway.
//   - Per-user Prisma backpressure is easier to reason about.
//   - Vercel cron budget is generous enough for ~3 users × 3 platforms.
//
// Why per-platform try/catch (not per-user):
//   - A Threads 500 must not wipe an X success inside the same user's run.
//   - Each catch writes to Sentry with `{ platform, userId }` tags so
//     ops can filter platform-wide incidents from per-user anomalies.

// Side-effect import: populates the registry.
import "@/lib/platform/init";

export const maxDuration = 60;

const REFRESH_DAYS = 7;

export const GET = withCronLogging("social-import", async () => {
  const users = await prisma.user.findMany({ select: { id: true } });
  const platforms = listImportablePlatforms();

  const results: Array<{
    userId: string;
    platform: Platform;
    imported?: number;
    updated?: number;
    snapshots?: number;
    followersDelta?: number;
    skipped?: boolean;
    skipReason?: string;
    error?: string;
  }> = [];

  for (const user of users) {
    for (const entry of platforms) {
      const platform = entry.token.platform;
      try {
        const creds = await entry.token.getForUserInternal(user.id);
        if (!creds) {
          results.push({ userId: user.id, platform, skipped: true, skipReason: "not_connected" });
          continue;
        }

        const platformResult = await importForUser({
          userId: user.id,
          platform,
          creds,
          importer: entry.importer!,
        });
        results.push({ userId: user.id, platform, ...platformResult });
      } catch (err) {
        if (err instanceof ThreadsScopeError) {
          // Strip the missing scope from the DB so the UI can surface a
          // reconnect banner and we stop retrying insight calls.
          await prisma.threadsApiToken
            .update({
              where: { userId: user.id },
              data: {
                grantedScopes: {
                  set: [] as string[],
                },
              },
            })
            .catch((dbErr) => {
              Sentry.captureException(dbErr, {
                tags: { job: "social-import", platform, userId: user.id },
                extra: { hint: "failed to strip grantedScopes after ThreadsScopeError" },
              });
            });
          Sentry.captureException(err, {
            level: "warning",
            tags: { job: "social-import", platform, userId: user.id, kind: "scope-denied" },
          });
          results.push({
            userId: user.id,
            platform,
            skipped: true,
            skipReason: "scope_denied",
          });
          continue;
        }

        Sentry.captureException(err, {
          tags: { job: "social-import", platform, userId: user.id },
        });
        console.error(`[social-import] user=${user.id} platform=${platform}`, err);
        results.push({
          userId: user.id,
          platform,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  revalidatePath("/analytics");
  const hasErrors = results.some((r) => r.error);
  return {
    status: hasErrors ? "PARTIAL" : "SUCCESS",
    data: { results },
  };
});

type ImporterEntry = NonNullable<ReturnType<typeof listImportablePlatforms>[number]["importer"]>;

async function importForUser(args: {
  userId: string;
  platform: Platform;
  creds: Parameters<ImporterEntry["fetchPosts"]>[0];
  importer: ImporterEntry;
}): Promise<{
  imported: number;
  updated: number;
  snapshots: number;
  followersDelta: number;
}> {
  const { userId, platform, creds, importer } = args;

  const snapshotDate = new Date();
  snapshotDate.setUTCHours(0, 0, 0, 0);

  // Incremental: only pull posts newer than our most recent row.
  const latest = await prisma.socialPost.findFirst({
    where: { userId, platform },
    orderBy: { postedAt: "desc" },
    select: { postedAt: true },
  });
  const since = latest
    ? new Date(latest.postedAt.getTime() - 24 * 60 * 60 * 1000) // 1d overlap for insight refresh
    : undefined;

  let imported = 0;
  let updated = 0;
  let snapshots = 0;

  for await (const post of importer.fetchPosts(creds, { since })) {
    // Validate Zod shape before writing — catches regressions in the
    // importer rather than letting malformed JSON land in the DB.
    const metadata = parsePlatformMetadata(post.metadata);

    const existing = await prisma.socialPost.findUnique({
      where: {
        userId_platform_externalPostId: {
          userId,
          platform,
          externalPostId: post.externalPostId,
        },
      },
      select: { id: true },
    });

    // Detect post type from metadata for write.
    const postType = derivePostType(metadata);

    const metrics = {
      impressions: post.metrics.impressions,
      likes: post.metrics.likes,
      replies: post.metrics.replies,
      reposts: post.metrics.reposts,
      shares: post.metrics.shares,
      bookmarks: post.metrics.bookmarks,
      views: post.metrics.impressions, // Threads exposes views as the headline metric
    };

    const socialPost = await prisma.socialPost.upsert({
      where: {
        userId_platform_externalPostId: {
          userId,
          platform,
          externalPostId: post.externalPostId,
        },
      },
      create: {
        userId,
        platform,
        externalPostId: post.externalPostId,
        postedAt: post.postedAt,
        text: post.text,
        postUrl: post.postUrl,
        postType,
        platformMetadata: metadata,
        ...metrics,
        dataSource: "API",
      },
      update: {
        ...metrics,
        platformMetadata: metadata,
        dataSource: "API",
      },
      select: { id: true },
    });

    if (existing) updated++;
    else imported++;

    const ageDays = (Date.now() - post.postedAt.getTime()) / (1000 * 60 * 60 * 24);
    if (ageDays < REFRESH_DAYS) {
      await prisma.socialPostEngagementSnapshot.upsert({
        where: {
          userId_platform_postId_snapshotDate: {
            userId,
            platform,
            postId: socialPost.id,
            snapshotDate,
          },
        },
        create: {
          userId,
          platform,
          postId: socialPost.id,
          snapshotDate,
          ...metrics,
        },
        update: metrics,
      });
      snapshots++;
    }
  }

  // Followers snapshot. Compute deltas from the previous snapshot for the
  // same user+platform so analytics charts can show day-over-day growth
  // without re-scanning every row.
  const followers = await importer.fetchFollowers(creds);
  const previous = await prisma.socialFollowersSnapshot.findFirst({
    where: { userId, platform, date: { lt: followers.date } },
    orderBy: { date: "desc" },
    select: { followersCount: true, followingCount: true },
  });
  const deltaFollowers = previous ? followers.followersCount - previous.followersCount : 0;
  const deltaFollowing =
    previous && previous.followingCount !== null && followers.followingCount !== null
      ? followers.followingCount - previous.followingCount
      : 0;

  await prisma.socialFollowersSnapshot.upsert({
    where: {
      userId_platform_date: {
        userId,
        platform,
        date: followers.date,
      },
    },
    create: {
      userId,
      platform,
      date: followers.date,
      followersCount: followers.followersCount,
      followingCount: followers.followingCount,
      deltaFollowers,
      deltaFollowing,
    },
    update: {
      followersCount: followers.followersCount,
      followingCount: followers.followingCount,
      deltaFollowers,
      deltaFollowing,
    },
  });

  return { imported, updated, snapshots, followersDelta: deltaFollowers };
}

/**
 * Coerce the validated `PlatformMetadata` into the free-form `postType`
 * string stored on `SocialPost`. The enum union on metadata is richer
 * than `postType` allows, so we collapse it to the shared analytics
 * categories (POST / REPLY / QUOTE / REPOST / ARTICLE).
 */
function derivePostType(metadata: ReturnType<typeof parsePlatformMetadata>): string {
  if (metadata.platform === "X") return metadata.postType;
  if (metadata.platform === "LINKEDIN") return metadata.postType ?? "POST";
  // THREADS: a replyToId means reply; a REPOST_FACADE means repost; else post.
  if (metadata.replyToId) return "REPLY";
  if (metadata.mediaType === "REPOST_FACADE") return "REPOST";
  return "POST";
}
