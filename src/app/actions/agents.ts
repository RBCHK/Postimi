"use server";

import { prisma } from "@/lib/prisma";

export interface AgentLastRuns {
  followersSnapshot: Date | null;
  trendSnapshot: Date | null;
  dailyInsight: Date | null;
  xImport: Date | null;
  researcher: Date | null;
  strategist: Date | null;
}

export async function getAgentLastRuns(): Promise<AgentLastRuns> {
  const [followers, trend, insight, post, note, strategy] = await Promise.all([
    prisma.followersSnapshot.findFirst({
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
    prisma.trendSnapshot.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    prisma.dailyInsight.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    prisma.xPost.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    prisma.researchNote.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    prisma.strategyAnalysis.findFirst({
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
