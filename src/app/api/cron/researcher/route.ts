import * as Sentry from "@sentry/nextjs";
import { anthropic } from "@ai-sdk/anthropic";
import { generateText, tool, stepCountIs } from "ai";
import { z } from "zod";
import { tavily } from "@tavily/core";
import {
  getGlobalResearcherPrompt,
  buildGlobalResearcherUserMessage,
  getNicheResearcherPrompt,
  buildNicheResearcherUserMessage,
} from "@/prompts/researcher";
import { prisma } from "@/lib/prisma";
import {
  saveGlobalResearchNote,
  deleteGlobalResearchNote,
  listAllGlobalResearchNotes,
  saveUserResearchNote,
  deleteUserResearchNote,
  getUserNicheResearchNotes,
} from "@/lib/server/research";
import { getConnectedPlatforms } from "@/lib/server/platforms";
import { withCronLogging } from "@/lib/cron-helpers";
import { reserveQuota, completeReservation, failReservation } from "@/lib/ai-quota";
import { PLANS } from "@/lib/plans";
import { withTimeout, TimeoutError } from "@/lib/with-timeout";
import {
  QuotaExceededError,
  RateLimitExceededError,
  SubscriptionRequiredError,
} from "@/lib/errors";
import { PLATFORMS, type Platform } from "@/lib/types";
import type { ResearchSource } from "@/lib/types";
import { ensureSystemUser, excludeSystemUser } from "@/lib/server/system-user";

/**
 * Tavily's Node client wraps `fetch` internally and exposes no
 * cancel mechanism. A hung search stalls `generateText` which stalls
 * the whole cron. Bound every tool-call with a hard wall so a slow
 * Tavily leg degrades this user's research quality rather than the
 * whole queue.
 */
const TAVILY_TIMEOUT_MS = 15_000;
const STEP_LIMIT = 10;

export const maxDuration = 120;

export const GET = withCronLogging("researcher", async () => {
  const tavilyApiKey = process.env.TAVILY_API_KEY;
  if (!tavilyApiKey) {
    throw new Error("TAVILY_API_KEY not configured");
  }

  const tavilyClient = tavily({ apiKey: tavilyApiKey });
  const systemUser = await ensureSystemUser();

  const phaseAResults: {
    platform: Platform;
    noteId?: string;
    error?: string;
  }[] = [];
  const phaseBResults: {
    userId: string;
    noteId?: string;
    skipped?: boolean;
    skipReason?: string;
    error?: string;
  }[] = [];

  // ─── Phase A: GLOBAL research, one note per platform ────
  //
  // Iterates platforms (NOT users). Each iteration is its own AiUsage
  // reservation under SYSTEM_USER. Per-platform try/catch keeps a
  // failure on LINKEDIN from killing X or THREADS or Phase B.
  for (const platform of PLATFORMS) {
    let reservationId: string | undefined;
    let reservationCompleted = false;
    try {
      const reservation = await reserveQuota({
        userId: systemUser.id,
        operation: "researcher",
      });
      reservationId = reservation.reservationId;

      const existingNotes = await listAllGlobalResearchNotes(platform);
      const notesForPrompt = existingNotes.map((n) => ({
        id: n.id,
        topic: n.topic,
        createdAt: n.createdAt.toISOString().split("T")[0]!,
      }));

      const searchQueries: string[] = [];
      const allSources: ResearchSource[] = [];

      const researcherModel = "claude-sonnet-4-6";
      const result = await generateText({
        model: anthropic(researcherModel),
        maxOutputTokens: PLANS.pro.maxOutputTokensPerRequest,
        system: getGlobalResearcherPrompt(platform),
        messages: [
          {
            role: "user",
            content: buildGlobalResearcherUserMessage(platform, notesForPrompt),
          },
        ],
        tools: {
          webSearch: tool({
            description: `Search the web for ${platform} growth trends, algorithm updates, content tactics`,
            inputSchema: z.object({
              query: z.string().describe("Search query"),
            }),
            execute: async ({ query }) => {
              searchQueries.push(query);
              try {
                const response = await withTimeout(
                  tavilyClient.search(query, {
                    maxResults: 5,
                    searchDepth: "basic",
                    timeout: 30,
                  }),
                  TAVILY_TIMEOUT_MS,
                  "tavily:researcher-global"
                );
                const searchResults = response.results.map((r) => ({
                  title: r.title,
                  url: r.url,
                  snippet: r.content?.slice(0, 500) ?? "",
                }));
                allSources.push(...searchResults);
                return searchResults;
              } catch (err) {
                if (err instanceof TimeoutError) {
                  Sentry.captureMessage("tavily-timeout", {
                    level: "warning",
                    tags: {
                      area: "researcher",
                      phase: "global",
                      platform,
                      caller: "researcher",
                    },
                    extra: { query, timeoutMs: TAVILY_TIMEOUT_MS },
                  });
                  return [];
                }
                throw err;
              }
            },
          }),
          // SECURITY: `platform` is a closure binding from this loop
          // iteration — NOT a model-supplied argument. The model cannot
          // pass a different platform; deleteGlobalResearchNote() also
          // double-checks platform on the row before delete.
          deleteOldGlobalNote: tool({
            description: `Delete an outdated global research note for ${platform} by ID`,
            inputSchema: z.object({
              noteId: z.string().describe("ID of the global research note to delete"),
              reason: z.string().describe("Why this note is being deleted"),
            }),
            execute: async ({ noteId, reason }) => {
              await deleteGlobalResearchNote(platform, noteId);
              return { deleted: noteId, reason };
            },
          }),
        },
        stopWhen: stepCountIs(STEP_LIMIT),
      });

      if (result.steps.length >= STEP_LIMIT) {
        Sentry.captureMessage("researcher-step-limit-hit", {
          level: "warning",
          tags: {
            area: "researcher",
            phase: "global",
            platform,
          },
          extra: {
            stepCount: result.steps.length,
            finishReason: result.finishReason,
            textLength: result.text.length,
          },
        });
      }

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
        topicMatch?.[1]?.trim() ??
        `${platform} research — ${new Date().toISOString().split("T")[0]}`;

      const saved = await saveGlobalResearchNote(platform, {
        topic,
        summary: text,
        sources: allSources.slice(0, 20),
        queries: searchQueries,
      });

      phaseAResults.push({ platform, noteId: saved.id });
    } catch (err) {
      if (reservationId && !reservationCompleted) await failReservation(reservationId);
      Sentry.captureException(err, {
        tags: { area: "researcher", phase: "global", platform },
      });
      console.error(`[researcher] phase=global platform=${platform}`, err);
      phaseAResults.push({
        platform,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ─── Phase B: USER niche research, per user with niche set ──
  //
  // Skip the SYSTEM_USER (it has no niche; ensureSystemUser leaves
  // niche null) and any user without niche. Users without connected
  // platforms get a typed skip — niche research without a target
  // platform is meaningless.
  const nicheUsers = await prisma.user.findMany({
    where: {
      niche: { not: null },
      ...excludeSystemUser(),
    },
    select: { id: true, niche: true },
  });

  for (const user of nicheUsers) {
    let reservationId: string | undefined;
    let reservationCompleted = false;
    try {
      const connected = await getConnectedPlatforms(user.id);
      if (connected.platforms.length === 0) {
        phaseBResults.push({
          userId: user.id,
          skipped: true,
          skipReason: "no-platforms",
        });
        continue;
      }

      const reservation = await reserveQuota({
        userId: user.id,
        operation: "researcher",
      });
      reservationId = reservation.reservationId;

      const existingNotes = await getUserNicheResearchNotes(user.id, 50);
      const notesForPrompt = existingNotes.map((n) => ({
        id: n.id,
        topic: n.topic,
        createdAt: n.createdAt.toISOString().split("T")[0]!,
      }));

      const searchQueries: string[] = [];
      const allSources: ResearchSource[] = [];

      // user.niche is non-null per the where clause above, but TS can't
      // narrow Prisma's nullable column without an explicit assert.
      const niche = user.niche!;

      const researcherModel = "claude-sonnet-4-6";
      const result = await generateText({
        model: anthropic(researcherModel),
        maxOutputTokens: PLANS.pro.maxOutputTokensPerRequest,
        system: getNicheResearcherPrompt(connected.platforms, niche),
        messages: [
          {
            role: "user",
            content: buildNicheResearcherUserMessage(niche, connected.platforms, notesForPrompt),
          },
        ],
        tools: {
          webSearch: tool({
            description:
              "Search the web for niche-specific content angles, sub-topics, and creators in this niche",
            inputSchema: z.object({
              query: z.string().describe("Search query"),
            }),
            execute: async ({ query }) => {
              searchQueries.push(query);
              try {
                const response = await withTimeout(
                  tavilyClient.search(query, {
                    maxResults: 5,
                    searchDepth: "basic",
                    timeout: 30,
                  }),
                  TAVILY_TIMEOUT_MS,
                  "tavily:researcher-niche"
                );
                const searchResults = response.results.map((r) => ({
                  title: r.title,
                  url: r.url,
                  snippet: r.content?.slice(0, 500) ?? "",
                }));
                allSources.push(...searchResults);
                return searchResults;
              } catch (err) {
                if (err instanceof TimeoutError) {
                  Sentry.captureMessage("tavily-timeout", {
                    level: "warning",
                    tags: {
                      area: "researcher",
                      phase: "niche",
                      caller: "researcher",
                    },
                    extra: { userId: user.id, query, timeoutMs: TAVILY_TIMEOUT_MS },
                  });
                  return [];
                }
                throw err;
              }
            },
          }),
          // SECURITY: `user.id` is a closure binding from this loop
          // iteration — NOT a model-supplied argument. deleteUserResearchNote
          // also enforces userId AND scope=USER on the row.
          deleteOldUserNote: tool({
            description: "Delete an outdated niche research note by ID",
            inputSchema: z.object({
              noteId: z.string().describe("ID of the niche research note to delete"),
              reason: z.string().describe("Why this note is being deleted"),
            }),
            execute: async ({ noteId, reason }) => {
              await deleteUserResearchNote(user.id, noteId);
              return { deleted: noteId, reason };
            },
          }),
        },
        stopWhen: stepCountIs(STEP_LIMIT),
      });

      if (result.steps.length >= STEP_LIMIT) {
        Sentry.captureMessage("researcher-step-limit-hit", {
          level: "warning",
          tags: {
            area: "researcher",
            phase: "niche",
            userId: user.id,
          },
          extra: {
            stepCount: result.steps.length,
            finishReason: result.finishReason,
            textLength: result.text.length,
          },
        });
      }

      const text = result.text;

      await completeReservation({
        reservationId,
        model: researcherModel,
        tokensIn: result.usage.inputTokens ?? 0,
        tokensOut: result.usage.outputTokens ?? 0,
      });
      reservationCompleted = true;

      const topicMatch =
        text.match(/\*\*(?:Topic|Тема)\*\*[:：]\s*(.+)/i) || text.match(/^#+\s*(.+)/m);
      const topic =
        topicMatch?.[1]?.trim() ?? `${niche} — ${new Date().toISOString().split("T")[0]}`;

      const saved = await saveUserResearchNote(user.id, niche, {
        topic,
        summary: text,
        sources: allSources.slice(0, 20),
        queries: searchQueries,
      });

      phaseBResults.push({ userId: user.id, noteId: saved.id });
    } catch (err) {
      if (reservationId && !reservationCompleted) await failReservation(reservationId);
      if (
        err instanceof SubscriptionRequiredError ||
        err instanceof QuotaExceededError ||
        err instanceof RateLimitExceededError
      ) {
        console.log(`[researcher] phase=niche skip user=${user.id}: ${err.name}`);
        phaseBResults.push({ userId: user.id, error: err.name });
        continue;
      }
      Sentry.captureException(err, {
        tags: { area: "researcher", phase: "niche", userId: user.id },
      });
      console.error(`[researcher] phase=niche user=${user.id}`, err);
      phaseBResults.push({
        userId: user.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const hasErrors = phaseAResults.some((r) => r.error) || phaseBResults.some((r) => r.error);

  return {
    status: hasErrors ? "PARTIAL" : "SUCCESS",
    data: {
      global: phaseAResults,
      niche: phaseBResults,
    },
  };
});
