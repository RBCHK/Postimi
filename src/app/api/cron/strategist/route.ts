import * as Sentry from "@sentry/nextjs";
import { anthropic } from "@ai-sdk/anthropic";
import { generateText, tool, stepCountIs } from "ai";
import { z } from "zod";
import { tavily } from "@tavily/core";
import { getStrategistPrompt, buildStrategistUserMessage } from "@/prompts/strategist";
import { getAnalyticsSummary, getAnalyticsDateRange } from "@/lib/server/analytics";
import {
  getSocialAnalyticsSummary,
  getSocialAnalyticsDateRange,
} from "@/lib/server/social-analytics";
import { getFollowersHistory } from "@/lib/server/followers";
import { getLatestTrends } from "@/lib/server/trends";
import { getScheduleConfig } from "@/lib/server/schedule";
import { getRecentResearchNotes } from "@/lib/server/research";
import { saveAnalysis, getAnalyses } from "@/lib/server/strategist";
import { savePlanProposal, getAcceptedProposals } from "@/lib/server/plan-proposal";
import { getConnectedPlatforms } from "@/lib/server/platforms";
import { getBenchmarks } from "@/lib/server/benchmarks";
import { getOutputLanguage } from "@/lib/server/user-settings";
import { prisma } from "@/lib/prisma";
import { fetchUserData } from "@/lib/x-api";
import { getXApiTokenForUser } from "@/lib/server/x-token";
import { withCronLogging } from "@/lib/cron-helpers";
import { reserveQuota, completeReservation, failReservation } from "@/lib/ai-quota";
import { PLANS } from "@/lib/plans";
import {
  QuotaExceededError,
  RateLimitExceededError,
  SubscriptionRequiredError,
} from "@/lib/errors";
import { getAudienceSize } from "@/lib/audience-size";
import { DEFAULT_LANGUAGE } from "@/lib/i18n/language-names";
import type {
  AnalyticsSummary,
  ConfigChange,
  CsvSummary,
  FollowersSnapshotItem,
  MetricsSnapshot,
  PastDecisionItem,
  Platform,
  TrendItem,
  XProfile,
} from "@/lib/types";

export const maxDuration = 120;

// ADR-008 Phase 6: Strategist runs per (user × connected platform).
//
// Iteration is sequential (not Promise.all) because each reserveQuota
// opens a Serializable transaction on AiUsage. Running 3 in parallel
// for the same user causes serialization contention.
//
// Per-platform try/catch with Sentry.captureException keeps a failure
// on one platform from killing the other platforms for the same user.
// Quota is charged per platform (3 platforms = 3 reservations).

interface PlatformContext {
  summary: AnalyticsSummary | CsvSummary;
  followersHistory?: FollowersSnapshotItem[];
  trends?: TrendItem[];
  profile?: XProfile;
  latestFollowersCount: number;
}

/**
 * Build the cross-platform strategist inputs for one (user, platform)
 * pair. Returns null if the user has no data for this platform (e.g.
 * Threads token exists but no posts imported yet).
 */
async function buildPlatformContext(
  userId: string,
  platform: Platform
): Promise<PlatformContext | null> {
  if (platform === "X") {
    // X-specific path: still uses the richer AnalyticsSummary shape
    // (reply stats, trends, profile). Post-1b the underlying tables are
    // Social*, but this path stays because it carries X-only signals the
    // plain social summary doesn't expose.
    const dateRange = await getAnalyticsDateRange(userId);
    if (!dateRange) return null;

    const thirtyDaysAgo = new Date(dateRange.to);
    thirtyDaysAgo.setUTCDate(thirtyDaysAgo.getUTCDate() - 30);
    const from30 = new Date(Math.max(thirtyDaysAgo.getTime(), dateRange.from.getTime()));

    const [summary, followersHistory, trends] = await Promise.all([
      getAnalyticsSummary(userId, from30, dateRange.to),
      getFollowersHistory(userId, 30),
      getLatestTrends(userId),
    ]);

    // X profile (non-fatal if API unavailable).
    let profile: XProfile | undefined;
    try {
      const credentials = await getXApiTokenForUser(userId);
      if (credentials) {
        const userData = await fetchUserData(credentials);
        profile = {
          name: "",
          username: credentials.xUsername,
          bio: "",
          followers: String(userData.followersCount),
          following: String(userData.followingCount),
        };
      }
    } catch {
      // X API unavailable — proceed without profile
    }

    const latestFollowersCount = followersHistory[followersHistory.length - 1]?.followersCount ?? 0;

    return { summary, followersHistory, trends, profile, latestFollowersCount };
  }

  // LinkedIn / Threads path: reads from SocialPost / SocialDailyStats /
  // SocialFollowersSnapshot. No X trends, no X profile — those are
  // platform-specific signals we don't synthesize.
  const dateRange = await getSocialAnalyticsDateRange(userId, platform);
  if (!dateRange) return null;

  const thirtyDaysAgo = new Date(dateRange.to);
  thirtyDaysAgo.setUTCDate(thirtyDaysAgo.getUTCDate() - 30);
  const from30 = new Date(Math.max(thirtyDaysAgo.getTime(), dateRange.from.getTime()));

  const socialSummary = await getSocialAnalyticsSummary(userId, platform, from30, dateRange.to);

  // Adapt SocialAnalyticsSummary → CsvSummary for the prompt. CsvSummary
  // is the simpler shape the prompt builder accepts; no synthetic
  // "replies" data for platforms that don't distinguish them.
  const csvSummary: CsvSummary = {
    totalPosts: socialSummary.totalPosts,
    dateRange: socialSummary.dateRange,
    avgImpressions: socialSummary.avgPostImpressions,
    maxImpressions: socialSummary.maxPostImpressions,
    totalNewFollows: socialSummary.totalNewFollows,
    avgEngagementRate: socialSummary.avgEngagementRate,
    topPosts: socialSummary.topPosts.map((p) => ({
      text: p.text,
      impressions: p.impressions,
      engagements: p.engagements,
      likes: p.likes,
    })),
  };

  // Build FollowersSnapshotItem[] from SocialFollowersSnapshot series.
  // followingCount / deltaFollowing aren't in the social schema — zero
  // them out (the prompt only consumes followersCount + delta).
  const followersHistory: FollowersSnapshotItem[] = socialSummary.followersSeries.map((s, i) => ({
    id: `${s.date}-${i}`,
    date: new Date(`${s.date}T00:00:00.000Z`),
    followersCount: s.followersCount,
    followingCount: 0,
    deltaFollowers: s.deltaFollowers,
    deltaFollowing: 0,
  }));

  return {
    summary: csvSummary,
    followersHistory,
    latestFollowersCount: socialSummary.latestFollowers ?? 0,
  };
}

export const GET = withCronLogging("strategist", async () => {
  const tavilyApiKey = process.env.TAVILY_API_KEY;
  if (!tavilyApiKey) {
    throw new Error("TAVILY_API_KEY not configured");
  }

  const users = await prisma.user.findMany({ select: { id: true } });
  const results: {
    userId: string;
    platform?: Platform;
    analysisId?: string;
    proposalId?: string;
    error?: string;
  }[] = [];

  for (const user of users) {
    let connected;
    try {
      connected = await getConnectedPlatforms(user.id);
    } catch (err) {
      Sentry.captureException(err, { tags: { userId: user.id, area: "strategist-cron" } });
      results.push({ userId: user.id, error: "failed-to-load-platforms" });
      continue;
    }

    if (connected.platforms.length === 0) continue;

    // Pull user-scoped context once (language + research + schedule) —
    // these don't vary per platform so we don't re-query inside the loop.
    const outputLanguage = (await getOutputLanguage(user.id)) ?? DEFAULT_LANGUAGE;
    const [researchNotes, scheduleConfig] = await Promise.all([
      getRecentResearchNotes(user.id, 3),
      getScheduleConfig(user.id),
    ]);

    for (const platform of connected.platforms) {
      let reservationId: string | undefined;
      let reservationCompleted = false;
      try {
        const reservation = await reserveQuota({ userId: user.id, operation: "strategist" });
        reservationId = reservation.reservationId;

        const context = await buildPlatformContext(user.id, platform);
        if (!context) {
          // No data for this platform yet — release the reservation and
          // move on. Treating this as "reservation abort" rather than a
          // failure keeps the user's quota intact.
          await failReservation(reservationId);
          reservationCompleted = true;
          continue;
        }

        const [previousAnalyses, acceptedProposals, benchmarks] = await Promise.all([
          getAnalyses(user.id, platform),
          getAcceptedProposals(user.id, 30, platform),
          getBenchmarks(platform, getAudienceSize(context.latestFollowersCount)),
        ]);

        const previousAnalysis = previousAnalyses[0]?.recommendation ?? undefined;

        const weekStart = new Date().toISOString().split("T")[0]!;

        const summary = context.summary;
        // Derive MetricsSnapshot from whichever summary shape we got.
        const isAnalyticsSummary = "totalReplies" in summary;
        const avgImpressions = isAnalyticsSummary
          ? summary.avgPostImpressions
          : summary.avgImpressions;
        const periodDaysSafe = isAnalyticsSummary ? Math.max(summary.periodDays / 7, 1) : 1;
        const engagementRate = summary.avgEngagementRate;
        const currentMetrics: MetricsSnapshot = {
          avgImpressions,
          newFollowersPerWeek: Math.round(summary.totalNewFollows / periodDaysSafe),
          engagementRate,
          date: weekStart,
        };

        const pastDecisions: PastDecisionItem[] = acceptedProposals
          .filter((p) => p.proposalType === "config" && p.metricsSnapshot)
          .map((p) => ({
            date: p.createdAt.toISOString().split("T")[0],
            changes: p.changes as ConfigChange[],
            rationale: p.summary,
            metricsAtDecision: p.metricsSnapshot!,
          }));

        const userMessage = buildStrategistUserMessage(
          summary,
          weekStart,
          context.profile,
          context.followersHistory,
          context.trends,
          undefined,
          researchNotes.map((n) => ({ topic: n.topic, summary: n.summary })),
          previousAnalysis,
          scheduleConfig ?? undefined,
          pastDecisions,
          platform,
          benchmarks
        );

        const tavilyClient = tavily({ apiKey: tavilyApiKey });
        const searchQueries: string[] = [];

        const strategistModel = "claude-sonnet-4-6";
        const result = await generateText({
          model: anthropic(strategistModel),
          maxOutputTokens: PLANS.pro.maxOutputTokensPerRequest,
          system: getStrategistPrompt(platform, outputLanguage),
          messages: [{ role: "user", content: userMessage }],
          tools: {
            webSearch: tool({
              description:
                "Search the web for social-media growth strategies, algorithm updates, best posting times, engagement tactics — adapt to the platform in the system prompt.",
              inputSchema: z.object({
                query: z.string().describe("Search query"),
              }),
              execute: async ({ query }) => {
                searchQueries.push(query);
                const response = await tavilyClient.search(query, {
                  maxResults: 5,
                  searchDepth: "basic",
                });
                return response.results.map((r) => ({
                  title: r.title,
                  url: r.url,
                  snippet: r.content?.slice(0, 500) ?? "",
                }));
              },
            }),
          },
          stopWhen: stepCountIs(10),
        });

        const text = result.text;

        await completeReservation({
          reservationId,
          model: strategistModel,
          tokensIn: result.usage.inputTokens ?? 0,
          tokensOut: result.usage.outputTokens ?? 0,
        });
        reservationCompleted = true;

        // CsvSummary-compatible snapshot for the analysis row.
        const savedCsvSummary: CsvSummary = isAnalyticsSummary
          ? {
              totalPosts: summary.totalPosts + summary.totalReplies,
              dateRange: summary.dateRange,
              avgImpressions: summary.avgPostImpressions,
              maxImpressions: summary.maxPostImpressions,
              totalNewFollows: summary.totalNewFollows,
              avgEngagementRate: summary.avgEngagementRate,
              topPosts: summary.topPosts.slice(0, 5).map((p) => ({
                text: p.text.slice(0, 200),
                impressions: p.impressions,
                engagements: p.engagements,
                likes: p.likes,
              })),
            }
          : {
              totalPosts: summary.totalPosts,
              dateRange: summary.dateRange,
              avgImpressions: summary.avgImpressions,
              maxImpressions: summary.maxImpressions,
              totalNewFollows: summary.totalNewFollows,
              avgEngagementRate: summary.avgEngagementRate,
              topPosts: summary.topPosts.slice(0, 5).map((p) => ({
                text: p.text.slice(0, 200),
                impressions: p.impressions,
                engagements: p.engagements,
                likes: p.likes,
              })),
            };

        const saved = await saveAnalysis(user.id, {
          platform,
          csvSummary: savedCsvSummary,
          searchQueries,
          recommendation: text,
          weekStart: new Date(),
          autoGenerated: true,
        });

        // Parse config-proposal — platform-scoped so LinkedIn proposals
        // don't end up in the X planner.
        let proposalId: string | undefined;
        const proposalMatch = text.match(/```json:config-proposal\s*([\s\S]*?)```/);
        if (proposalMatch?.[1]) {
          try {
            const changes: ConfigChange[] = JSON.parse(proposalMatch[1].trim());
            if (Array.isArray(changes) && changes.length > 0) {
              const summaryMatch =
                text.match(/##[^#\n]*Strategy[^#\n]*\n([\s\S]{0,300})/i) ??
                text.match(/##[^#\n]*Стратегия[^#\n]*\n([\s\S]{0,300})/i);
              const proposalSummary =
                summaryMatch?.[1]?.trim().slice(0, 300) ??
                `Schedule template updates (${changes.length}) for ${platform} — ${weekStart}`;

              const proposal = await savePlanProposal(user.id, {
                platform,
                changes,
                summary: proposalSummary,
                analysisId: saved.id,
                proposalType: "config",
                metricsSnapshot: currentMetrics,
              });
              proposalId = proposal.id;
            }
          } catch (parseErr) {
            // JSON parse failure on model output is not a critical-path
            // error (analysis was saved), but we still capture to Sentry
            // so we notice systemic prompt regressions.
            Sentry.captureException(parseErr, {
              tags: { userId: user.id, platform, area: "strategist-proposal-parse" },
            });
          }
        }

        results.push({ userId: user.id, platform, analysisId: saved.id, proposalId });
      } catch (err) {
        if (reservationId && !reservationCompleted) await failReservation(reservationId);

        if (
          err instanceof SubscriptionRequiredError ||
          err instanceof QuotaExceededError ||
          err instanceof RateLimitExceededError
        ) {
          // Billing/rate-limit is a surface the user can control. We
          // still capture to Sentry as a *warning* (not a silent skip)
          // so we can see quota-exhausted patterns in aggregate.
          Sentry.captureMessage(`strategist skipped: ${err.name}`, {
            level: "warning",
            tags: { userId: user.id, platform, errorName: err.name },
          });
          results.push({ userId: user.id, platform, error: err.name });
          continue;
        }

        Sentry.captureException(err, { tags: { userId: user.id, platform } });
        results.push({
          userId: user.id,
          platform,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  const hasErrors = results.some((r) => r.error);
  return {
    status: hasErrors ? "PARTIAL" : "SUCCESS",
    data: { results },
  };
});
