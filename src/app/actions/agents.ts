"use server";

import { headers } from "next/headers";
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
    prisma.followersSnapshot.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    prisma.trendSnapshot.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    prisma.dailyInsight.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    prisma.xPost.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    prisma.researchNote.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    prisma.strategyAnalysis.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
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

const AGENT_PATHS: Record<string, string> = {
  followersSnapshot: "/api/cron/followers-snapshot",
  trendSnapshot:     "/api/cron/trend-snapshot",
  dailyInsight:      "/api/cron/daily-insight",
  xImport:           "/api/cron/x-import",
  researcher:        "/api/cron/researcher",
  strategist:        "/api/cron/strategist",
};

export async function runAgentManually(key: string): Promise<{ ok: boolean; error?: string }> {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return { ok: false, error: "CRON_SECRET not configured" };

  const path = AGENT_PATHS[key];
  if (!path) return { ok: false, error: "Unknown agent" };

  const headersList = await headers();
  const host = headersList.get("host") ?? "localhost:3000";
  const protocol = host.includes("localhost") ? "http" : "https";

  const res = await fetch(`${protocol}://${host}${path}`, {
    headers: { Authorization: `Bearer ${cronSecret}` },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => `HTTP ${res.status}`);
    return { ok: false, error: body };
  }

  return { ok: true };
}
