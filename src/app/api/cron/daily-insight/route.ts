import { NextRequest, NextResponse } from "next/server";
import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import {
  getDailyInsightPrompt,
  buildDailyInsightUserMessage,
} from "@/prompts/daily-insight";
import { prisma } from "@/lib/prisma";
import { saveDailyInsight } from "@/app/actions/daily-insight";
import { getLatestTrends } from "@/app/actions/trends";
import { getLatestFollowersSnapshot } from "@/app/actions/followers";
import type { DailyInsightContext } from "@/lib/types";

export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
  // 1. Latest StrategyAnalysis
  const latestStrategy = await prisma.strategyAnalysis.findFirst({
    orderBy: { createdAt: "desc" },
  });

  // 2. Last 3 ResearchNotes
  const researchNotes = await prisma.researchNote.findMany({
    orderBy: { createdAt: "desc" },
    take: 3,
  });

  // 3. Last 7 days of DailyAccountStats
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const recentStats = await prisma.dailyAccountStats.findMany({
    where: { date: { gte: sevenDaysAgo } },
    orderBy: { date: "desc" },
  });

  // 4. Latest trends and followers snapshot
  const [trends, latestFollowers] = await Promise.all([
    getLatestTrends(),
    getLatestFollowersSnapshot(),
  ]);

  // 4. Generate insights with Haiku
  let result: Awaited<ReturnType<typeof generateText>>;
  try {
    result = await generateText({
      model: anthropic("claude-haiku-4-5-20251001"),
      system: getDailyInsightPrompt(),
      messages: [
        {
          role: "user",
          content: buildDailyInsightUserMessage(
            latestStrategy?.recommendation ?? null,
            researchNotes.map((n) => ({
              topic: n.topic,
              summary: n.summary,
            })),
            recentStats.map((d) => ({
              date: d.date.toISOString().split("T")[0],
              impressions: d.impressions,
              newFollows: d.newFollows,
              unfollows: d.unfollows,
              profileVisits: d.profileVisits,
              engagements: d.engagements,
            })),
            trends,
            latestFollowers
          ),
        },
      ],
    });
  } catch (e) {
    console.error("[daily-insight] generateText failed:", e);
    return NextResponse.json(
      { error: "AI generation failed", details: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }

  // 5. Parse JSON array from response
  let insights: string[];
  try {
    const parsed = JSON.parse(result.text.trim());
    if (!Array.isArray(parsed) || parsed.length !== 5) {
      throw new Error("Expected array of 5 strings");
    }
    insights = parsed.map((s: unknown) => String(s));
  } catch {
    // Fallback: extract JSON array from text
    const match = result.text.match(/\[[\s\S]*\]/);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        insights = parsed.map((s: unknown) => String(s));
      } catch {
        return NextResponse.json(
          { error: "Failed to parse insights", raw: result.text },
          { status: 500 }
        );
      }
    } else {
      return NextResponse.json(
        { error: "Failed to parse insights", raw: result.text },
        { status: 500 }
      );
    }
  }

  // 6. Save to DB
  const context: DailyInsightContext = {
    strategyAnalysisId: latestStrategy?.id ?? null,
    researchNoteIds: researchNotes.map((n) => n.id),
    daysOfStats: recentStats.length,
  };

  const saved = await saveDailyInsight({
    date: new Date(),
    insights,
    context,
  });

  return NextResponse.json({
    ok: true,
    insightId: saved.id,
    insightCount: insights.length,
  });
  } catch (err) {
    console.error("[daily-insight]", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
