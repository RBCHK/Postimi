"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import type { GoalChartData, GoalTrackingData, SlotStatus, SlotType } from "@/lib/types";
import { SlotType as PrismaSlotType } from "@/generated/prisma";
import { calendarDateStr } from "@/lib/date-utils";

const slotStatusFromPrisma = (v: string): SlotStatus => v.toLowerCase() as SlotStatus;

const slotTypeFromPrisma = (v: PrismaSlotType): SlotType => {
  const map: Record<PrismaSlotType, SlotType> = {
    REPLY: "Reply",
    POST: "Post",
    THREAD: "Thread",
    ARTICLE: "Article",
  };
  return map[v];
};

// Convert "HH:MM" (24h) → "h:MM AM/PM"
function time24to12(time24: string): string {
  const [h, m] = time24.split(":").map(Number);
  if (isNaN(h) || isNaN(m)) return time24;
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${m.toString().padStart(2, "0")} ${period}`;
}

// Combines a date (midnight) with a time slot string like "9:00 AM" → absolute Date
function getSlotDateTime(date: Date, timeSlot: string): Date {
  const d = new Date(date);
  const match = timeSlot.match(/^(\d+):(\d+)\s*(AM|PM)$/i);
  if (!match) return d;
  let h = parseInt(match[1]);
  const m = parseInt(match[2]);
  const period = match[3].toUpperCase();
  if (period === "PM" && h !== 12) h += 12;
  if (period === "AM" && h === 12) h = 0;
  d.setUTCHours(h, m, 0, 0);
  return d;
}

// Lazy update: auto-transition FILLED slots past their scheduled time → POSTED
async function checkAndUpdatePassedSlots() {
  const now = new Date();
  const filledSlots = await prisma.scheduledSlot.findMany({
    where: { status: "FILLED" },
  });

  const passedSlots = filledSlots.filter((s) => getSlotDateTime(s.date, s.timeSlot) < now);
  if (passedSlots.length === 0) return;

  const passedIds = passedSlots.map((s) => s.id);

  // Batch update slots
  await prisma.scheduledSlot.updateMany({
    where: { id: { in: passedIds } },
    data: { status: "POSTED" },
  });

  // Update linked conversations (still per-row, but only for passed slots with a draft)
  const withConversation = passedSlots.filter((s) => s.conversationId);
  await Promise.all(
    withConversation.map((s) =>
      prisma.conversation.update({
        where: { id: s.conversationId! },
        data: { status: "POSTED" },
      })
    )
  );
}

// Ensure slots exist for a specific date (used when no free slots found)
async function ensureSlotsForDate(date: Date) {
  const config = await getStrategyConfig();
  const timeSlots = config?.timeSlots ?? ["9:00 AM", "12:00 PM", "3:00 PM", "6:00 PM"];
  const postsPerDay = config?.postsPerDay ?? 2;

  for (let i = 0; i < timeSlots.length; i++) {
    const ts = timeSlots[i];
    const slotType: PrismaSlotType = i < postsPerDay ? "POST" : "REPLY";
    const dayStart = new Date(date);
    const dayEnd = new Date(date.getTime() + 86400000);
    const existing = await prisma.scheduledSlot.findFirst({
      where: {
        date: { gte: dayStart, lt: dayEnd },
        timeSlot: ts,
      },
    });
    if (!existing) {
      await prisma.scheduledSlot.create({
        data: { date, timeSlot: ts, slotType, status: "EMPTY" },
      });
    }
  }
}

export async function getStrategyConfig() {
  const row = await prisma.strategyConfig.findFirst({ orderBy: { createdAt: "desc" } });
  if (!row) return null;
  const timeSlots = row.timeSlots as string[];
  return {
    id: row.id,
    postsPerDay: row.postsPerDay,
    replySessionsPerDay: row.replySessionsPerDay,
    timeSlots: Array.isArray(timeSlots) ? timeSlots : [],
  };
}

export async function upsertStrategyConfig(data: {
  postsPerDay: number;
  replySessionsPerDay: number;
  timeSlots: string[];
}) {
  const existing = await prisma.strategyConfig.findFirst();
  const payload = {
    postsPerDay: data.postsPerDay,
    replySessionsPerDay: data.replySessionsPerDay,
    timeSlots: data.timeSlots as object,
  };
  if (existing) {
    await prisma.strategyConfig.update({ where: { id: existing.id }, data: payload });
  } else {
    await prisma.strategyConfig.create({ data: payload });
  }
}

export async function getScheduledSlots(localDateStr?: string) {
  // Lazy update: mark past FILLED slots as POSTED before returning
  await checkAndUpdatePassedSlots();

  const today = localDateStr
    ? new Date(`${localDateStr}T00:00:00.000Z`)
    : (() => {
        const d = new Date();
        d.setUTCHours(0, 0, 0, 0);
        return d;
      })();

  const rows = await prisma.scheduledSlot.findMany({
    where: { date: { gte: today } },
    orderBy: { date: "asc" },
    include: { conversation: true },
  });
  return rows
    .map((r) => ({
      id: r.id,
      date: r.date,
      timeSlot: r.timeSlot,
      slotType: slotTypeFromPrisma(r.slotType),
      status: slotStatusFromPrisma(r.status),
      content: r.content,
      draftId: r.conversationId ?? undefined,
      draftTitle: r.conversation?.title ?? undefined,
      postedAt: r.postedAt ?? undefined,
    }))
    .sort(
      (a, b) =>
        getSlotDateTime(a.date, a.timeSlot).getTime() -
        getSlotDateTime(b.date, b.timeSlot).getTime()
    );
}

/**
 * Ensures scheduled slots exist for the upcoming week.
 * Prefers the new ScheduleConfig (grid per content type) if saved.
 * Falls back to the legacy config (postsPerDay + timeSlots[]) for backward compatibility.
 */
export async function ensureSlotsForWeek(localDateStr?: string) {
  // If new scheduleConfig exists, use it for slot generation
  const scheduleConfig = await getScheduleConfig();
  if (scheduleConfig) {
    await regenerateSlotsFromConfig(scheduleConfig, localDateStr);
    return;
  }

  // Fallback: legacy config (postsPerDay + timeSlots array)
  const config = await getStrategyConfig();
  const timeSlots = config?.timeSlots ?? ["9:00 AM", "12:00 PM", "3:00 PM", "6:00 PM"];
  const postsPerDay = config?.postsPerDay ?? 2;

  const today = localDateStr
    ? new Date(`${localDateStr}T00:00:00.000Z`)
    : (() => {
        const d = new Date();
        d.setUTCHours(0, 0, 0, 0);
        return d;
      })();

  for (let d = 0; d < 7; d++) {
    const date = new Date(today);
    date.setUTCDate(date.getUTCDate() + d);

    for (let i = 0; i < timeSlots.length; i++) {
      const ts = timeSlots[i];
      const slotType: PrismaSlotType = i < postsPerDay ? "POST" : "REPLY";
      const dayStart = new Date(date);
      const dayEnd = new Date(date.getTime() + 86400000);
      const existing = await prisma.scheduledSlot.findFirst({
        where: {
          date: { gte: dayStart, lt: dayEnd },
          timeSlot: ts,
        },
      });
      if (!existing) {
        await prisma.scheduledSlot.create({
          data: { date, timeSlot: ts, slotType, status: "EMPTY" },
        });
      }
    }
  }
}

// Add selected text to the next available slot of matching type.
// Updates conversation status to SCHEDULED or POSTED depending on slot timing.
// If no free slot exists, generates slots for the next day and retries.
// --- Schedule Config (Posts / Threads / Articles weekly grid) ---

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
};

export async function getScheduleConfig(): Promise<ScheduleConfig | null> {
  const row = await prisma.strategyConfig.findFirst({ orderBy: { createdAt: "desc" } });
  if (!row || !row.scheduleConfig) return null;
  return row.scheduleConfig as ScheduleConfig;
}

export async function saveScheduleConfig(data: ScheduleConfig): Promise<void> {
  const existing = await prisma.strategyConfig.findFirst();
  const payload = { scheduleConfig: data as object };
  if (existing) {
    await prisma.strategyConfig.update({ where: { id: existing.id }, data: payload });
  } else {
    await prisma.strategyConfig.create({
      data: {
        postsPerDay: 2,
        replySessionsPerDay: 4,
        timeSlots: [],
        scheduleConfig: data as object,
      },
    });
  }
  // Auto-regenerate scheduled slots starting from tomorrow
  await regenerateSlotsFromConfig(data);
  revalidatePath("/");
}

const DAY_TO_JS: Record<DayKey, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const SECTION_TO_SLOT_TYPE: Record<keyof ScheduleConfig, PrismaSlotType> = {
  replies: "REPLY",
  posts: "POST",
  threads: "THREAD",
  articles: "ARTICLE",
};

/**
 * Regenerates EMPTY slots for the next 7 days (starting today) from a ScheduleConfig.
 * FILLED and POSTED slots are never touched — only future EMPTY slots are deleted and recreated.
 * For today, all configured slots are created regardless of current time (so the full day plan is visible).
 * Uses batch DB operations: one findMany + one createMany instead of N×(findFirst+create).
 * Called automatically after saveScheduleConfig() and from ensureSlotsForWeek() when config exists.
 */
async function regenerateSlotsFromConfig(config: ScheduleConfig, localDateStr?: string) {
  const now = new Date();
  const today = localDateStr
    ? new Date(`${localDateStr}T00:00:00.000Z`)
    : (() => {
        const d = new Date();
        d.setUTCHours(0, 0, 0, 0);
        return d;
      })();
  const weekEnd = new Date(today);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);

  // Remove EMPTY slots from today onwards (don't touch FILLED/POSTED)
  await prisma.scheduledSlot.deleteMany({
    where: { status: "EMPTY", date: { gte: today } },
  });

  // Fetch all remaining (FILLED/POSTED) slots in range to check conflicts — single query
  const occupied = await prisma.scheduledSlot.findMany({
    where: { date: { gte: today, lt: weekEnd } },
    select: { date: true, timeSlot: true, slotType: true },
  });
  const occupiedKeys = new Set(
    occupied.map((s) => `${s.date.toISOString().split("T")[0]}_${s.timeSlot}_${s.slotType}`)
  );

  // Build dates for today + next 6 days (7 days total)
  const dates: Date[] = [];
  for (let d = 0; d < 7; d++) {
    const date = new Date(today);
    date.setUTCDate(date.getUTCDate() + d);
    dates.push(date);
  }

  // Collect all new slots — no per-slot DB queries
  const toCreate: { date: Date; timeSlot: string; slotType: PrismaSlotType; status: "EMPTY" }[] =
    [];

  for (const [section, schedule] of Object.entries(config) as [
    keyof ScheduleConfig,
    ContentSchedule,
  ][]) {
    const slotType = SECTION_TO_SLOT_TYPE[section];

    for (const slot of schedule.slots) {
      if (!slot.time) continue;
      const timeSlot = time24to12(slot.time);

      for (const date of dates) {
        const jsDay = date.getUTCDay(); // 0=Sun, 1=Mon, ...
        const dayKey = Object.entries(DAY_TO_JS).find(([, num]) => num === jsDay)?.[0] as
          | DayKey
          | undefined;
        if (!dayKey || !slot.days[dayKey]) continue;

        // Skip past slots — but keep all of today's slots so the full day plan is visible
        const isToday = date.getTime() === today.getTime();
        const slotDateTime = getSlotDateTime(date, timeSlot);
        if (!isToday && slotDateTime <= now) continue;

        const dateKey = date.toISOString().split("T")[0];
        const conflictKey = `${dateKey}_${timeSlot}_${slotType}`;
        if (occupiedKeys.has(conflictKey)) continue;

        toCreate.push({ date, timeSlot, slotType, status: "EMPTY" });
        occupiedKeys.add(conflictKey); // prevent duplicate rows at same time
      }
    }
  }

  if (toCreate.length > 0) {
    await prisma.scheduledSlot.createMany({ data: toCreate });
  }
}

export async function toggleSlotPosted(
  id: string
): Promise<{ postedAt?: Date; status: "POSTED" | "FILLED" | "EMPTY" }> {
  const slot = await prisma.scheduledSlot.findUnique({ where: { id } });
  if (!slot) throw new Error("Slot not found");

  if (slot.status === "POSTED") {
    // Revert: if had a draft → FILLED, otherwise → EMPTY
    const newStatus = slot.conversationId ? "FILLED" : "EMPTY";
    await prisma.scheduledSlot.update({
      where: { id },
      data: { status: newStatus, postedAt: null },
    });
    if (slot.conversationId) {
      await prisma.conversation.update({
        where: { id: slot.conversationId },
        data: { status: "SCHEDULED" },
      });
    }
    revalidatePath("/");
    return { status: newStatus };
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
  const slot = await prisma.scheduledSlot.findUnique({ where: { id } });
  if (!slot) return;
  if (slot.conversationId) {
    await prisma.conversation.update({
      where: { id: slot.conversationId },
      data: { status: "DRAFT" },
    });
  }
  await prisma.scheduledSlot.delete({ where: { id } });
  revalidatePath("/");
}

export async function unscheduleSlot(id: string) {
  const slot = await prisma.scheduledSlot.findUnique({ where: { id } });
  if (!slot) return;
  if (slot.conversationId) {
    await prisma.conversation.update({
      where: { id: slot.conversationId },
      data: { status: "DRAFT" },
    });
  }
  await prisma.scheduledSlot.update({
    where: { id },
    data: { status: "EMPTY", conversationId: null, content: null },
  });
  revalidatePath("/");
}

/** Parse timeSlot string like "9:00 AM" → minutes since midnight */
function timeSlotToMinutes(timeSlot: string): number {
  const match = timeSlot.match(/^(\d+):(\d+)\s*(AM|PM)$/i);
  if (!match) return 0;
  let h = parseInt(match[1]);
  const m = parseInt(match[2]);
  const period = match[3].toUpperCase();
  if (period === "PM" && h !== 12) h += 12;
  if (period === "AM" && h === 12) h = 0;
  return h * 60 + m;
}

/** Returns true if a slot is in the future relative to the user's timezone.
 *  Compares wall-clock dates and times directly — no UTC conversion — to avoid server/client TZ mismatch. */
function isSlotFuture(slotDate: Date, timeSlot: string, timezone: string): boolean {
  const now = new Date();
  // Slot dates use UTC-midnight convention: UTC date component = calendar day.
  // Never convert via timezone — use calendarDateStr() to extract directly.
  const slotLocalDate = calendarDateStr(slotDate);
  const nowLocalDate = now.toLocaleDateString("en-CA", { timeZone: timezone });

  if (slotLocalDate > nowLocalDate) return true;
  if (slotLocalDate < nowLocalDate) return false;

  // Same calendar day — compare time-of-day in minutes
  const nowLocalTime = now.toLocaleString("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return timeSlotToMinutes(timeSlot) > timeSlotToMinutes(nowLocalTime);
}

export async function addToQueue(
  content: string,
  conversationId?: string,
  slotType: "REPLY" | "POST" = "POST",
  /** User's IANA timezone, e.g. "America/Los_Angeles" — passed from client via Intl API */
  timezone: string = "UTC"
) {
  // "Today" in the user's timezone → UTC midnight of that calendar day (how dates are stored)
  const now = new Date();
  const localDateStr = now.toLocaleDateString("en-CA", { timeZone: timezone }); // "YYYY-MM-DD"
  const todayUTCMidnight = new Date(`${localDateStr}T00:00:00.000Z`);

  const candidates = await prisma.scheduledSlot.findMany({
    where: { status: "EMPTY", slotType, date: { gte: todayUTCMidnight } },
    orderBy: [{ date: "asc" }, { timeSlot: "asc" }],
  });

  let slot = candidates.find((s) => isSlotFuture(s.date, s.timeSlot, timezone)) ?? null;

  // No future slot found → generate tomorrow's slots and retry once
  if (!slot) {
    const tomorrow = new Date(todayUTCMidnight);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    await ensureSlotsForDate(tomorrow);
    const moreCandidates = await prisma.scheduledSlot.findMany({
      where: { status: "EMPTY", slotType, date: { gte: tomorrow } },
      orderBy: [{ date: "asc" }, { timeSlot: "asc" }],
    });
    slot = moreCandidates[0] ?? null;
  }

  if (!slot) return null;

  await prisma.scheduledSlot.update({
    where: { id: slot.id },
    data: { status: "FILLED", content, conversationId: conversationId ?? null },
  });

  if (conversationId) {
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { status: "SCHEDULED" },
    });
  }

  revalidatePath("/");
  return { date: slot.date, timeSlot: slot.timeSlot };
}

// --- Goal Config ---

export async function getGoalConfig(): Promise<{
  targetFollowers: number | null;
  targetDate: Date | null;
} | null> {
  const row = await prisma.strategyConfig.findFirst({
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
  const existing = await prisma.strategyConfig.findFirst();
  if (existing) {
    await prisma.strategyConfig.update({
      where: { id: existing.id },
      data: { targetFollowers: data.targetFollowers, targetDate: data.targetDate },
    });
  } else {
    await prisma.strategyConfig.create({
      data: {
        postsPerDay: 2,
        replySessionsPerDay: 4,
        timeSlots: [],
        targetFollowers: data.targetFollowers,
        targetDate: data.targetDate,
      },
    });
  }
  revalidatePath("/");
}

/** Compute goal tracking data from FollowersSnapshot + StrategyConfig */
export async function getGoalTrackingData(): Promise<GoalTrackingData | null> {
  const config = await prisma.strategyConfig.findFirst({
    orderBy: { createdAt: "desc" },
    select: { targetFollowers: true, targetDate: true },
  });
  if (!config?.targetFollowers || !config?.targetDate) return null;

  // Get last 30 days of snapshots
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  since.setUTCDate(since.getUTCDate() - 30);

  const snapshots = await prisma.followersSnapshot.findMany({
    where: { date: { gte: since } },
    orderBy: { date: "asc" },
  });

  if (snapshots.length === 0) return null;

  const latest = snapshots[snapshots.length - 1];
  const currentFollowers = latest.followersCount;

  // Rolling 30-day average daily growth
  const totalDelta = snapshots.reduce((sum, s) => sum + s.deltaFollowers, 0);
  const dailyAvgGrowth = snapshots.length > 1 ? totalDelta / snapshots.length : 0;

  // Projected date at current pace
  const remaining = config.targetFollowers - currentFollowers;
  let projectedDate: Date | null = null;
  if (dailyAvgGrowth > 0) {
    const daysNeeded = Math.ceil(remaining / dailyAvgGrowth);
    projectedDate = new Date();
    projectedDate.setUTCDate(projectedDate.getUTCDate() + daysNeeded);
  }

  // Deviation: how many days ahead/behind schedule
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

/** All FollowersSnapshot points + goal config for the goal progress chart */
export async function getGoalChartData(): Promise<GoalChartData | null> {
  const config = await prisma.strategyConfig.findFirst({
    orderBy: { createdAt: "desc" },
    select: { targetFollowers: true, targetDate: true },
  });
  if (!config?.targetFollowers || !config?.targetDate) return null;

  const snapshots = await prisma.followersSnapshot.findMany({
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
