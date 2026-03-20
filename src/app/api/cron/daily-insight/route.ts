import * as Sentry from "@sentry/nextjs";
import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import { getDailyInsightPrompt, buildDailyInsightUserMessage } from "@/prompts/daily-insight";
import { prisma } from "@/lib/prisma";
import { saveDailyInsightInternal } from "@/app/actions/daily-insight";
import { getLatestTrendsInternal } from "@/app/actions/trends";
import { getLatestFollowersSnapshotInternal } from "@/app/actions/followers";
import { withCronLogging } from "@/lib/cron-helpers";
import type { DailyInsightContext } from "@/lib/types";

export const maxDuration = 30;

export const GET = withCronLogging("daily-insight", async () => {
  const users = await prisma.user.findMany({ select: { id: true } });
  const results: { userId: string; insightId?: string; error?: string }[] = [];

  for (const user of users) {
    try {
      // 1. Latest StrategyAnalysis
      const latestStrategy = await prisma.strategyAnalysis.findFirst({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
      });

      // 2. Last 3 ResearchNotes
      const researchNotes = await prisma.researchNote.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        take: 3,
      });

      // 3. Last 7 days of DailyAccountStats
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 7);
      const recentStats = await prisma.dailyAccountStats.findMany({
        where: { userId: user.id, date: { gte: sevenDaysAgo } },
        orderBy: { date: "desc" },
      });

      // 4. Latest trends and followers snapshot
      const [trends, latestFollowers] = await Promise.all([
        getLatestTrendsInternal(user.id),
        getLatestFollowersSnapshotInternal(user.id),
      ]);

      // 5. Generate insights with Haiku
      const result = await generateText({
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

      // 6. Parse JSON array from response
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
        if (!match) {
          throw new Error(`Failed to parse insights from: ${result.text}`);
        }
        const parsed = JSON.parse(match[0]);
        insights = parsed.map((s: unknown) => String(s));
      }

      // 7. Save to DB
      const context: DailyInsightContext = {
        strategyAnalysisId: latestStrategy?.id ?? null,
        researchNoteIds: researchNotes.map((n) => n.id),
        daysOfStats: recentStats.length,
      };

      const saved = await saveDailyInsightInternal(user.id, {
        date: new Date(),
        insights,
        context,
      });

      results.push({ userId: user.id, insightId: saved.id });
    } catch (err) {
      Sentry.captureException(err);
      console.error(`[daily-insight] user=${user.id}`, err);
      results.push({
        userId: user.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const hasErrors = results.some((r) => r.error);
  return {
    status: hasErrors ? "PARTIAL" : "SUCCESS",
    data: { results },
  };
});
