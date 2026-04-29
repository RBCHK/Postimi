import * as Sentry from "@sentry/nextjs";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { withCronLogging } from "@/lib/cron-helpers";
import { listImportablePlatforms } from "@/lib/platform/registry";
import { parsePlatformMetadata } from "@/lib/platform/types";
import { ThreadsScopeError } from "@/lib/threads-api";
import { excludeSystemUser } from "@/lib/server/system-user";
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
  const users = await prisma.user.findMany({
    where: excludeSystemUser(),
    select: { id: true },
  });
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
        const creds = await entry.token.getForUser(user.id);
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

  // Buffer the stream so we can batch DB writes in one transaction per
  // chunk rather than issuing 3 round-trips per post (findUnique + upsert +
  // snapshot upsert). See `BATCH_SIZE` below for chunking rationale.
  const buffered: Array<{
    externalPostId: string;
    postedAt: Date;
    text: string;
    postUrl: string | null;
    metadata: ReturnType<typeof parsePlatformMetadata>;
    postType: string;
    metrics: {
      impressions: number;
      likes: number;
      replies: number;
      reposts: number;
      shares: number;
      bookmarks: number;
      views: number;
    };
  }> = [];

  for await (const post of importer.fetchPosts(creds, { since })) {
    // Validate Zod shape before writing — catches regressions in the
    // importer rather than letting malformed JSON land in the DB.
    const metadata = parsePlatformMetadata(post.metadata);
    buffered.push({
      externalPostId: post.externalPostId,
      postedAt: post.postedAt,
      text: post.text,
      postUrl: post.postUrl,
      metadata,
      postType: derivePostType(metadata),
      metrics: {
        impressions: post.metrics.impressions,
        likes: post.metrics.likes,
        replies: post.metrics.replies,
        reposts: post.metrics.reposts,
        shares: post.metrics.shares,
        bookmarks: post.metrics.bookmarks,
        views: post.metrics.impressions, // Threads exposes views as the headline metric
      },
    });
  }

  let imported = 0;
  let updated = 0;
  let snapshots = 0;

  if (buffered.length === 0) {
    // Skip the rest of the DB work for the post stream; followers still runs.
  } else {
    // One findMany replaces N findUnique calls to detect
    // imported-vs-updated without a round-trip per post.
    const existingRows = await prisma.socialPost.findMany({
      where: {
        userId,
        platform,
        externalPostId: { in: buffered.map((p) => p.externalPostId) },
      },
      select: { externalPostId: true },
    });
    const existingSet = new Set(existingRows.map((r) => r.externalPostId));

    // Postgres caps bound parameters per query at ~65k. With ~10 columns per
    // upsert create + update branch, 200 rows per transaction is well inside
    // that limit and short enough to not block other writers.
    const BATCH_SIZE = 200;

    for (let start = 0; start < buffered.length; start += BATCH_SIZE) {
      const chunk = buffered.slice(start, start + BATCH_SIZE);

      // One transaction = one round-trip. Each upsert still runs as a
      // separate statement inside Postgres, but we pay the network cost
      // once per chunk instead of once per post.
      const upserted = await prisma.$transaction(
        chunk.map((p) =>
          prisma.socialPost.upsert({
            where: {
              userId_platform_externalPostId: {
                userId,
                platform,
                externalPostId: p.externalPostId,
              },
            },
            create: {
              userId,
              platform,
              externalPostId: p.externalPostId,
              postedAt: p.postedAt,
              text: p.text,
              postUrl: p.postUrl,
              postType: p.postType,
              platformMetadata: p.metadata,
              ...p.metrics,
              dataSource: "API",
            },
            update: {
              ...p.metrics,
              platformMetadata: p.metadata,
              dataSource: "API",
            },
            select: { id: true, externalPostId: true },
          })
        )
      );

      // Upsert results arrive in the same order as the input array, so we
      // can pair them back to the buffered posts without a second lookup.
      const snapshotOps: ReturnType<typeof prisma.socialPostEngagementSnapshot.upsert>[] = [];
      for (let i = 0; i < chunk.length; i++) {
        const p = chunk[i]!;
        const sp = upserted[i]!;

        if (existingSet.has(sp.externalPostId)) updated++;
        else imported++;

        const ageDays = (Date.now() - p.postedAt.getTime()) / (1000 * 60 * 60 * 24);
        if (ageDays < REFRESH_DAYS) {
          snapshotOps.push(
            prisma.socialPostEngagementSnapshot.upsert({
              where: {
                userId_platform_postId_snapshotDate: {
                  userId,
                  platform,
                  postId: sp.id,
                  snapshotDate,
                },
              },
              create: {
                userId,
                platform,
                postId: sp.id,
                snapshotDate,
                ...p.metrics,
              },
              update: p.metrics,
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
