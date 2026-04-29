import { prisma } from "@/lib/prisma";
import { ScheduledPublishStatus } from "@/generated/prisma";
import { validatePostForPlatform } from "@/lib/platform/rules";
import type { Platform } from "@/lib/types";

// 2026-04 refactor: Post + ScheduledPublish replaces ScheduledSlot for
// multi-platform publishing. ScheduledSlot stays in the schema for one
// release but is treated as legacy from this PR forward — new content
// flows through here.
//
// Hard cap on content length defends against DoS via direct Server-
// Action calls bypassing the composer's validation. 10_000 is well
// above any platform's textLimit so legitimate long-form content
// (LinkedIn 3,000) passes; 100MB-of-text payloads hit the cap and
// fail before reaching the publish path.
const MAX_CONTENT_LENGTH = 10_000;

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

export interface PostScheduleSpec {
  platform: Platform;
  scheduledAt: Date;
}

export interface CreatePostWithSchedulesArgs {
  content: string;
  conversationId?: string | null;
  schedules: PostScheduleSpec[];
}

/**
 * Create a Post + N ScheduledPublish rows in one transaction. Each
 * schedule is validated against the platform's static rules before
 * insertion — a content-too-long check fails the whole transaction
 * (atomic: no orphan Post without schedules).
 */
export async function createPostWithSchedules(
  userId: string,
  args: CreatePostWithSchedulesArgs
): Promise<{ postId: string }> {
  if (args.content.length === 0) {
    throw new Error("Post content cannot be empty");
  }
  if (args.content.length > MAX_CONTENT_LENGTH) {
    throw new Error(
      `Post content exceeds hard cap (${MAX_CONTENT_LENGTH} chars; got ${args.content.length})`
    );
  }
  if (args.schedules.length === 0) {
    throw new Error("At least one schedule is required");
  }

  const now = Date.now();
  const oneYear = now + ONE_YEAR_MS;
  for (const s of args.schedules) {
    if (s.scheduledAt.getTime() > oneYear) {
      throw new Error(
        `scheduledAt for ${s.platform} is more than 1 year out — refuse to keep retryable rows that long`
      );
    }
    // Past scheduledAt is allowed: the cron will pick it up immediately.
    // This makes "publish now" a special case of scheduling at the
    // current time (or a few seconds in the past).
    const reason = validatePostForPlatform(s.platform, { content: args.content });
    if (reason) {
      throw new Error(reason);
    }
  }

  const post = await prisma.$transaction(async (tx) => {
    const created = await tx.post.create({
      data: {
        userId,
        content: args.content,
        conversationId: args.conversationId ?? null,
      },
      select: { id: true },
    });
    await tx.scheduledPublish.createMany({
      data: args.schedules.map((s) => ({
        userId,
        postId: created.id,
        platform: s.platform,
        scheduledAt: s.scheduledAt,
        status: ScheduledPublishStatus.PENDING,
      })),
    });
    return created;
  });

  return { postId: post.id };
}

/**
 * Reset a FAILED ScheduledPublish back to PENDING for manual retry.
 * Increments manualRetryCount + zeroes attemptCount so the cron's
 * cap-of-3 budget reset, lets the user trigger another batch of
 * automatic retries.
 *
 * Owner-checked: scoped by userId AND status. updateMany returns
 * `count` so the action layer can detect cross-user attempts (count = 0)
 * without leaking which row exists.
 */
export async function retryScheduledPublish(
  userId: string,
  scheduledPublishId: string
): Promise<{ ok: boolean; reason?: string }> {
  const result = await prisma.scheduledPublish.updateMany({
    where: {
      id: scheduledPublishId,
      userId,
      status: ScheduledPublishStatus.FAILED,
    },
    data: {
      status: ScheduledPublishStatus.PENDING,
      attemptCount: 0,
      manualRetryCount: { increment: 1 },
      lastError: null,
    },
  });
  if (result.count === 0) {
    return { ok: false, reason: "not_found_or_not_failed" };
  }
  return { ok: true };
}
