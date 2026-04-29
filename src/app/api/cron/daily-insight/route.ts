import * as Sentry from "@sentry/nextjs";
import { anthropic } from "@ai-sdk/anthropic";
import { generateObject, NoObjectGeneratedError } from "ai";
import {
  DAILY_INSIGHT_CARDS_SCHEMA,
  buildDailyInsightUserMessage,
  getDailyInsightPrompt,
  type PerPlatformContext,
} from "@/prompts/daily-insight";
import { prisma } from "@/lib/prisma";
import { saveDailyInsight } from "@/lib/server/daily-insight";
import { getLatestTrends } from "@/lib/server/trends";
import { getLatestFollowersSnapshot } from "@/lib/server/followers";
import { getRecentResearchNotes } from "@/lib/server/research";
import { getConnectedPlatforms } from "@/lib/server/platforms";
import { excludeSystemUser } from "@/lib/server/system-user";
import { getOutputLanguage } from "@/lib/server/user-settings";
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
import { DEFAULT_LANGUAGE, languageName } from "@/lib/i18n/language-names";
import type {
  DailyInsightCards,
  DailyInsightContext,
  DailyInsightPayload,
  Platform,
} from "@/lib/types";

export const maxDuration = 30;

const STATS_DAYS = 7;

/**
 * Per-platform context build. Wrapped in `Promise.allSettled` at the
 * caller — one rejected sub-fetch (e.g. Trends API down) shouldn't
 * abort the user's whole insight; we degrade and Sentry the failure.
 */
async function buildPlatformContext(
  userId: string,
  platform: Platform
): Promise<PerPlatformContext> {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - STATS_DAYS);

  const [statsResult, strategyResult, followersResult, notesResult, trendsResult] =
    await Promise.allSettled([
      prisma.socialDailyStats.findMany({
        where: { userId, platform, date: { gte: sevenDaysAgo } },
        orderBy: { date: "desc" },
      }),
      prisma.strategyAnalysis.findFirst({
        where: { userId, platform },
        orderBy: { createdAt: "desc" },
      }),
      // followers snapshot helper is X-only today — for other platforms
      // pull the latest SocialFollowersSnapshot row directly.
      platform === "X"
        ? getLatestFollowersSnapshot(userId)
        : prisma.socialFollowersSnapshot.findFirst({
            where: { userId, platform },
            orderBy: { date: "desc" },
          }),
      getRecentResearchNotes(userId, platform, 3),
      // Trends are X-only by design (other platforms have no trend feed).
      platform === "X" ? getLatestTrends(userId) : Promise.resolve([]),
    ]);

  if (statsResult.status === "rejected") {
    Sentry.captureException(statsResult.reason, {
      tags: { area: "daily-insight", userId, platform, subtask: "stats" },
    });
  }
  if (strategyResult.status === "rejected") {
    Sentry.captureException(strategyResult.reason, {
      tags: { area: "daily-insight", userId, platform, subtask: "strategy" },
    });
  }
  if (followersResult.status === "rejected") {
    Sentry.captureException(followersResult.reason, {
      tags: { area: "daily-insight", userId, platform, subtask: "followers" },
    });
  }
  if (notesResult.status === "rejected") {
    Sentry.captureException(notesResult.reason, {
      tags: { area: "daily-insight", userId, platform, subtask: "notes" },
    });
  }
  if (trendsResult.status === "rejected") {
    Sentry.captureException(trendsResult.reason, {
      tags: { area: "daily-insight", userId, platform, subtask: "trends" },
    });
  }

  const stats = statsResult.status === "fulfilled" ? statsResult.value : [];
  const strategy = strategyResult.status === "fulfilled" ? strategyResult.value : null;
  const followersRow = followersResult.status === "fulfilled" ? followersResult.value : null;
  const researchNotes = notesResult.status === "fulfilled" ? notesResult.value : [];
  const trends = trendsResult.status === "fulfilled" ? trendsResult.value : [];

  return {
    platform,
    recentStats: stats.map((d) => ({
      date: d.date.toISOString().split("T")[0]!,
      impressions: d.impressions,
      newFollows: d.newFollows,
      unfollows: d.unfollows,
      profileVisits: d.profileVisits,
      engagements: d.engagements,
    })),
    latestFollowers: followersRow
      ? {
          id: "id" in followersRow ? followersRow.id : `${userId}-${platform}-current`,
          date: followersRow.date,
          followersCount: followersRow.followersCount,
          followingCount: followersRow.followingCount ?? 0,
          deltaFollowers: followersRow.deltaFollowers,
          deltaFollowing: followersRow.deltaFollowing ?? 0,
        }
      : null,
    strategyRecommendation: strategy?.recommendation ?? null,
    researchNotes: researchNotes.map((n) => ({ topic: n.topic, summary: n.summary })),
    trends: platform === "X" ? trends : undefined,
  };
}

export const GET = withCronLogging("daily-insight", async () => {
  await sweepStaleReservations().catch((err) =>
    Sentry.captureException(err, { tags: { area: "ai-quota", step: "sweep" } })
  );
  const users = await prisma.user.findMany({
    where: excludeSystemUser(),
    select: { id: true },
  });
  const results: { userId: string; insightId?: string; error?: string }[] = [];

  for (const user of users) {
    let reservationId: string | undefined;
    let reservationCompleted = false;
    try {
      const reservation = await reserveQuota({ userId: user.id, operation: "daily_insight" });
      reservationId = reservation.reservationId;

      const connected = await getConnectedPlatforms(user.id);
      const outputLang = (await getOutputLanguage(user.id)) ?? DEFAULT_LANGUAGE;

      // Build per-platform context for every connected platform in
      // parallel. One platform's failure during sub-fetches is logged
      // (per buildPlatformContext) but doesn't drop the platform from
      // the prompt — the model just sees an empty stats section.
      const perPlatformContexts = await Promise.all(
        connected.platforms.map((p) => buildPlatformContext(user.id, p))
      );

      const insightModel = "claude-sonnet-4-6";
      let cards: DailyInsightCards;
      try {
        const result = await generateObject({
          model: anthropic(insightModel),
          maxOutputTokens: PLANS.pro.maxOutputTokensPerRequest,
          schema: DAILY_INSIGHT_CARDS_SCHEMA,
          system: getDailyInsightPrompt({
            outputLanguageName: languageName(outputLang),
            connectedPlatforms: connected.platforms,
          }),
          prompt: buildDailyInsightUserMessage(perPlatformContexts),
        });

        await completeReservation({
          reservationId,
          model: insightModel,
          tokensIn: result.usage.inputTokens ?? 0,
          tokensOut: result.usage.outputTokens ?? 0,
        });
        reservationCompleted = true;

        cards = result.object;
      } catch (err) {
        if (err instanceof NoObjectGeneratedError) {
          // Schema-fit failure after the SDK's retries. Save a minimal
          // fallback so the UI still renders something. Cap the headline
          // length so a runaway model can't hose the home page.
          Sentry.captureMessage("daily-insight schema-fit failed", {
            level: "warning",
            tags: { area: "daily-insight", userId: user.id, model: insightModel },
            extra: { connectedCount: connected.platforms.length },
          });
          cards = {
            headline: (err.text ?? "Today is a quiet day — keep your rhythm.").slice(0, 500),
            tactical: [],
            opportunity: null,
            warning: null,
            encouragement: null,
          };
          // Reservation still got token usage — close it with rough usage.
          // Real usage is in `err.usage` if the SDK populated it.
          if (!reservationCompleted && reservationId) {
            await completeReservation({
              reservationId,
              model: insightModel,
              tokensIn: err.usage?.inputTokens ?? 0,
              tokensOut: err.usage?.outputTokens ?? 0,
            });
            reservationCompleted = true;
          }
        } else {
          throw err;
        }
      }

      const context: DailyInsightContext = {
        strategyAnalysisIds: Object.fromEntries(
          await Promise.all(
            perPlatformContexts.map(async (ctx) => {
              const sa = await prisma.strategyAnalysis.findFirst({
                where: { userId: user.id, platform: ctx.platform },
                orderBy: { createdAt: "desc" },
                select: { id: true },
              });
              return [ctx.platform, sa?.id] as const;
            })
          ).then((rows) => rows.filter(([, id]) => id !== undefined && id !== null))
        ) as Partial<Record<Platform, string>>,
        researchNoteIds: perPlatformContexts.flatMap((ctx) =>
          // Research notes are denormalized into the prompt; we record
          // the topics that landed in the prompt for traceability. If
          // we ever need exact note IDs we'd thread them through
          // PerPlatformContext, but that's coupling the prompt builder
          // to DB IDs unnecessarily.
          ctx.researchNotes.map((n) => `${ctx.platform}:${n.topic.slice(0, 60)}`)
        ),
        daysOfStatsByPlatform: Object.fromEntries(
          perPlatformContexts.map((ctx) => [ctx.platform, ctx.recentStats.length] as const)
        ) as Partial<Record<Platform, number>>,
      };

      const saved = await saveDailyInsight(user.id, {
        date: new Date(),
        insights: cards as DailyInsightPayload,
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
      Sentry.captureException(err, {
        tags: { area: "daily-insight", userId: user.id },
      });
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
