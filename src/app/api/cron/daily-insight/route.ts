import * as Sentry from "@sentry/nextjs";
import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import { getDailyInsightPrompt, buildDailyInsightUserMessage } from "@/prompts/daily-insight";
import { prisma } from "@/lib/prisma";
import { saveDailyInsightInternal } from "@/app/actions/daily-insight";
import { getLatestTrendsInternal } from "@/app/actions/trends";
import { getLatestFollowersSnapshotInternal } from "@/app/actions/followers";
import { withCronLogging } from "@/lib/cron-helpers";
import {
  reserveQuota,
  completeReservation,
  failReservation,
  sweepStaleReservations,
} from "@/lib/ai-quota";
import { PLANS } from "@/lib/plans";
import {
  QuotaExceededError,
  RateLimitExceededError,
  SubscriptionRequiredError,
} from "@/lib/errors";
import type { DailyInsightContext } from "@/lib/types";

export const maxDuration = 30;

export const GET = withCronLogging("daily-insight", async () => {
  await sweepStaleReservations().catch((err) =>
    Sentry.captureException(err, { tags: { area: "ai-quota", step: "sweep" } })
  );
  const users = await prisma.user.findMany({ select: { id: true } });
  const results: { userId: string; insightId?: string; error?: string }[] = [];

  for (const user of users) {
    let reservationId: string | undefined;
    let reservationCompleted = false;
    try {
      const reservation = await reserveQuota({ userId: user.id, operation: "daily_insight" });
      reservationId = reservation.reservationId;

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

      // 3. Last 7 days of daily stats (X-platform only — daily-insight
      //    is X-specific today. Phase 1b moved this off the legacy
      //    DailyAccountStats onto SocialDailyStats.)
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 7);
      const recentStats = await prisma.socialDailyStats.findMany({
        where: { userId: user.id, platform: "X", date: { gte: sevenDaysAgo } },
        orderBy: { date: "desc" },
      });

      // 4. Latest trends and followers snapshot
      const [trends, latestFollowers] = await Promise.all([
        getLatestTrendsInternal(user.id),
        getLatestFollowersSnapshotInternal(user.id),
      ]);

      // 5. Generate insights with Haiku
      const insightModel = "claude-haiku-4-5-20251001";
      const result = await generateText({
        model: anthropic(insightModel),
        maxOutputTokens: PLANS.pro.maxOutputTokensPerRequest,
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

      await completeReservation({
        reservationId,
        model: insightModel,
        tokensIn: result.usage.inputTokens ?? 0,
        tokensOut: result.usage.outputTokens ?? 0,
      });
      reservationCompleted = true;

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
      if (reservationId && !reservationCompleted) await failReservation(reservationId);
      if (
        err instanceof SubscriptionRequiredError ||
        err instanceof QuotaExceededError ||
        err instanceof RateLimitExceededError
      ) {
        console.log(`[daily-insight] skip user=${user.id}: ${err.name}`);
        results.push({ userId: user.id, error: err.name });
        continue;
      }
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
