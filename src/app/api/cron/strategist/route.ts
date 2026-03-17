import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { anthropic } from "@ai-sdk/anthropic";
import { generateText, tool, stepCountIs } from "ai";
import { z } from "zod";
import { tavily } from "@tavily/core";
import { getStrategistPrompt, buildStrategistUserMessage } from "@/prompts/strategist";
import {
  getAnalyticsSummaryInternal,
  getAnalyticsDateRangeInternal,
} from "@/app/actions/analytics";
import { getFollowersHistoryInternal } from "@/app/actions/followers";
import { getLatestTrendsInternal } from "@/app/actions/trends";
import { getGoalTrackingDataInternal, getScheduleConfigInternal } from "@/app/actions/schedule";
import { getRecentResearchNotesInternal } from "@/app/actions/research";
import { saveAnalysisInternal, getAnalysesInternal } from "@/app/actions/strategist";
import {
  savePlanProposalInternal,
  getAcceptedProposalsInternal,
} from "@/app/actions/plan-proposal";
import { prisma } from "@/lib/prisma";
import { fetchUserData } from "@/lib/x-api";
import type { ConfigChange, MetricsSnapshot, PastDecisionItem } from "@/lib/types";

export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tavilyApiKey = process.env.TAVILY_API_KEY;
  if (!tavilyApiKey) {
    return NextResponse.json({ error: "TAVILY_API_KEY not configured" }, { status: 500 });
  }

  try {
    const users = await prisma.user.findMany({ select: { id: true } });
    const results: { userId: string; analysisId?: string; proposalId?: string; error?: string }[] =
      [];

    for (const user of users) {
      try {
        // 1. Collect context in parallel
        const dateRange = await getAnalyticsDateRangeInternal(user.id);
        if (!dateRange) continue; // skip users with no analytics data

        const thirtyDaysAgo = new Date(dateRange.to);
        thirtyDaysAgo.setUTCDate(thirtyDaysAgo.getUTCDate() - 30);
        const from30 = new Date(Math.max(thirtyDaysAgo.getTime(), dateRange.from.getTime()));

        const [
          summary,
          followersHistory,
          trends,
          researchNotes,
          goalData,
          previousAnalyses,
          scheduleConfig,
          acceptedProposals,
        ] = await Promise.all([
          getAnalyticsSummaryInternal(user.id, from30, dateRange.to),
          getFollowersHistoryInternal(user.id, 30),
          getLatestTrendsInternal(),
          getRecentResearchNotesInternal(user.id, 3),
          getGoalTrackingDataInternal(user.id),
          getAnalysesInternal(user.id),
          getScheduleConfigInternal(user.id),
          getAcceptedProposalsInternal(user.id, 30),
        ]);

        // 2. Auto-fetch profile from X API (non-fatal if fails)
        let profile:
          | { name: string; username: string; bio: string; followers: string; following: string }
          | undefined;
        try {
          const userData = await fetchUserData();
          profile = {
            name: "",
            username: "",
            bio: "",
            followers: String(userData.followersCount),
            following: String(userData.followingCount),
          };
        } catch {
          // X API unavailable — proceed without profile
        }

        // 3. Previous strategy
        const previousAnalysis = previousAnalyses[0]?.recommendation ?? undefined;

        // 4. Build week start string
        const weekStart = new Date().toISOString().split("T")[0]!;

        const currentMetrics: MetricsSnapshot = {
          avgImpressions: summary.avgPostImpressions,
          newFollowersPerWeek: Math.round(
            summary.totalNewFollows / Math.max(summary.periodDays / 7, 1)
          ),
          engagementRate: summary.avgEngagementRate,
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

        // 5. Build user message
        const userMessage = buildStrategistUserMessage(
          summary,
          weekStart,
          profile,
          followersHistory,
          trends,
          undefined,
          researchNotes.map((n) => ({ topic: n.topic, summary: n.summary })),
          previousAnalysis,
          goalData ?? undefined,
          scheduleConfig ?? undefined,
          pastDecisions
        );

        // 6. Run analysis with Tavily web search
        const tavilyClient = tavily({ apiKey: tavilyApiKey });
        const searchQueries: string[] = [];

        const result = await generateText({
          model: anthropic("claude-sonnet-4-6"),
          system: getStrategistPrompt(),
          messages: [{ role: "user", content: userMessage }],
          tools: {
            webSearch: tool({
              description:
                "Search the web for X/Twitter growth strategies, algorithm updates, best posting times, engagement tactics",
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

        // 7. Build CsvSummary-compatible object
        const csvSummary = {
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
        };

        // 8. Save analysis
        const saved = await saveAnalysisInternal(user.id, {
          csvSummary,
          searchQueries,
          recommendation: text,
          weekStart: new Date(),
          autoGenerated: true,
        });

        // 9. Parse config-proposal and save PlanProposal if found
        let proposalId: string | undefined;
        const proposalMatch = text.match(/```json:config-proposal\s*([\s\S]*?)```/);
        if (proposalMatch?.[1]) {
          try {
            const changes: ConfigChange[] = JSON.parse(proposalMatch[1].trim());
            if (Array.isArray(changes) && changes.length > 0) {
              const summaryMatch =
                text.match(/##[^#\n]*Стратегия[^#\n]*\n([\s\S]{0,300})/i) ??
                text.match(/##[^#\n]*Strategy[^#\n]*\n([\s\S]{0,300})/i);
              const proposalSummary =
                summaryMatch?.[1]?.trim().slice(0, 300) ??
                `Изменения в шаблон расписания (${changes.length} шт.) от ${weekStart}`;

              const proposal = await savePlanProposalInternal(user.id, {
                changes,
                summary: proposalSummary,
                analysisId: saved.id,
                proposalType: "config",
                metricsSnapshot: currentMetrics,
              });
              proposalId = proposal.id;
            }
          } catch {
            // JSON parse failed — skip proposal silently
          }
        }

        results.push({ userId: user.id, analysisId: saved.id, proposalId });
      } catch (err) {
        Sentry.captureException(err);
        console.error(`[strategist] user=${user.id}`, err);
        results.push({
          userId: user.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return NextResponse.json({ ok: true, results });
  } catch (err) {
    Sentry.captureException(err);
    console.error("[strategist]", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
