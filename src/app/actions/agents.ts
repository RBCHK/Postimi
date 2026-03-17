"use server";

import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/auth";

export interface AgentLastRuns {
  followersSnapshot: Date | null;
  trendSnapshot: Date | null;
  dailyInsight: Date | null;
  xImport: Date | null;
  researcher: Date | null;
  strategist: Date | null;
}

export async function getAgentLastRuns(): Promise<AgentLastRuns> {
  const userId = await requireUserId();

  const [followers, trend, insight, post, note, strategy] = await Promise.all([
    prisma.followersSnapshot.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
    // TrendSnapshot is global (no userId) — no filtering needed
    prisma.trendSnapshot.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    prisma.dailyInsight.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
    prisma.xPost.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
    prisma.researchNote.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
    prisma.strategyAnalysis.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);

  return {
    followersSnapshot: followers?.createdAt ?? null,
    trendSnapshot: trend?.createdAt ?? null,
    dailyInsight: insight?.createdAt ?? null,
    xImport: post?.createdAt ?? null,
    researcher: note?.createdAt ?? null,
    strategist: strategy?.createdAt ?? null,
  };
}
