import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { ProposalStatus as PrismaProposalStatus, type Platform } from "@/generated/prisma";
import type {
  PlanChange,
  ConfigChange,
  MetricsSnapshot,
  PlanProposalItem,
  PlanProposalListItem,
  ProposalStatus,
} from "@/lib/types";

const statusFromPrisma: Record<PrismaProposalStatus, ProposalStatus> = {
  PENDING: "pending",
  ACCEPTED: "accepted",
  REJECTED: "rejected",
};

export function mapProposalRow(row: {
  id: string;
  platform: Platform;
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
    platform: row.platform,
    status: statusFromPrisma[row.status],
    proposalType: row.proposalType === "schedule" ? "schedule" : "config",
    changes: row.changes as PlanChange[] | ConfigChange[],
    summary: row.summary,
    analysisId: row.analysisId ?? undefined,
    metricsSnapshot: row.metricsSnapshot ? (row.metricsSnapshot as MetricsSnapshot) : undefined,
    createdAt: row.createdAt,
  };
}

export async function savePlanProposal(
  userId: string,
  data: {
    platform?: Platform;
    changes: PlanChange[] | ConfigChange[];
    summary: string;
    analysisId?: string;
    proposalType?: "config" | "schedule";
    metricsSnapshot?: MetricsSnapshot;
  }
): Promise<PlanProposalItem> {
  const row = await prisma.planProposal.create({
    data: {
      userId,
      platform: data.platform ?? "X",
      changes: data.changes as object,
      summary: data.summary,
      analysisId: data.analysisId ?? null,
      proposalType: data.proposalType ?? "config",
      metricsSnapshot: data.metricsSnapshot ? (data.metricsSnapshot as object) : undefined,
    },
  });
  // New PENDING proposal appears in the home-page banner (fetched via
  // getPendingProposal in /app/page.tsx). Narrower than the previous
  // tree-wide invalidation — nothing else on the dashboard depends on
  // proposal state.
  revalidatePath("/");
  return mapProposalRow(row);
}

export async function getAcceptedProposals(
  userId: string,
  days: number,
  platform?: Platform
): Promise<PlanProposalItem[]> {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - days);
  const rows = await prisma.planProposal.findMany({
    where: {
      userId,
      status: "ACCEPTED",
      reviewedAt: { gte: since },
      ...(platform ? { platform } : {}),
    },
    orderBy: { reviewedAt: "desc" },
  });
  return rows.map(mapProposalRow);
}

/**
 * Slim list variant: returns accepted proposals without the large
 * `changes` JSON array or `metricsSnapshot` column. For list/index
 * views that only render `summary` / `platform` / `createdAt` /
 * `reviewedAt`. Use `getAcceptedProposalDetails(id)` when the user
 * expands a row and needs the full payload.
 *
 * Context: `changes` can be ~5 KB per row; 60-day windows with one
 * proposal per week already push 30 KB, and a power user reviewing
 * monthly can easily hit 200 KB when every row is hydrated just to
 * render a summary list.
 */
export async function getAcceptedProposalsList(
  userId: string,
  days: number,
  platform?: Platform
): Promise<PlanProposalListItem[]> {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - days);
  const rows = await prisma.planProposal.findMany({
    where: {
      userId,
      status: "ACCEPTED",
      reviewedAt: { gte: since },
      ...(platform ? { platform } : {}),
    },
    orderBy: { reviewedAt: "desc" },
    select: {
      id: true,
      platform: true,
      status: true,
      proposalType: true,
      summary: true,
      analysisId: true,
      createdAt: true,
      reviewedAt: true,
    },
  });
  return rows.map((row) => ({
    id: row.id,
    platform: row.platform,
    status: statusFromPrisma[row.status],
    proposalType: row.proposalType === "schedule" ? "schedule" : "config",
    summary: row.summary,
    analysisId: row.analysisId ?? undefined,
    createdAt: row.createdAt,
    reviewedAt: row.reviewedAt,
  }));
}

/**
 * Detail fetch for an expanded row. Scoped by `userId` to keep
 * cross-tenant reads impossible even if the caller hands over an id
 * that belongs to another user. Returns `null` when the proposal is
 * not found (either missing or owned by someone else).
 */
export async function getAcceptedProposalDetails(
  userId: string,
  id: string
): Promise<PlanProposalItem | null> {
  const row = await prisma.planProposal.findFirst({
    where: { id, userId, status: "ACCEPTED" },
  });
  if (!row) return null;
  return mapProposalRow(row);
}
