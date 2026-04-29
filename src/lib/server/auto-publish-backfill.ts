import { prisma } from "@/lib/prisma";
import { ScheduledPublishStatus } from "@/generated/prisma";
import { getConnectedPlatforms } from "@/lib/server/platforms";
import { slotToUtcDate } from "@/lib/date-utils";

// 2026-04 cutover bridge. Two paths feed Post + ScheduledPublish:
//
//   1. New content via `addToQueue()` creates Post + ScheduledPublish
//      directly (bridge in src/app/actions/schedule.ts).
//
//   2. Pre-existing ScheduledSlot rows (created before this PR shipped)
//      have no Post counterparts and would be silently dropped from the
//      auto-publish flow when the cron switches to reading
//      ScheduledPublish. This module backfills them.
//
// The cron calls `backfillOrphanScheduledSlots()` once per tick. On a
// stable system (post-cutover, no remaining orphans) the query finds
// nothing and returns 0 with no writes — cheap.

interface OrphanSlot {
  id: string;
  userId: string;
  date: Date;
  timeSlot: string;
  content: string | null;
  conversationId: string | null;
  timezone: string;
}

/**
 * Find every ScheduledSlot whose status is SCHEDULED and which has no
 * corresponding Post yet. Defines "corresponding" loosely — we match
 * on (userId, conversationId, scheduledAt rounded to the minute) since
 * that's how the bridge writes them. Returns the count of newly-created
 * Posts (one per orphan slot, fan-out to N ScheduledPublish per
 * connected platform).
 */
export async function backfillOrphanScheduledSlots(): Promise<number> {
  // Read SCHEDULED slots together with their owner's timezone — we
  // need it to compute the UTC scheduledAt that matches what the
  // bridge would have written.
  const slots = (await prisma.$queryRaw<OrphanSlot[]>`
    SELECT s.id, s."userId", s.date, s."timeSlot", s.content,
           s."conversationId", u.timezone
    FROM "ScheduledSlot" s
    JOIN "User" u ON u.id = s."userId"
    WHERE s.status = 'SCHEDULED'
  `) as OrphanSlot[];

  if (slots.length === 0) return 0;

  let backfilled = 0;
  for (const slot of slots) {
    if (!slot.content || slot.content.trim().length === 0) continue;

    const scheduledAt = slotToUtcDate(slot.date, slot.timeSlot, slot.timezone);

    // Idempotency check: do we already have a Post for this slot's
    // (userId, conversationId, scheduledAt) shape? Match the bridge's
    // semantics — same content body authored from the same conversation
    // at the same UTC moment.
    const existing = await prisma.post.findFirst({
      where: {
        userId: slot.userId,
        conversationId: slot.conversationId,
        content: slot.content,
        scheduledPublishes: {
          some: { scheduledAt },
        },
      },
      select: { id: true },
    });
    if (existing) continue;

    const connected = await getConnectedPlatforms(slot.userId);
    if (connected.platforms.length === 0) {
      // Edge case: scheduled before any platform was connected. Skip —
      // the slot would have been a no-op anyway.
      continue;
    }

    await prisma.$transaction(async (tx) => {
      const post = await tx.post.create({
        data: {
          userId: slot.userId,
          content: slot.content!,
          conversationId: slot.conversationId,
        },
        select: { id: true },
      });
      await tx.scheduledPublish.createMany({
        data: connected.platforms.map((platform) => ({
          userId: slot.userId,
          postId: post.id,
          platform,
          scheduledAt,
          status: ScheduledPublishStatus.PENDING,
        })),
      });
    });
    backfilled++;
  }

  return backfilled;
}
