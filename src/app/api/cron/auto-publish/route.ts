import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/prisma";
import { Prisma, ScheduledPublishStatus } from "@/generated/prisma";
import { withCronLogging } from "@/lib/cron-helpers";
import { getXApiTokenForUser } from "@/lib/server/x-token";
import { getLinkedInApiTokenForUser } from "@/lib/server/linkedin-token";
import { getThreadsApiTokenForUser } from "@/lib/server/threads-token";
import { getPublisher } from "@/lib/platform/publishers";
import { PlatformDisconnectedError, PlatformValidationError } from "@/lib/platform/errors";
import { validatePostForPlatform } from "@/lib/platform/rules";
import { getMediaForConversation } from "@/lib/server/media";
import { backfillOrphanScheduledSlots } from "@/lib/server/auto-publish-backfill";
import type { CredentialsFor } from "@/lib/platform/types";
import type { MediaItem, Platform } from "@/lib/types";

// 2026-04 refactor: auto-publish reads ScheduledPublish (per-platform)
// instead of ScheduledSlot (X-only). Key contract guarantees:
//
//   1. Atomic claim. PENDING → PUBLISHING transition uses FOR UPDATE
//      SKIP LOCKED so two concurrent ticks (Vercel's every-minute
//      schedule + admin Run Now overlap) cannot both grab the same row.
//
//   2. Stale-publishing sweep. If a tick dies mid-publish (network
//      stall, function-timeout, OOM), the row stays in PUBLISHING
//      forever without intervention. Each run flips PUBLISHING > 5min
//      back to PENDING with attemptCount++ so the next claim picks it up.
//
//   3. Retry budget. attemptCount caps at 3 for cron-side retries —
//      beyond that the row stays FAILED until a manual retry resets the
//      counter. Prevents pathological loops on a permanent platform
//      error (token revoked, content forever rejected).
//
//   4. Per-platform isolation. Each ScheduledPublish row processes
//      independently — one row's failure doesn't affect others, even
//      for the same Post. The composed Post.status (PUBLISHED /
//      PARTIAL / FAILED) is computed on read in the UI.
//
//   5. Self-heal bridge. Orphan ScheduledSlot rows (legacy data without
//      a corresponding ScheduledPublish from the bridge in addToQueue)
//      get backfilled at the top of every tick. Idempotent — empties
//      itself once the migration's caught up.

export const maxDuration = 60;

const STALE_PUBLISHING_MS = 5 * 60 * 1000;
const ATTEMPT_CAP = 3;
const CLAIM_BATCH_SIZE = 20;

interface ClaimedRow {
  id: string;
  userId: string;
  postId: string;
  platform: Platform;
  attemptCount: number;
}

export const GET = withCronLogging("auto-publish", async () => {
  // 1. Self-heal: backfill orphan ScheduledSlot → ScheduledPublish.
  //    Idempotent; cheap when there's nothing to backfill.
  try {
    await backfillOrphanScheduledSlots();
  } catch (err) {
    // Non-critical: the rest of the cron still runs. Sentry surfaces
    // recurring failures so we notice if backfill regresses.
    Sentry.captureException(err, {
      tags: { job: "auto-publish", step: "backfill" },
    });
  }

  // 2. Stale PUBLISHING sweep — reset to PENDING with attemptCount++.
  const staleThreshold = new Date(Date.now() - STALE_PUBLISHING_MS);
  const swept = await prisma.scheduledPublish.updateMany({
    where: {
      status: ScheduledPublishStatus.PUBLISHING,
      lastAttemptAt: { lt: staleThreshold },
    },
    data: {
      status: ScheduledPublishStatus.PENDING,
      attemptCount: { increment: 1 },
    },
  });
  if (swept.count > 0) {
    Sentry.captureMessage("auto-publish stale PUBLISHING swept", {
      level: "warning",
      tags: { area: "auto-publish", step: "sweep" },
      extra: { count: swept.count },
    });
  }

  // 3. Atomic claim — PENDING + scheduledAt due + attemptCount under cap.
  //    Raw SQL because Prisma doesn't surface FOR UPDATE SKIP LOCKED.
  //    `FOR UPDATE OF "ScheduledPublish"` would be redundant here; we
  //    only lock the rows we're updating, and skip the ones another
  //    concurrent tick has already grabbed.
  const claimed = await prisma.$queryRaw<ClaimedRow[]>(Prisma.sql`
    UPDATE "ScheduledPublish"
    SET status = 'PUBLISHING', "lastAttemptAt" = NOW(), "updatedAt" = NOW()
    WHERE id IN (
      SELECT id FROM "ScheduledPublish"
      WHERE status = 'PENDING'
        AND "scheduledAt" <= NOW()
        AND "attemptCount" < ${ATTEMPT_CAP}
      ORDER BY "scheduledAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${CLAIM_BATCH_SIZE}
    )
    RETURNING id, "userId", "postId", platform, "attemptCount"
  `);

  if (claimed.length === 0) {
    return {
      status: "SUCCESS",
      data: { published: 0, due: 0, swept: swept.count },
    };
  }

  let published = 0;
  let errors = 0;
  const details: Array<{
    scheduledPublishId: string;
    userId: string;
    platform: Platform;
    status: "PUBLISHED" | "FAILED" | "RETRY";
    error?: string;
  }> = [];

  // 4. Process each claimed row sequentially. We don't Promise.all
  //    across rows because each calls into per-platform OAuth refresh
  //    locks (per-user advisory locks) that would serialize anyway.
  for (const row of claimed) {
    const result = await processOnePublish(row);
    if (result.status === "PUBLISHED") published++;
    else errors++;
    details.push({
      scheduledPublishId: row.id,
      userId: row.userId,
      platform: row.platform,
      status: result.status,
      error: result.error,
    });
  }

  const status = errors > 0 && published > 0 ? "PARTIAL" : errors > 0 ? "FAILURE" : "SUCCESS";

  return {
    status,
    data: {
      published,
      errors,
      due: claimed.length,
      swept: swept.count,
      details,
    },
  };
});

/** Resolve creds for the row's platform via per-platform token helper. */
async function loadCredsForPlatform(
  userId: string,
  platform: Platform
): Promise<CredentialsFor<Platform> | null> {
  if (platform === "X") {
    const c = await getXApiTokenForUser(userId);
    return c ? { platform: "X", ...c } : null;
  }
  if (platform === "LINKEDIN") {
    const c = await getLinkedInApiTokenForUser(userId);
    return c ? { platform: "LINKEDIN", ...c } : null;
  }
  if (platform === "THREADS") {
    const c = await getThreadsApiTokenForUser(userId);
    return c ? { platform: "THREADS", ...c } : null;
  }
  return null;
}

interface ProcessResult {
  status: "PUBLISHED" | "FAILED" | "RETRY";
  error?: string;
}

async function processOnePublish(row: ClaimedRow): Promise<ProcessResult> {
  const post = await prisma.post.findUnique({
    where: { id: row.postId },
    select: { id: true, userId: true, content: true, conversationId: true },
  });
  if (!post) {
    await markFailedTerminal(row.id, "post_not_found");
    return { status: "FAILED", error: "post_not_found" };
  }
  // Defense-in-depth: row.userId is denormalized from Post.userId on
  // creation. If they ever drift (manual SQL, schema bug), the row is
  // orphaned — fail loud rather than publish to the wrong account.
  if (post.userId !== row.userId) {
    Sentry.captureMessage("auto-publish: post.userId / scheduled-publish.userId mismatch", {
      level: "error",
      tags: { area: "auto-publish", scheduledPublishId: row.id },
    });
    await markFailedTerminal(row.id, "userId_mismatch");
    return { status: "FAILED", error: "userId_mismatch" };
  }

  // Load media once per row so per-platform validation can see the
  // media count and the publisher receives the unified MediaItem[]
  // shape. Threads passes URLs through; X / LinkedIn upload binaries
  // inside the publisher (see fetchMediaBuffers).
  let media: MediaItem[] = [];
  if (post.conversationId) {
    try {
      media = await getMediaForConversation(post.conversationId, row.userId);
    } catch (err) {
      return finishWithError(row, err, "media_fetch_failed");
    }
  }

  // Platform-rules pre-flight. Cheap, fails fast before hitting an
  // external API with a doomed payload — character cap AND media count
  // (X=4, LinkedIn=9, Threads=20).
  const validation = validatePostForPlatform(row.platform, {
    content: post.content,
    mediaCount: media.length,
  });
  if (validation) {
    await markFailedTerminal(row.id, validation);
    return { status: "FAILED", error: validation };
  }

  let creds;
  try {
    creds = await loadCredsForPlatform(row.userId, row.platform);
  } catch (err) {
    return finishWithError(row, err, "creds_fetch_failed");
  }
  if (!creds) {
    // No token (revoked / never connected). Terminal — needs reconnect
    // before retry helps. Don't burn the cron's attempt budget.
    await markFailedTerminal(row.id, "platform_disconnected");
    return { status: "FAILED", error: "platform_disconnected" };
  }

  try {
    const publisher = getPublisher(row.platform);
    const result = await publisher.publish({
      creds: creds as CredentialsFor<Platform>,
      content: post.content,
      media: media.length > 0 ? media : undefined,
      callerJob: "auto-publish",
      userId: row.userId,
    });
    await prisma.scheduledPublish.update({
      where: { id: row.id },
      data: {
        status: ScheduledPublishStatus.PUBLISHED,
        publishedAt: new Date(),
        externalPostId: result.externalPostId,
        externalUrl: result.externalUrl,
        lastError: null,
      },
    });
    return { status: "PUBLISHED" };
  } catch (err) {
    if (err instanceof PlatformDisconnectedError) {
      // Token-level failure — mark FAILED terminal (no auto-retry; user
      // must reconnect). Sentry warning so ops sees aggregate trends.
      Sentry.captureException(err, {
        level: "warning",
        tags: {
          job: "auto-publish",
          platform: row.platform,
          userId: row.userId,
          kind: "platform_disconnected",
        },
      });
      await markFailedTerminal(row.id, err.message);
      return { status: "FAILED", error: err.message };
    }
    if (err instanceof PlatformValidationError) {
      await markFailedTerminal(row.id, err.reason);
      return { status: "FAILED", error: err.reason };
    }
    return finishWithError(row, err, "publish_failed");
  }
}

/** Mark FAILED with the cap exhausted so retries stop until manual intervention. */
async function markFailedTerminal(scheduledPublishId: string, reason: string): Promise<void> {
  await prisma.scheduledPublish.update({
    where: { id: scheduledPublishId },
    data: {
      status: ScheduledPublishStatus.FAILED,
      attemptCount: ATTEMPT_CAP,
      lastError: reason.slice(0, 500),
    },
  });
}

/**
 * Generic error path — increment attemptCount and decide between
 * RETRY (back to PENDING) or FAILED (cap reached).
 */
async function finishWithError(
  row: ClaimedRow,
  err: unknown,
  prefix: string
): Promise<ProcessResult> {
  const msg = err instanceof Error ? err.message : String(err);
  Sentry.captureException(err, {
    tags: {
      job: "auto-publish",
      platform: row.platform,
      userId: row.userId,
      kind: prefix,
    },
  });
  const nextAttempt = row.attemptCount + 1;
  if (nextAttempt >= ATTEMPT_CAP) {
    await prisma.scheduledPublish.update({
      where: { id: row.id },
      data: {
        status: ScheduledPublishStatus.FAILED,
        attemptCount: nextAttempt,
        lastError: `${prefix}: ${msg}`.slice(0, 500),
      },
    });
    return { status: "FAILED", error: msg };
  }
  await prisma.scheduledPublish.update({
    where: { id: row.id },
    data: {
      status: ScheduledPublishStatus.PENDING,
      attemptCount: nextAttempt,
      lastError: `${prefix}: ${msg}`.slice(0, 500),
    },
  });
  return { status: "RETRY", error: msg };
}
