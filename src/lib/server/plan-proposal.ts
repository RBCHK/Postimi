import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { ProposalStatus as PrismaProposalStatus, type Platform } from "@/generated/prisma";
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
