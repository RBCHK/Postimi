"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import {
  ProposalStatus as PrismaProposalStatus,
  SlotType as PrismaSlotType,
} from "@/generated/prisma";
import {
  getScheduleConfig,
  saveScheduleConfig,
  type ScheduleConfig,
  type DayKey,
} from "@/app/actions/schedule";
import type {
  PlanChange,
  ConfigChange,
  MetricsSnapshot,
  PlanProposalItem,
  ProposalStatus,
} from "@/lib/types";

const statusFromPrisma: Record<PrismaProposalStatus, ProposalStatus> = {
  PENDING: "pending",
  ACCEPTED: "accepted",
  REJECTED: "rejected",
};

const slotTypeToPrisma: Record<string, PrismaSlotType> = {
  Post: "POST",
  Reply: "REPLY",
  Thread: "THREAD",
  Article: "ARTICLE",
};

function mapRow(row: {
  id: string;
  status: PrismaProposalStatus;
  proposalType: string;
  changes: unknown;
  summary: string;
  analysisId: string | null;
  metricsSnapshot: unknown;
  createdAt: Date;
}): PlanProposalItem {
  return {
    id: row.id,
    status: statusFromPrisma[row.status],
    proposalType: row.proposalType === "schedule" ? "schedule" : "config",
    changes: row.changes as PlanChange[] | ConfigChange[],
    summary: row.summary,
    analysisId: row.analysisId ?? undefined,
    metricsSnapshot: row.metricsSnapshot ? (row.metricsSnapshot as MetricsSnapshot) : undefined,
    createdAt: row.createdAt,
  };
}

/** Build an empty ScheduleConfig (all sections empty) */
function emptyScheduleConfig(): ScheduleConfig {
  return {
    replies: { slots: [] },
    posts: { slots: [] },
    threads: { slots: [] },
    articles: { slots: [] },
  };
}

const SECTION_MAP: Record<ConfigChange["section"], keyof ScheduleConfig> = {
  replies: "replies",
  posts: "posts",
  threads: "threads",
  articles: "articles",
};

/** Apply a list of ConfigChange items to a ScheduleConfig and return the new config */
function applyConfigChanges(config: ScheduleConfig, changes: ConfigChange[]): ScheduleConfig {
  // Deep clone to avoid mutation
  const next: ScheduleConfig = {
    replies: { slots: config.replies.slots.map((s) => ({ ...s, days: { ...s.days } })) },
    posts: { slots: config.posts.slots.map((s) => ({ ...s, days: { ...s.days } })) },
    threads: { slots: config.threads.slots.map((s) => ({ ...s, days: { ...s.days } })) },
    articles: { slots: config.articles.slots.map((s) => ({ ...s, days: { ...s.days } })) },
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
        // Merge days into existing slot
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
        // Remove the slot entirely if no days remain active
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
  changes: PlanChange[] | ConfigChange[];
  summary: string;
  analysisId?: string;
  proposalType?: "config" | "schedule";
  metricsSnapshot?: MetricsSnapshot;
}): Promise<PlanProposalItem> {
  const row = await prisma.planProposal.create({
    data: {
      changes: data.changes as object,
      summary: data.summary,
      analysisId: data.analysisId ?? null,
      proposalType: data.proposalType ?? "config",
      metricsSnapshot: data.metricsSnapshot ? (data.metricsSnapshot as object) : undefined,
    },
  });
  revalidatePath("/");
  return mapRow(row);
}

/** Get the current pending proposal (if any) */
export async function getPendingProposal(): Promise<PlanProposalItem | null> {
  const row = await prisma.planProposal.findFirst({
    where: { status: "PENDING" },
    orderBy: { createdAt: "desc" },
  });
  if (!row) return null;
  return mapRow(row);
}

/** Get accepted proposals from the last N days (for effectiveness review) */
export async function getAcceptedProposals(days: number): Promise<PlanProposalItem[]> {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - days);
  const rows = await prisma.planProposal.findMany({
    where: { status: "ACCEPTED", reviewedAt: { gte: since } },
    orderBy: { reviewedAt: "desc" },
  });
  return rows.map(mapRow);
}

/**
 * Accept a proposal — apply changes based on proposalType:
 * - "config": update ScheduleConfig (recurring template) → auto-regenerate slots
 * - "schedule" (legacy): apply one-time ScheduledSlot changes
 *
 * If selectedIndices is provided, only those changes are applied.
 */
export async function acceptProposal(id: string, selectedIndices?: number[]): Promise<void> {
  const proposal = await prisma.planProposal.findUnique({ where: { id } });
  if (!proposal || proposal.status !== "PENDING") {
    throw new Error("Proposal not found or already reviewed");
  }

  const allChanges = proposal.changes as unknown as (PlanChange | ConfigChange)[];
  const changesToApply = selectedIndices
    ? selectedIndices.filter((i) => i >= 0 && i < allChanges.length).map((i) => allChanges[i]!)
    : allChanges;

  if (proposal.proposalType !== "schedule") {
    // Config-level: update the recurring ScheduleConfig template
    const currentConfig = (await getScheduleConfig()) ?? emptyScheduleConfig();
    const newConfig = applyConfigChanges(currentConfig, changesToApply as ConfigChange[]);
    // saveScheduleConfig calls regenerateSlotsFromConfig + revalidatePath("/")
    await saveScheduleConfig(newConfig);
  } else {
    // Legacy schedule: apply one-time slot changes
    for (const change of changesToApply as PlanChange[]) {
      const date = new Date(`${change.date}T00:00:00.000Z`);
      const slotType = slotTypeToPrisma[change.slotType];
      if (!slotType) continue;

      if (change.action === "add") {
        const dayStart = new Date(date);
        const dayEnd = new Date(date.getTime() + 86400000);
        const existing = await prisma.scheduledSlot.findFirst({
          where: {
            date: { gte: dayStart, lt: dayEnd },
            timeSlot: change.timeSlot,
            slotType,
          },
        });
        if (!existing) {
          await prisma.scheduledSlot.create({
            data: { date, timeSlot: change.timeSlot, slotType, status: "EMPTY" },
          });
        }
      } else if (change.action === "remove") {
        const dayStart = new Date(date);
        const dayEnd = new Date(date.getTime() + 86400000);
        await prisma.scheduledSlot.deleteMany({
          where: {
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

  await prisma.planProposal.update({
    where: { id },
    data: { status: "ACCEPTED", reviewedAt: new Date() },
  });
}

/** Reject a proposal */
export async function rejectProposal(id: string): Promise<void> {
  await prisma.planProposal.update({
    where: { id },
    data: { status: "REJECTED", reviewedAt: new Date() },
  });
  revalidatePath("/");
}
