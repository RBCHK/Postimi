"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/auth";
import { SlotType as PrismaSlotType, type Platform } from "@/generated/prisma";
import { getScheduleConfig, saveScheduleConfig } from "@/app/actions/schedule";
import type { ScheduleConfig, DayKey } from "@/lib/server/schedule";
import type { PlanChange, ConfigChange, MetricsSnapshot, PlanProposalItem } from "@/lib/types";
import {
  savePlanProposal as _savePlanProposal,
  getAcceptedProposals as _getAcceptedProposals,
  mapProposalRow,
} from "@/lib/server/plan-proposal";

const slotTypeToPrisma: Record<string, PrismaSlotType> = {
  Post: "POST",
  Reply: "REPLY",
  Thread: "THREAD",
  Article: "ARTICLE",
};

/** Build an empty ScheduleConfig (all sections empty) */
function emptyScheduleConfig(): ScheduleConfig {
  return {
    replies: { slots: [] },
    posts: { slots: [] },
    threads: { slots: [] },
    articles: { slots: [] },
    quotes: { slots: [] },
  };
}

const SECTION_MAP: Record<ConfigChange["section"], keyof ScheduleConfig> = {
  replies: "replies",
  posts: "posts",
  threads: "threads",
  articles: "articles",
  quotes: "quotes",
};

/** Apply a list of ConfigChange items to a ScheduleConfig and return the new config */
function applyConfigChanges(config: ScheduleConfig, changes: ConfigChange[]): ScheduleConfig {
  const next: ScheduleConfig = {
    replies: { slots: config.replies.slots.map((s) => ({ ...s, days: { ...s.days } })) },
    posts: { slots: config.posts.slots.map((s) => ({ ...s, days: { ...s.days } })) },
    threads: { slots: config.threads.slots.map((s) => ({ ...s, days: { ...s.days } })) },
    articles: { slots: config.articles.slots.map((s) => ({ ...s, days: { ...s.days } })) },
    quotes: { slots: config.quotes.slots.map((s) => ({ ...s, days: { ...s.days } })) },
  };

  for (const change of changes) {
    const section = SECTION_MAP[change.section];
    if (!section) continue;

    if (change.action === "add") {
      const existing = next[section].slots.find((s) => s.time === change.time);
      if (!existing) {
        const allDays: Record<DayKey, boolean> = {
          Mon: false,
          Tue: false,
          Wed: false,
          Thu: false,
          Fri: false,
          Sat: false,
          Sun: false,
        };
        const days = { ...allDays, ...change.days } as Record<DayKey, boolean>;
        next[section].slots.push({ id: randomUUID(), time: change.time, days });
      } else {
        for (const [day, val] of Object.entries(change.days)) {
          if (val) (existing.days as Record<string, boolean>)[day] = true;
        }
      }
    } else if (change.action === "remove") {
      const slot = next[section].slots.find((s) => s.time === change.time);
      if (slot) {
        for (const [day, val] of Object.entries(change.days)) {
          if (val) (slot.days as Record<string, boolean>)[day] = false;
        }
        if (!Object.values(slot.days).some(Boolean)) {
          next[section].slots = next[section].slots.filter((s) => s.time !== change.time);
        }
      }
    }
  }

  return next;
}

/** Create a new PENDING plan proposal */
export async function savePlanProposal(data: {
  platform?: Platform;
  changes: PlanChange[] | ConfigChange[];
  summary: string;
  analysisId?: string;
  proposalType?: "config" | "schedule";
  metricsSnapshot?: MetricsSnapshot;
}): Promise<PlanProposalItem> {
  const userId = await requireUserId();
  return _savePlanProposal(userId, data);
}

/** Get the current pending proposal (if any) */
export async function getPendingProposal(): Promise<PlanProposalItem | null> {
  const userId = await requireUserId();
  const row = await prisma.planProposal.findFirst({
    where: { userId, status: "PENDING" },
    orderBy: { createdAt: "desc" },
  });
  if (!row) return null;
  return mapProposalRow(row);
}

/** Get accepted proposals from the last N days (for effectiveness review) */
export async function getAcceptedProposals(
  days: number,
  platform?: Platform
): Promise<PlanProposalItem[]> {
  const userId = await requireUserId();
  return _getAcceptedProposals(userId, days, platform);
}

/**
 * Accept a proposal — apply changes based on proposalType:
 * - "config": update ScheduleConfig (recurring template) → auto-regenerate slots
 * - "schedule" (legacy): apply one-time ScheduledSlot changes
 *
 * If selectedIndices is provided, only those changes are applied.
 */
export async function acceptProposal(id: string, selectedIndices?: number[]): Promise<void> {
  const userId = await requireUserId();
  const proposal = await prisma.planProposal.findFirst({
    where: { id, userId },
  });
  if (!proposal || proposal.status !== "PENDING") {
    throw new Error("Proposal not found or already reviewed");
  }

  const allChanges = proposal.changes as unknown as (PlanChange | ConfigChange)[];
  const changesToApply = selectedIndices
    ? selectedIndices.filter((i) => i >= 0 && i < allChanges.length).map((i) => allChanges[i]!)
    : allChanges;

  if (proposal.proposalType !== "schedule") {
    const currentConfig = (await getScheduleConfig()) ?? emptyScheduleConfig();
    const newConfig = applyConfigChanges(currentConfig, changesToApply as ConfigChange[]);
    await saveScheduleConfig(newConfig);
  } else {
    for (const change of changesToApply as PlanChange[]) {
      const date = new Date(`${change.date}T00:00:00.000Z`);
      const slotType = slotTypeToPrisma[change.slotType];
      if (!slotType) continue;

      if (change.action === "add") {
        const dayStart = new Date(date);
        const dayEnd = new Date(date.getTime() + 86400000);
        const existing = await prisma.scheduledSlot.findFirst({
          where: {
            userId,
            date: { gte: dayStart, lt: dayEnd },
            timeSlot: change.timeSlot,
            slotType,
          },
        });
        if (!existing) {
          await prisma.scheduledSlot.create({
            data: { userId, date, timeSlot: change.timeSlot, slotType, status: "EMPTY" },
          });
        }
      } else if (change.action === "remove") {
        const dayStart = new Date(date);
        const dayEnd = new Date(date.getTime() + 86400000);
        await prisma.scheduledSlot.deleteMany({
          where: {
            userId,
            date: { gte: dayStart, lt: dayEnd },
            timeSlot: change.timeSlot,
            slotType,
            status: "EMPTY",
          },
        });
      }
    }
    revalidatePath("/");
  }

  // Defense-in-depth: scope the state transition by userId AND current status
  // — the precheck enforced both, but keeping them in the WHERE here means
  // a future refactor that re-orders the operations can't lose either guard.
  await prisma.planProposal.updateMany({
    where: { id, userId, status: "PENDING" },
    data: { status: "ACCEPTED", reviewedAt: new Date() },
  });
}

/** Reject a proposal */
export async function rejectProposal(id: string): Promise<void> {
  const userId = await requireUserId();
  const proposal = await prisma.planProposal.findFirst({
    where: { id, userId },
  });
  if (!proposal) throw new Error("Proposal not found");

  await prisma.planProposal.updateMany({
    where: { id, userId },
    data: { status: "REJECTED", reviewedAt: new Date() },
  });
  revalidatePath("/");
}
