import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { getXApiTokenForUserInternal } from "@/app/actions/x-token";
import { postTweet, uploadMediaToX } from "@/lib/x-api";
import { getMediaForConversationInternal } from "@/app/actions/media";
import { slotToUtcDate } from "@/lib/date-utils";
import type { CronJobStatus, Prisma } from "@/generated/prisma";

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  // Auth: Bearer token
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();

  // Fetch all SCHEDULED slots with their user's timezone
  const slots = await prisma.scheduledSlot.findMany({
    where: { status: "SCHEDULED" },
    include: { user: { select: { id: true, timezone: true } } },
  });

  // Filter to slots whose scheduled time has passed
  const dueSlots = slots.filter((s) => slotToUtcDate(s.date, s.timeSlot, s.user.timezone) <= now);

  // Nothing to do — return immediately, no logging
  if (dueSlots.length === 0) {
    return NextResponse.json({ ok: true, published: 0 });
  }

  // There's work to do — log this run
  const startedAt = Date.now();
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

    // --- Post to X ---
    try {
      const credentials = await getXApiTokenForUserInternal(user.id);
      if (!credentials) {
        details.push({ slotId: slot.id, userId: user.id, error: "No X credentials" });
        errors++;
        continue;
      }

      // Upload media if conversation has images
      let mediaIds: string[] | undefined;
      if (slot.conversationId) {
        const media = await getMediaForConversationInternal(slot.conversationId, user.id);
        if (media.length > 0) {
          mediaIds = [];
          for (const item of media) {
            const imageRes = await fetch(item.url);
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

      // Mark as POSTED
      const postedAt = new Date();
      await prisma.scheduledSlot.update({
        where: { id: slot.id },
        data: { status: "POSTED", postedAt },
      });

      if (slot.conversationId) {
        await prisma.conversation.update({
          where: { id: slot.conversationId },
          data: { status: "POSTED" },
        });
      }

      published++;
      details.push({ slotId: slot.id, userId: user.id, platform: "X" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      details.push({ slotId: slot.id, userId: user.id, error: msg });
      errors++;
      Sentry.captureException(err);
    }
  }

  const status: CronJobStatus =
    errors > 0 && published > 0 ? "PARTIAL" : errors > 0 ? "FAILURE" : "SUCCESS";

  // Log only runs that had actual work
  after(async () => {
    try {
      await prisma.cronJobRun.create({
        data: {
          jobName: "auto-publish",
          status,
          durationMs: Date.now() - startedAt,
          resultJson: { published, errors, due: dueSlots.length, details } as Prisma.InputJsonValue,
          startedAt: new Date(startedAt),
        },
      });
    } catch (logErr) {
      Sentry.captureException(logErr);
    }
  });

  return NextResponse.json({ ok: status !== "FAILURE", status, published, errors });
}
