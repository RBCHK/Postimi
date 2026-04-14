"use server";

import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/auth";
import { PLANS } from "@/lib/plans";
import { AiUsageStatus, type SubscriptionStatus } from "@/generated/prisma";

export type AiUsageBreakdownItem = {
  operation: string;
  costUsd: number;
  count: number;
};

export type AiUsageHistoryItem = {
  id: string;
  operation: string;
  model: string;
  status: AiUsageStatus;
  costUsd: number;
  tokensIn: number;
  tokensOut: number;
  createdAt: string;
};

export type BillingInfo = {
  hasSubscription: boolean;
  status: SubscriptionStatus | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  quotaUsd: number;
  usedUsd: number;
  breakdown: AiUsageBreakdownItem[];
  recent: AiUsageHistoryItem[];
};

export async function getBillingInfo(): Promise<BillingInfo> {
  const userId = await requireUserId();

  const [user, subscription] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { monthlyAiQuotaUsd: true },
    }),
    prisma.subscription.findUnique({
      where: { userId },
      select: {
        status: true,
        currentPeriodStart: true,
        currentPeriodEnd: true,
        cancelAtPeriodEnd: true,
      },
    }),
  ]);

  const quotaUsd = user?.monthlyAiQuotaUsd
    ? Number(user.monthlyAiQuotaUsd)
    : PLANS.pro.monthlyAiQuotaUsd;

  // Period start for usage aggregation. Fall back to 30d ago if no subscription.
  const periodStart =
    subscription?.currentPeriodStart ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const includedStatuses = [AiUsageStatus.RESERVED, AiUsageStatus.COMPLETED, AiUsageStatus.ABORTED];

  const [sumAgg, breakdownRows, recent] = await Promise.all([
    prisma.aiUsage.aggregate({
      where: { userId, createdAt: { gte: periodStart }, status: { in: includedStatuses } },
      _sum: { costUsd: true },
    }),
    prisma.aiUsage.groupBy({
      by: ["operation"],
      where: { userId, createdAt: { gte: periodStart }, status: { in: includedStatuses } },
      _sum: { costUsd: true },
      _count: { _all: true },
    }),
    prisma.aiUsage.findMany({
      where: { userId, createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        operation: true,
        model: true,
        status: true,
        costUsd: true,
        tokensIn: true,
        tokensOut: true,
        createdAt: true,
      },
    }),
  ]);

  const usedUsd = Number(sumAgg._sum.costUsd ?? 0);

  const breakdown: AiUsageBreakdownItem[] = breakdownRows
    .map((r) => ({
      operation: r.operation,
      costUsd: Number(r._sum.costUsd ?? 0),
      count: r._count._all,
    }))
    .sort((a, b) => b.costUsd - a.costUsd);

  return {
    hasSubscription: Boolean(subscription),
    status: subscription?.status ?? null,
    currentPeriodStart: subscription?.currentPeriodStart.toISOString() ?? null,
    currentPeriodEnd: subscription?.currentPeriodEnd.toISOString() ?? null,
    cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? false,
    quotaUsd,
    usedUsd,
    breakdown,
    recent: recent.map((r) => ({
      id: r.id,
      operation: r.operation,
      model: r.model,
      status: r.status,
      costUsd: Number(r.costUsd),
      tokensIn: r.tokensIn,
      tokensOut: r.tokensOut,
      createdAt: r.createdAt.toISOString(),
    })),
  };
}
