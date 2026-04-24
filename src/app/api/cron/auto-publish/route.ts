import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/prisma";
import { withCronLogging } from "@/lib/cron-helpers";
import { getXApiTokenForUser } from "@/lib/server/x-token";
import { postTweet, uploadMediaToX } from "@/lib/x-api";
import { getMediaForConversation } from "@/lib/server/media";
import { slotToUtcDate } from "@/lib/date-utils";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";

export const maxDuration = 60;

export const GET = withCronLogging("auto-publish", async () => {
  const now = new Date();

  const slots = await prisma.scheduledSlot.findMany({
    where: { status: "SCHEDULED" },
    include: { user: { select: { id: true, timezone: true } } },
  });

  const dueSlots = slots.filter((s) => slotToUtcDate(s.date, s.timeSlot, s.user.timezone) <= now);

  if (dueSlots.length === 0) {
    return { status: "SUCCESS", data: { published: 0, due: 0 } };
  }

  let published = 0;
  let errors = 0;
  const details: { slotId: string; userId: string; platform?: string; error?: string }[] = [];

  for (const slot of dueSlots) {
    const { user } = slot;

    if (!slot.content?.trim()) {
      details.push({ slotId: slot.id, userId: user.id, error: "Empty content" });
      errors++;
      continue;
    }

    try {
      const credentials = await getXApiTokenForUser(user.id);
      if (!credentials) {
        details.push({ slotId: slot.id, userId: user.id, error: "No X credentials" });
        errors++;
        continue;
      }

      let mediaIds: string[] | undefined;
      if (slot.conversationId) {
        const media = await getMediaForConversation(slot.conversationId, user.id);
        if (media.length > 0) {
          // X requires every referenced media to succeed — a tweet with
          // partial media would be misleading — so any fetch failure
          // aborts the whole slot. Parallelise the downloads (≤4 per
          // slot) and cap each one with an explicit 15s timeout so one
          // stuck upstream can't eat the 60s function budget.
          const MEDIA_FETCH_TIMEOUT_MS = 15_000;
          const buffers = await Promise.allSettled(
            media.map(async (item) => {
              const imageRes = await fetchWithTimeout(item.url, {
                timeoutMs: MEDIA_FETCH_TIMEOUT_MS,
              });
              if (!imageRes.ok) {
                throw new Error(
                  `Media fetch failed (${imageRes.status} ${imageRes.statusText}) for ${item.url}`
                );
              }
              const buf = Buffer.from(await imageRes.arrayBuffer());
              return { item, buf };
            })
          );

          const failures = buffers
            .map((r, i) => ({ r, i, item: media[i]! }))
            .filter((x) => x.r.status === "rejected");
          if (failures.length > 0) {
            for (const f of failures) {
              const reason = (f.r as PromiseRejectedResult).reason;
              Sentry.captureException(reason, {
                tags: {
                  area: "auto-publish-media",
                  slotId: slot.id,
                  mediaId: f.item.id,
                  userId: user.id,
                },
                extra: { url: f.item.url },
              });
            }
            throw new Error(
              `Media fetch failed for ${failures.length}/${media.length} item(s); aborting slot`
            );
          }

          // Uploads must be sequential-ordered because we concatenate
          // the returned media IDs in the same order as `media`, and
          // X's tweet media array is position-sensitive.
          mediaIds = [];
          for (const res of buffers) {
            // All fulfilled by the check above.
            const { item, buf } = (
              res as PromiseFulfilledResult<{ item: (typeof media)[number]; buf: Buffer }>
            ).value;
            const xMediaId = await uploadMediaToX(credentials, buf, item.mimeType, {
              callerJob: "auto-publish",
              userId: user.id,
            });
            mediaIds.push(xMediaId);
          }
        }
      }

      await postTweet(credentials, slot.content, {
        callerJob: "auto-publish",
        userId: user.id,
        mediaIds,
      });

      const postedAt = new Date();
      await prisma.scheduledSlot.update({
        where: { id: slot.id },
        data: { status: "POSTED", postedAt },
      });

      if (slot.conversationId) {
        await prisma.conversation.updateMany({
          where: { id: slot.conversationId, userId: user.id },
          data: { status: "POSTED" },
        });
      }

      published++;
      details.push({ slotId: slot.id, userId: user.id, platform: "X" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      details.push({ slotId: slot.id, userId: user.id, error: msg });
      errors++;
      Sentry.captureException(err, { tags: { job: "auto-publish", userId: user.id } });
    }
  }

  const status = errors > 0 && published > 0 ? "PARTIAL" : errors > 0 ? "FAILURE" : "SUCCESS";

  return {
    status,
    data: { published, errors, due: dueSlots.length, details },
  };
});
