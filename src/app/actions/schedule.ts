"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUserId, requireUser } from "@/lib/auth";
import type { GoalChartData, GoalTrackingData, SlotStatus, SlotType } from "@/lib/types";
import { SlotType as PrismaSlotType } from "@/generated/prisma";
import {
  calendarDateStr,
  slotToUtcDate,
  time24to12,
  isSlotFuture,
  addUTCDays,
  nowInTimezone,
} from "@/lib/date-utils";

const slotStatusFromPrisma = (v: string): SlotStatus => v.toLowerCase() as SlotStatus;

const slotTypeFromPrisma = (v: PrismaSlotType): SlotType => {
  const map: Record<PrismaSlotType, SlotType> = {
    REPLY: "Reply",
    POST: "Post",
    THREAD: "Thread",
    ARTICLE: "Article",
    QUOTE: "Quote",
  };
  return map[v];
};

// ─── Schedule types ───────────────────────────────────────

export type DayKey = "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";

export type SlotRow = {
  id: string;
  time: string; // "HH:MM" 24h
  days: Record<DayKey, boolean>;
};

export type ContentSchedule = { slots: SlotRow[] };

export type ScheduleConfig = {
  replies: ContentSchedule;
  posts: ContentSchedule;
  threads: ContentSchedule;
  articles: ContentSchedule;
  quotes: ContentSchedule;
};

// ─── Lookup tables ────────────────────────────────────────

const JS_TO_DAY: Record<number, DayKey> = {
  0: "Sun",
  1: "Mon",
  2: "Tue",
  3: "Wed",
  4: "Thu",
  5: "Fri",
  6: "Sat",
};

const SECTION_TO_SLOT_TYPE: Record<keyof ScheduleConfig, PrismaSlotType> = {
  replies: "REPLY",
  posts: "POST",
  threads: "THREAD",
  quotes: "QUOTE",
  articles: "ARTICLE",
};

const SLOT_TYPE_TO_SECTION: Record<PrismaSlotType, keyof ScheduleConfig> = {
  REPLY: "replies",
  POST: "posts",
  THREAD: "threads",
  QUOTE: "quotes",
  ARTICLE: "articles",
};

// ─── Config helpers ───────────────────────────────────────

/** Internal: get schedule config for a known userId (no auth call) */
async function getScheduleConfigInternal(userId: string): Promise<ScheduleConfig | null> {
  const row = await prisma.strategyConfig.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
  if (!row || !row.scheduleConfig) return null;
  return row.scheduleConfig as ScheduleConfig;
}

export { getScheduleConfigInternal };

export async function getScheduleConfig(): Promise<ScheduleConfig | null> {
  const userId = await requireUserId();
  return getScheduleConfigInternal(userId);
}

export async function saveScheduleConfig(data: ScheduleConfig): Promise<void> {
  const userId = await requireUserId();
  const existing = await prisma.strategyConfig.findFirst({ where: { userId } });
  const payload = { scheduleConfig: data as object };
  if (existing) {
    await prisma.strategyConfig.update({ where: { id: existing.id }, data: payload });
  } else {
    await prisma.strategyConfig.create({ data: { scheduleConfig: data as object, userId } });
  }
  revalidatePath("/");
}

// ─── Virtual slot computation ─────────────────────────────

type SlotItem = {
  id: string;
  date: Date;
  timeSlot: string;
  slotType: SlotType;
  status: SlotStatus;
  content?: string;
  draftId?: string;
  draftTitle?: string;
  platforms?: ("X" | "LINKEDIN" | "THREADS")[];
  postedAt?: Date;
};

/**
 * Computes virtual EMPTY slots from ScheduleConfig for a date range.
 * Slots already occupied (in occupiedKeys) are skipped.
 * occupiedKeys format: "${dateStr}_${timeSlot}_${prismaSlotType}"
 */
function computeVirtualSlots(
  config: ScheduleConfig,
  userId: string,
  fromDate: Date,
  days: number,
  timezone: string,
  occupiedKeys: Set<string>
): SlotItem[] {
  const result: SlotItem[] = [];

  for (let d = 0; d < days; d++) {
    const date = addUTCDays(fromDate, d);
    const dateStr = calendarDateStr(date);
    const dayKey = JS_TO_DAY[date.getUTCDay()];

    for (const [section, schedule] of Object.entries(config) as [
      keyof ScheduleConfig,
      ContentSchedule,
    ][]) {
      const prismaSlotType = SECTION_TO_SLOT_TYPE[section];

      for (const slotRow of schedule.slots) {
        if (!slotRow.time || !slotRow.days[dayKey]) continue;

        const timeSlot = time24to12(slotRow.time);

        // Always show today's slots (d === 0); skip past slots on future days
        if (d > 0 && !isSlotFuture(date, timeSlot, timezone)) continue;

        const conflictKey = `${dateStr}_${timeSlot}_${prismaSlotType}`;
        if (occupiedKeys.has(conflictKey)) continue;
        occupiedKeys.add(conflictKey); // prevent duplicate rows at same time

        result.push({
          id: `virtual_${userId}_${dateStr}_${slotRow.time}_${prismaSlotType}`,
          date,
          timeSlot,
          slotType: slotTypeFromPrisma(prismaSlotType),
          status: "empty",
        });
      }
    }
  }

  return result;
}

// ─── Public actions ───────────────────────────────────────

/**
 * Returns scheduled slots (SCHEDULED + POSTED from DB) merged with virtual EMPTY slots
 * computed from ScheduleConfig. Default: 14 days from today in the user's timezone.
 */
export async function getScheduledSlots(options?: { from?: string; days?: number }) {
  const { id: userId, timezone } = await requireUser();

  const days = options?.days ?? 14;
  const fromDateStr = options?.from ?? nowInTimezone(timezone).dateStr;
  const fromDate = new Date(`${fromDateStr}T00:00:00.000Z`);
  const toDate = addUTCDays(fromDate, days);

  // Fetch only real (SCHEDULED + POSTED) rows
  const rows = await prisma.scheduledSlot.findMany({
    where: {
      userId,
      status: { in: ["SCHEDULED", "POSTED"] },
      date: { gte: fromDate, lt: toDate },
    },
    include: { conversation: true },
  });

  const realSlots: SlotItem[] = rows.map((r) => {
    const cc = r.conversation?.composerContent as {
      linked?: boolean;
      shared?: string;
      x?: string;
      linkedin?: string;
      threads?: string;
    } | null;
    const platforms: string[] = [];
    if (cc) {
      if (cc.linked) {
        if (cc.shared?.trim()) platforms.push("X", "LINKEDIN", "THREADS");
      } else {
        if (cc.x?.trim()) platforms.push("X");
        if (cc.linkedin?.trim()) platforms.push("LINKEDIN");
        if (cc.threads?.trim()) platforms.push("THREADS");
      }
    }
    return {
      id: r.id,
      date: r.date,
      timeSlot: r.timeSlot,
      slotType: slotTypeFromPrisma(r.slotType),
      status: slotStatusFromPrisma(r.status),
      content: r.content ?? undefined,
      draftId: r.conversationId ?? undefined,
      draftTitle: r.conversation?.title ?? undefined,
      platforms: platforms.length > 0 ? (platforms as SlotItem["platforms"]) : undefined,
      postedAt: r.postedAt ?? undefined,
    };
  });

  // Build conflict set so virtual slots don't overlap real ones
  const occupiedKeys = new Set(
    rows.map((r) => `${calendarDateStr(r.date)}_${r.timeSlot}_${r.slotType}`)
  );

  const config = await getScheduleConfigInternal(userId);
  const virtualSlots = config
    ? computeVirtualSlots(config, userId, fromDate, days, timezone, occupiedKeys)
    : [];

  return [...realSlots, ...virtualSlots].sort(
    (a, b) =>
      slotToUtcDate(a.date, a.timeSlot, timezone).getTime() -
      slotToUtcDate(b.date, b.timeSlot, timezone).getTime()
  );
}

/** Returns true if the user has at least one future available slot of the given type */
export async function hasEmptySlots(slotType: PrismaSlotType): Promise<boolean> {
  const { id: userId, timezone } = await requireUser();
  const config = await getScheduleConfigInternal(userId);
  if (!config) return false;

  const schedule = config[SLOT_TYPE_TO_SECTION[slotType]];
  if (!schedule?.slots?.length) return false;

  const { dateStr: localDateStr } = nowInTimezone(timezone);
  const todayUTC = new Date(`${localDateStr}T00:00:00.000Z`);
  const CHECK_DAYS = 14;
  const toDate = addUTCDays(todayUTC, CHECK_DAYS);

  const occupied = await prisma.scheduledSlot.findMany({
    where: { userId, status: "SCHEDULED", slotType, date: { gte: todayUTC, lt: toDate } },
    select: { date: true, timeSlot: true },
  });
  const occupiedKeys = new Set(occupied.map((s) => `${calendarDateStr(s.date)}_${s.timeSlot}`));

  for (let d = 0; d < CHECK_DAYS; d++) {
    const date = addUTCDays(todayUTC, d);
    const dayKey = JS_TO_DAY[date.getUTCDay()];
    for (const slotRow of schedule.slots) {
      if (!slotRow.time || !slotRow.days[dayKey]) continue;
      const timeSlot = time24to12(slotRow.time);
      if (d > 0 && !isSlotFuture(date, timeSlot, timezone)) continue;
      if (!occupiedKeys.has(`${calendarDateStr(date)}_${timeSlot}`)) return true;
    }
  }
  return false;
}

export async function toggleSlotPosted(
  id: string
): Promise<{ postedAt?: Date; status: "POSTED" | "SCHEDULED" | "EMPTY" }> {
  const userId = await requireUserId();
  const slot = await prisma.scheduledSlot.findFirst({ where: { id, userId } });
  if (!slot) throw new Error("Slot not found");

  if (slot.status === "POSTED") {
    if (slot.conversationId) {
      // Revert to SCHEDULED — slot has content, keep the row
      await prisma.scheduledSlot.update({
        where: { id },
        data: { status: "SCHEDULED", postedAt: null },
      });
      await prisma.conversation.update({
        where: { id: slot.conversationId },
        data: { status: "SCHEDULED" },
      });
      revalidatePath("/");
      return { status: "SCHEDULED" };
    } else {
      // No content — delete row; slot reappears as virtual EMPTY on next fetch
      await prisma.scheduledSlot.delete({ where: { id } });
      revalidatePath("/");
      return { status: "EMPTY" };
    }
  } else {
    const postedAt = new Date();
    await prisma.scheduledSlot.update({ where: { id }, data: { status: "POSTED", postedAt } });
    if (slot.conversationId) {
      await prisma.conversation.update({
        where: { id: slot.conversationId },
        data: { status: "POSTED" },
      });
    }
    revalidatePath("/");
    return { postedAt, status: "POSTED" };
  }
}

export async function deleteSlot(id: string) {
  const userId = await requireUserId();
  const slot = await prisma.scheduledSlot.findFirst({ where: { id, userId } });
  if (!slot) return;
  await prisma.scheduledSlot.delete({ where: { id } });
  if (slot.conversationId) {
    await prisma.conversation.delete({
      where: { id: slot.conversationId, userId },
    });
  }
  revalidatePath("/");
}

export async function unscheduleSlot(id: string) {
  const userId = await requireUserId();
  const slot = await prisma.scheduledSlot.findFirst({ where: { id, userId } });
  if (!slot) return;
  if (slot.conversationId) {
    await prisma.conversation.update({
      where: { id: slot.conversationId },
      data: { status: "DRAFT" },
    });
  }
  // Delete the row — slot reappears as virtual EMPTY on next fetch
  await prisma.scheduledSlot.delete({ where: { id } });
  revalidatePath("/");
}

// ─── Publish Post ────────────────────────────────────────

export async function publishPost(
  conversationId: string,
  text: string,
  slotType: PrismaSlotType = "POST"
): Promise<{
  postedPlatforms: string[];
  errors: Record<string, string>;
  tweetUrl?: string;
}> {
  const { id: userId, timezone } = await requireUser();
  const { getXApiTokenForUserInternal } = await import("@/app/actions/x-token");
  const { postTweet } = await import("@/lib/x-api");

  const postedPlatforms: string[] = [];
  const errors: Record<string, string> = {};
  let tweetUrl: string | undefined;

  // --- Post to X ---
  try {
    const tokenRow = await prisma.xApiToken.findUnique({ where: { userId } });
    if (!tokenRow) {
      errors.X = "X not connected. Go to Settings to connect.";
    } else if (!tokenRow.scopes.includes("tweet.write")) {
      errors.X = "Missing write permission. Reconnect X in Settings.";
    } else {
      const credentials = await getXApiTokenForUserInternal(userId);
      if (!credentials) {
        errors.X = "Failed to get X token. Try reconnecting in Settings.";
      } else {
        const result = await postTweet(credentials, text, {
          callerJob: "publish",
          userId,
        });
        tweetUrl = result.tweetUrl;
        postedPlatforms.push("X");
      }
    }
  } catch (err) {
    errors.X = err instanceof Error ? err.message : "Failed to post to X";
  }

  // --- Create POSTED slot ---
  if (postedPlatforms.length > 0) {
    const { dateStr, timeSlot } = nowInTimezone(timezone);
    const now = new Date();
    const date = new Date(`${dateStr}T00:00:00.000Z`);

    await prisma.scheduledSlot.create({
      data: {
        userId,
        date,
        timeSlot,
        slotType,
        status: "POSTED",
        content: text,
        conversationId,
        postedAt: now,
      },
    });

    await prisma.conversation.update({
      where: { id: conversationId },
      data: { status: "POSTED", title: text.slice(0, 100) },
    });

    revalidatePath("/");
  }

  return { postedPlatforms, errors, tweetUrl };
}

/**
 * Finds the next available slot of the given type from ScheduleConfig and creates
 * a SCHEDULED row for it. Looks up to 60 days ahead.
 */
export async function addToQueue(
  content: string,
  conversationId?: string,
  slotType: PrismaSlotType = "POST"
) {
  const { id: userId, timezone } = await requireUser();
  const config = await getScheduleConfigInternal(userId);
  if (!config) return null;

  const schedule = config[SLOT_TYPE_TO_SECTION[slotType]];
  if (!schedule?.slots?.length) return null;

  const { dateStr: localDateStr } = nowInTimezone(timezone);
  const todayUTC = new Date(`${localDateStr}T00:00:00.000Z`);
  const LOOK_AHEAD_DAYS = 60;
  const toDate = addUTCDays(todayUTC, LOOK_AHEAD_DAYS);

  // Fetch existing SCHEDULED + POSTED to avoid conflicts
  const occupied = await prisma.scheduledSlot.findMany({
    where: {
      userId,
      date: { gte: todayUTC, lt: toDate },
      status: { in: ["SCHEDULED", "POSTED"] },
      slotType,
    },
    select: { date: true, timeSlot: true },
  });
  const occupiedKeys = new Set(occupied.map((s) => `${calendarDateStr(s.date)}_${s.timeSlot}`));

  // Sort slot rows by time for deterministic order
  const sortedRows = [...schedule.slots].sort((a, b) => {
    const [ah, am] = a.time.split(":").map(Number);
    const [bh, bm] = b.time.split(":").map(Number);
    return ah * 60 + am - (bh * 60 + bm);
  });

  for (let d = 0; d < LOOK_AHEAD_DAYS; d++) {
    const date = addUTCDays(todayUTC, d);
    const dayKey = JS_TO_DAY[date.getUTCDay()];
    const dateStr = calendarDateStr(date);

    for (const slotRow of sortedRows) {
      if (!slotRow.time || !slotRow.days[dayKey]) continue;
      const timeSlot = time24to12(slotRow.time);
      if (!isSlotFuture(date, timeSlot, timezone)) continue;

      if (occupiedKeys.has(`${dateStr}_${timeSlot}`)) continue;

      await prisma.scheduledSlot.create({
        data: {
          userId,
          date,
          timeSlot,
          slotType,
          status: "SCHEDULED",
          content,
          conversationId: conversationId ?? null,
        },
      });

      if (conversationId) {
        await prisma.conversation.update({
          where: { id: conversationId },
          data: {
            status: "SCHEDULED",
            title: content.slice(0, 100),
          },
        });
      }

      revalidatePath("/");
      return { date, timeSlot };
    }
  }

  return null;
}

// ─── Goal Config ──────────────────────────────────────────

export async function getGoalConfig(): Promise<{
  targetFollowers: number | null;
  targetDate: Date | null;
} | null> {
  const userId = await requireUserId();
  const row = await prisma.strategyConfig.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: { targetFollowers: true, targetDate: true },
  });
  if (!row) return null;
  return { targetFollowers: row.targetFollowers, targetDate: row.targetDate };
}

export async function updateGoalConfig(data: {
  targetFollowers: number;
  targetDate: Date;
}): Promise<void> {
  const userId = await requireUserId();
  const existing = await prisma.strategyConfig.findFirst({ where: { userId } });
  if (existing) {
    await prisma.strategyConfig.update({
      where: { id: existing.id },
      data: { targetFollowers: data.targetFollowers, targetDate: data.targetDate },
    });
  } else {
    await prisma.strategyConfig.create({
      data: { targetFollowers: data.targetFollowers, targetDate: data.targetDate, userId },
    });
  }
  revalidatePath("/");
}

export async function getGoalTrackingData(): Promise<GoalTrackingData | null> {
  const userId = await requireUserId();
  return _getGoalTrackingData(userId);
}

export async function getGoalTrackingDataInternal(
  userId: string
): Promise<GoalTrackingData | null> {
  return _getGoalTrackingData(userId);
}

async function _getGoalTrackingData(userId: string): Promise<GoalTrackingData | null> {
  const config = await prisma.strategyConfig.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: { targetFollowers: true, targetDate: true },
  });
  if (!config?.targetFollowers || !config?.targetDate) return null;

  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  since.setUTCDate(since.getUTCDate() - 30);

  const snapshots = await prisma.followersSnapshot.findMany({
    where: { userId, date: { gte: since } },
    orderBy: { date: "asc" },
  });

  if (snapshots.length === 0) return null;

  const latest = snapshots[snapshots.length - 1];
  const currentFollowers = latest.followersCount;

  const totalDelta = snapshots.reduce((sum, s) => sum + s.deltaFollowers, 0);
  const dailyAvgGrowth = snapshots.length > 1 ? totalDelta / snapshots.length : 0;

  const remaining = config.targetFollowers - currentFollowers;
  let projectedDate: Date | null = null;
  if (dailyAvgGrowth > 0) {
    const daysNeeded = Math.ceil(remaining / dailyAvgGrowth);
    projectedDate = new Date();
    projectedDate.setUTCDate(projectedDate.getUTCDate() + daysNeeded);
  }

  const targetDate = new Date(config.targetDate);
  const now = new Date();
  const daysToTarget = Math.ceil((targetDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  const requiredDailyGrowth =
    daysToTarget > 0 ? remaining / daysToTarget : remaining > 0 ? Infinity : 0;
  const deviationDays = projectedDate
    ? Math.round((targetDate.getTime() - projectedDate.getTime()) / (1000 * 60 * 60 * 24))
    : -Infinity;

  const onTrack = dailyAvgGrowth >= requiredDailyGrowth;

  return {
    currentFollowers,
    targetFollowers: config.targetFollowers,
    targetDate: config.targetDate,
    dailyAvgGrowth: Math.round(dailyAvgGrowth * 10) / 10,
    projectedDate,
    deviationDays: deviationDays === -Infinity ? -999 : deviationDays,
    onTrack,
  };
}

// ─── Composer: re-schedule helpers ────────────────────────

/**
 * Check if there's an existing SCHEDULED ScheduledSlot linked to this conversation.
 * Returns the slot if found, null otherwise.
 */
export async function checkExistingSchedule(conversationId: string): Promise<{
  id: string;
  date: Date;
  timeSlot: string;
  content: string | null;
  status: string;
} | null> {
  const userId = await requireUserId();
  const slot = await prisma.scheduledSlot.findFirst({
    where: { userId, conversationId, status: { in: ["SCHEDULED", "POSTED"] } },
    select: { id: true, date: true, timeSlot: true, content: true, status: true },
    orderBy: { date: "desc" },
  });
  return slot ?? null;
}

/**
 * Update the content of an existing ScheduledSlot (for re-scheduling).
 */
export async function updateScheduledContent(slotId: string, content: string) {
  const userId = await requireUserId();
  await prisma.scheduledSlot.updateMany({
    where: { id: slotId, userId },
    data: { content },
  });
  revalidatePath("/");
}

export async function getGoalChartData(): Promise<GoalChartData | null> {
  const userId = await requireUserId();
  const config = await prisma.strategyConfig.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: { targetFollowers: true, targetDate: true },
  });
  if (!config?.targetFollowers || !config?.targetDate) return null;

  const snapshots = await prisma.followersSnapshot.findMany({
    where: { userId },
    orderBy: { date: "asc" },
    select: { date: true, followersCount: true },
  });
  if (snapshots.length === 0) return null;

  return {
    snapshots: snapshots.map((s) => ({
      date: s.date.toISOString().split("T")[0],
      followers: s.followersCount,
    })),
    targetFollowers: config.targetFollowers,
    targetDate: config.targetDate.toISOString().split("T")[0],
    firstFollowers: snapshots[0].followersCount,
    firstDate: snapshots[0].date.toISOString().split("T")[0],
  };
}
