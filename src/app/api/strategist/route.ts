import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { anthropic } from "@ai-sdk/anthropic";
import { streamText, tool, stepCountIs } from "ai";
import { z } from "zod";
import { tavily } from "@tavily/core";
import { getStrategistPrompt, buildStrategistUserMessage } from "@/prompts/strategist";
import { getScheduleConfig } from "@/app/actions/schedule";
import { getAcceptedProposals } from "@/app/actions/plan-proposal";
import type {
  ConfigChange,
  CsvSummary,
  MetricsSnapshot,
  PastDecisionItem,
  XProfile,
} from "@/lib/types";

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const {
    csvSummary,
    weekStart,
    profile,
    model: modelParam,
  }: { csvSummary: CsvSummary; weekStart: string; profile?: XProfile; model?: string } = body;

  if (!csvSummary || !weekStart) {
    return NextResponse.json({ error: "Missing csvSummary or weekStart" }, { status: 400 });
  }

  const ALLOWED_MODELS = ["claude-sonnet-4-6", "claude-haiku-4-5-20251001"] as const;
  type AllowedModel = (typeof ALLOWED_MODELS)[number];
  const model: AllowedModel = ALLOWED_MODELS.includes(modelParam as AllowedModel)
    ? (modelParam as AllowedModel)
    : "claude-sonnet-4-6";

  const tavilyApiKey = process.env.TAVILY_API_KEY;
  if (!tavilyApiKey) {
    return NextResponse.json({ error: "TAVILY_API_KEY is not configured" }, { status: 500 });
  }

  // Load context for self-improvement loop
  const [scheduleConfig, acceptedProposals] = await Promise.all([
    getScheduleConfig(),
    getAcceptedProposals(30),
  ]);

  const currentMetrics: MetricsSnapshot = {
    avgImpressions: csvSummary.avgImpressions,
    newFollowersPerWeek: csvSummary.totalNewFollows,
    engagementRate: csvSummary.avgEngagementRate,
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

  void currentMetrics; // captured for future: pass to savePlanProposal from context onFinish

  const tavilyClient = tavily({ apiKey: tavilyApiKey });

  const result = streamText({
    model: anthropic(model),
    system: getStrategistPrompt(),
    messages: [
      {
        role: "user",
        content: buildStrategistUserMessage(
          csvSummary,
          weekStart,
          profile,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          scheduleConfig ?? undefined,
          pastDecisions
        ),
      },
    ],
    tools: {
      webSearch: tool({
        description:
          "Search the web for X/Twitter growth strategies, algorithm updates, posting tactics, or engagement research",
        inputSchema: z.object({
          query: z.string().describe("Search query"),
        }),
        execute: async ({ query }: { query: string }) => {
          console.log("[strategist] webSearch:", query);
          const response = await tavilyClient.search(query, {
            maxResults: 5,
            searchDepth: "basic",
          });
          return response.results.map((r) => ({
            title: r.title,
            url: r.url,
            content: r.content?.slice(0, 500) ?? "",
          }));
        },
      }),
    },
    stopWhen: stepCountIs(8),
  });

  return result.toUIMessageStreamResponse();
}
