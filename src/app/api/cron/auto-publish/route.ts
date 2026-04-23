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
          mediaIds = [];
          for (const item of media) {
            // Media lives in our own storage (Supabase); 30s default is
            // generous enough for any image we let users upload.
            const imageRes = await fetchWithTimeout(item.url);
            const imageBuffer = Buffer.from(await imageRes.arrayBuffer());
            const xMediaId = await uploadMediaToX(credentials, imageBuffer, item.mimeType, {
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
