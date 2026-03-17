import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { anthropic } from "@ai-sdk/anthropic";
import { generateText, tool, stepCountIs } from "ai";
import { z } from "zod";
import { tavily } from "@tavily/core";
import { getResearcherPrompt, buildResearcherUserMessage } from "@/prompts/researcher";
import { prisma } from "@/lib/prisma";
import {
  saveResearchNoteInternal,
  deleteResearchNoteInternal,
  getAllResearchNotesInternal,
} from "@/app/actions/research";
import type { ResearchSource } from "@/lib/types";

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

  const tavilyClient = tavily({ apiKey: tavilyApiKey });

  try {
    const users = await prisma.user.findMany({ select: { id: true } });
    const results: { userId: string; noteId?: string; topic?: string; error?: string }[] = [];

    for (const user of users) {
      try {
        // Fetch existing notes for self-management
        const existingNotes = await getAllResearchNotesInternal(user.id);
        const notesForPrompt = existingNotes.map((n) => ({
          id: n.id,
          topic: n.topic,
          createdAt: n.createdAt.toISOString().split("T")[0],
        }));

        const searchQueries: string[] = [];
        const allSources: ResearchSource[] = [];

        const result = await generateText({
          model: anthropic("claude-sonnet-4-6"),
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
                await deleteResearchNoteInternal(user.id, noteId);
                return { deleted: noteId, reason };
              },
            }),
          },
          stopWhen: stepCountIs(10),
        });

        const text = result.text;

        // Parse topic from output
        const topicMatch =
          text.match(/\*\*(?:Topic|Тема)\*\*[:：]\s*(.+)/i) || text.match(/^#+\s*(.+)/m);
        const topic =
          topicMatch?.[1]?.trim() ?? `Research — ${new Date().toISOString().split("T")[0]}`;

        const saved = await saveResearchNoteInternal(user.id, {
          topic,
          summary: text,
          sources: allSources.slice(0, 20),
          queries: searchQueries,
        });

        results.push({ userId: user.id, noteId: saved.id, topic: saved.topic });
      } catch (err) {
        Sentry.captureException(err);
        console.error(`[researcher] user=${user.id}`, err);
        results.push({
          userId: user.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return NextResponse.json({ ok: true, results });
  } catch (err) {
    Sentry.captureException(err);
    console.error("[researcher]", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
