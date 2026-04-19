import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { anthropic } from "@ai-sdk/anthropic";
import { streamText, tool, stepCountIs } from "ai";
import { z } from "zod";
import { tavily } from "@tavily/core";
import { getStrategistPrompt, buildStrategistUserMessage } from "@/prompts/strategist";
import { getScheduleConfig } from "@/lib/server/schedule";
import { getAcceptedProposals } from "@/lib/server/plan-proposal";
import { getBenchmarks } from "@/lib/server/benchmarks";
import { getOutputLanguage } from "@/lib/server/user-settings";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/prisma";
import {
  reserveQuota,
  completeReservation,
  abortReservation,
  failReservation,
} from "@/lib/ai-quota";
import { PLANS } from "@/lib/plans";
import {
  QuotaExceededError,
  RateLimitExceededError,
  SubscriptionRequiredError,
} from "@/lib/errors";
import { getAudienceSize } from "@/lib/audience-size";
import { DEFAULT_LANGUAGE } from "@/lib/i18n/language-names";
import { PLATFORMS } from "@/lib/types";
import type {
  ConfigChange,
  CsvSummary,
  MetricsSnapshot,
  PastDecisionItem,
  Platform,
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
    platform: platformParam,
  }: {
    csvSummary: CsvSummary;
    weekStart: string;
    profile?: XProfile;
    model?: string;
    platform?: string;
  } = body;

  if (!csvSummary || !weekStart) {
    return NextResponse.json({ error: "Missing csvSummary or weekStart" }, { status: 400 });
  }

  // Platform defaults to X for backward compat. Validate against the
  // enum so a malicious caller can't pass e.g. "X; DROP TABLE" as a
  // Prisma filter value later.
  const platform: Platform = PLATFORMS.includes(platformParam as Platform)
    ? (platformParam as Platform)
    : "X";

  const ALLOWED_MODELS = ["claude-sonnet-4-6", "claude-haiku-4-5-20251001"] as const;
  type AllowedModel = (typeof ALLOWED_MODELS)[number];
  const model: AllowedModel = ALLOWED_MODELS.includes(modelParam as AllowedModel)
    ? (modelParam as AllowedModel)
    : "claude-sonnet-4-6";

  const tavilyApiKey = process.env.TAVILY_API_KEY;
  if (!tavilyApiKey) {
    return NextResponse.json({ error: "TAVILY_API_KEY is not configured" }, { status: 500 });
  }

  const dbUser = await prisma.user.findUnique({ where: { clerkId }, select: { id: true } });
  if (!dbUser) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  let reservationId: string;
  try {
    const reservation = await reserveQuota({ userId: dbUser.id, operation: "strategist" });
    reservationId = reservation.reservationId;
  } catch (err) {
    if (err instanceof SubscriptionRequiredError) {
      return NextResponse.json({ error: "subscription_required" }, { status: 402 });
    }
    if (err instanceof QuotaExceededError) {
      return NextResponse.json(
        { error: "quota_exceeded", usedUsd: err.usedUsd, limitUsd: err.limitUsd },
        { status: 402 }
      );
    }
    if (err instanceof RateLimitExceededError) {
      return NextResponse.json(
        { error: "rate_limit", limitPerMinute: err.limitPerMinute },
        { status: 429 }
      );
    }
    throw err;
  }

  // Load context for self-improvement loop. Benchmarks are keyed by
  // audience size derived from the user's follower count (CSV-provided
  // — the client has it from the X profile step).
  const followerCountGuess = profile?.followers ? Number(profile.followers.replace(/\D/g, "")) : 0;
  const audienceSize = getAudienceSize(followerCountGuess);

  const [scheduleConfig, acceptedProposals, benchmarks, outputLanguageRaw] = await Promise.all([
    getScheduleConfig(dbUser.id),
    getAcceptedProposals(dbUser.id, 30, platform),
    getBenchmarks(platform, audienceSize),
    getOutputLanguage(dbUser.id),
  ]);
  const outputLanguage = outputLanguageRaw ?? DEFAULT_LANGUAGE;

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
  let finished = false;

  let result;
  try {
    result = streamText({
      model: anthropic(model),
      maxOutputTokens: PLANS.pro.maxOutputTokensPerRequest,
      system: getStrategistPrompt(platform, outputLanguage),
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
            scheduleConfig ?? undefined,
            pastDecisions,
            platform,
            benchmarks
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
      onFinish: async ({ usage }) => {
        finished = true;
        await completeReservation({
          reservationId,
          model,
          tokensIn: usage.inputTokens ?? 0,
          tokensOut: usage.outputTokens ?? 0,
        });
      },
      onError: async ({ error }) => {
        if (!finished) await abortReservation(reservationId);
        Sentry.captureException(error, { tags: { area: "strategist-stream" } });
      },
      onAbort: async () => {
        if (!finished) await abortReservation(reservationId);
      },
    });
  } catch (err) {
    await failReservation(reservationId);
    throw err;
  }

  return result.toUIMessageStreamResponse();
}
