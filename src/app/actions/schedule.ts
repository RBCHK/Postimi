"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import type { SlotStatus, SlotType } from "@/lib/types";
import { SlotStatus as PrismaSlotStatus, SlotType as PrismaSlotType } from "@/generated/prisma";

const slotStatusToPrisma: Record<SlotStatus, PrismaSlotStatus> = {
  empty: "EMPTY",
  filled: "FILLED",
  posted: "POSTED",
};


const slotStatusFromPrisma = (v: PrismaSlotStatus): SlotStatus =>
  v.toLowerCase() as SlotStatus;

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
  d.setHours(h, m, 0, 0);
  return d;
}

// Lazy update: auto-transition FILLED slots past their scheduled time → POSTED
async function checkAndUpdatePassedSlots() {
  const now = new Date();
  const filledSlots = await prisma.scheduledSlot.findMany({
    where: { status: "FILLED" },
  });

  const passedSlots = filledSlots.filter(
    (s) => getSlotDateTime(s.date, s.timeSlot) < now
  );
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

export async function getScheduledSlots() {
  // Lazy update: mark past FILLED slots as POSTED before returning
  await checkAndUpdatePassedSlots();

  const today = new Date();
  today.setHours(0, 0, 0, 0);

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
    }))
    .sort((a, b) => getSlotDateTime(a.date, a.timeSlot).getTime() - getSlotDateTime(b.date, b.timeSlot).getTime());
}

/**
 * Ensures scheduled slots exist for the upcoming week.
 * Prefers the new ScheduleConfig (grid per content type) if saved.
 * Falls back to the legacy config (postsPerDay + timeSlots[]) for backward compatibility.
 */
export async function ensureSlotsForWeek() {
  // If new scheduleConfig exists, use it for slot generation
  const scheduleConfig = await getScheduleConfig();
  if (scheduleConfig) {
    await regenerateSlotsFromConfig(scheduleConfig);
    return;
  }

  // Fallback: legacy config (postsPerDay + timeSlots array)
  const config = await getStrategyConfig();
  const timeSlots = config?.timeSlots ?? ["9:00 AM", "12:00 PM", "3:00 PM", "6:00 PM"];
  const postsPerDay = config?.postsPerDay ?? 2;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let d = 0; d < 7; d++) {
    const date = new Date(today);
    date.setDate(date.getDate() + d);

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
      data: { postsPerDay: 2, replySessionsPerDay: 4, timeSlots: [], scheduleConfig: data as object },
    });
  }
  // Auto-regenerate scheduled slots starting from tomorrow
  await regenerateSlotsFromConfig(data);
  revalidatePath("/");
}

const DAY_TO_JS: Record<DayKey, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
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
async function regenerateSlotsFromConfig(config: ScheduleConfig) {
  const now = new Date();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const weekEnd = new Date(today);
  weekEnd.setDate(weekEnd.getDate() + 7);

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
    date.setDate(date.getDate() + d);
    dates.push(date);
  }

  // Collect all new slots — no per-slot DB queries
  const toCreate: { date: Date; timeSlot: string; slotType: PrismaSlotType; status: "EMPTY" }[] = [];

  for (const [section, schedule] of Object.entries(config) as [keyof ScheduleConfig, ContentSchedule][]) {
    const slotType = SECTION_TO_SLOT_TYPE[section];

    for (const slot of schedule.slots) {
      if (!slot.time) continue;
      const timeSlot = time24to12(slot.time);

      for (const date of dates) {
        const jsDay = date.getDay(); // 0=Sun, 1=Mon, ...
        const dayKey = (Object.entries(DAY_TO_JS).find(([, num]) => num === jsDay)?.[0]) as DayKey | undefined;
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

function formatCurrentTime(): string {
  const now = new Date();
  const h = now.getHours();
  const m = now.getMinutes();
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${m.toString().padStart(2, "0")} ${period}`;
}

export async function toggleSlotPosted(id: string): Promise<{ timeSlot?: string; status: "POSTED" | "FILLED" | "EMPTY" }> {
  const slot = await prisma.scheduledSlot.findUnique({ where: { id } });
  if (!slot) throw new Error("Slot not found");

  if (slot.status === "POSTED") {
    // Revert: if had a draft → FILLED, otherwise → EMPTY
    const newStatus = slot.conversationId ? "FILLED" : "EMPTY";
    await prisma.scheduledSlot.update({ where: { id }, data: { status: newStatus } });
    if (slot.conversationId) {
      await prisma.conversation.update({
        where: { id: slot.conversationId },
        data: { status: "SCHEDULED" },
      });
    }
    revalidatePath("/");
    return { status: newStatus };
  } else {
    const timeSlot = formatCurrentTime();
    await prisma.scheduledSlot.update({ where: { id }, data: { status: "POSTED", timeSlot } });
    if (slot.conversationId) {
      await prisma.conversation.update({
        where: { id: slot.conversationId },
        data: { status: "POSTED" },
      });
    }
    revalidatePath("/");
    return { timeSlot, status: "POSTED" };
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

export async function addToQueue(
  content: string,
  conversationId?: string,
  slotType: "REPLY" | "POST" = "POST"
) {
  // Find first EMPTY slot of matching type
  let slot = await prisma.scheduledSlot.findFirst({
    where: { status: "EMPTY", slotType },
    orderBy: [{ date: "asc" }, { timeSlot: "asc" }],
  });

  // No slot found → generate next-day slots and retry once
  if (!slot) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    await ensureSlotsForDate(tomorrow);
    slot = await prisma.scheduledSlot.findFirst({
      where: { status: "EMPTY", slotType },
      orderBy: [{ date: "asc" }, { timeSlot: "asc" }],
    });
  }

  if (!slot) return null;

  // If slot time already passed → post immediately
  const now = new Date();
  const slotDateTime = getSlotDateTime(slot.date, slot.timeSlot);
  const isPast = slotDateTime < now;

  await prisma.scheduledSlot.update({
    where: { id: slot.id },
    data: {
      status: isPast ? "POSTED" : "FILLED",
      content,
      conversationId: conversationId ?? null,
    },
  });

  if (conversationId) {
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { status: isPast ? "POSTED" : "SCHEDULED" },
    });
  }

  revalidatePath("/");
  return { date: isPast ? now : slot.date, timeSlot: slot.timeSlot, isPast };
}
