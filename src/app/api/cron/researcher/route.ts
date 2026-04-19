import * as Sentry from "@sentry/nextjs";
import { anthropic } from "@ai-sdk/anthropic";
import { generateText, tool, stepCountIs } from "ai";
import { z } from "zod";
import { tavily } from "@tavily/core";
import { getResearcherPrompt, buildResearcherUserMessage } from "@/prompts/researcher";
import { prisma } from "@/lib/prisma";
import { saveResearchNote, deleteResearchNote, getAllResearchNotes } from "@/lib/server/research";
import { withCronLogging } from "@/lib/cron-helpers";
import { reserveQuota, completeReservation, failReservation } from "@/lib/ai-quota";
import { PLANS } from "@/lib/plans";
import {
  QuotaExceededError,
  RateLimitExceededError,
  SubscriptionRequiredError,
} from "@/lib/errors";
import type { ResearchSource } from "@/lib/types";

export const maxDuration = 120;

export const GET = withCronLogging("researcher", async () => {
  const tavilyApiKey = process.env.TAVILY_API_KEY;
  if (!tavilyApiKey) {
    throw new Error("TAVILY_API_KEY not configured");
  }

  const tavilyClient = tavily({ apiKey: tavilyApiKey });

  const users = await prisma.user.findMany({ select: { id: true } });
  const results: { userId: string; noteId?: string; topic?: string; error?: string }[] = [];

  for (const user of users) {
    let reservationId: string | undefined;
    let reservationCompleted = false;
    try {
      const reservation = await reserveQuota({ userId: user.id, operation: "researcher" });
      reservationId = reservation.reservationId;

      // Fetch existing notes for self-management
      const existingNotes = await getAllResearchNotes(user.id);
      const notesForPrompt = existingNotes.map((n) => ({
        id: n.id,
        topic: n.topic,
        createdAt: n.createdAt.toISOString().split("T")[0],
      }));

      const searchQueries: string[] = [];
      const allSources: ResearchSource[] = [];

      const researcherModel = "claude-sonnet-4-6";
      const result = await generateText({
        model: anthropic(researcherModel),
        maxOutputTokens: PLANS.pro.maxOutputTokensPerRequest,
        system: getResearcherPrompt(),
        messages: [
          {
            role: "user",
            content: buildResearcherUserMessage(notesForPrompt),
          },
        ],
        tools: {
          webSearch: tool({
            description:
              "Search the web for X/Twitter growth trends, algorithm updates, engagement tactics",
            inputSchema: z.object({
              query: z.string().describe("Search query"),
            }),
            execute: async ({ query }) => {
              searchQueries.push(query);
              const response = await tavilyClient.search(query, {
                maxResults: 5,
                searchDepth: "basic",
              });
              const searchResults = response.results.map((r) => ({
                title: r.title,
                url: r.url,
                snippet: r.content?.slice(0, 500) ?? "",
              }));
              allSources.push(...searchResults);
              return searchResults;
            },
          }),
          deleteOldNote: tool({
            description: "Delete an outdated research note by ID",
            inputSchema: z.object({
              noteId: z.string().describe("ID of the research note to delete"),
              reason: z.string().describe("Why this note is being deleted"),
            }),
            execute: async ({ noteId, reason }) => {
              await deleteResearchNote(user.id, noteId);
              return { deleted: noteId, reason };
            },
          }),
        },
        stopWhen: stepCountIs(10),
      });

      const text = result.text;

      await completeReservation({
        reservationId,
        model: researcherModel,
        tokensIn: result.usage.inputTokens ?? 0,
        tokensOut: result.usage.outputTokens ?? 0,
      });
      reservationCompleted = true;

      // Parse topic from output
      const topicMatch =
        text.match(/\*\*(?:Topic|Тема)\*\*[:：]\s*(.+)/i) || text.match(/^#+\s*(.+)/m);
      const topic =
        topicMatch?.[1]?.trim() ?? `Research — ${new Date().toISOString().split("T")[0]}`;

      const saved = await saveResearchNote(user.id, {
        topic,
        summary: text,
        sources: allSources.slice(0, 20),
        queries: searchQueries,
      });

      results.push({ userId: user.id, noteId: saved.id, topic: saved.topic });
    } catch (err) {
      if (reservationId && !reservationCompleted) await failReservation(reservationId);
      if (
        err instanceof SubscriptionRequiredError ||
        err instanceof QuotaExceededError ||
        err instanceof RateLimitExceededError
      ) {
        console.log(`[researcher] skip user=${user.id}: ${err.name}`);
        results.push({ userId: user.id, error: err.name });
        continue;
      }
      Sentry.captureException(err);
      console.error(`[researcher] user=${user.id}`, err);
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
