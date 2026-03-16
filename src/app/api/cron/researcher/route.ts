import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { anthropic } from "@ai-sdk/anthropic";
import { generateText, tool, stepCountIs } from "ai";
import { z } from "zod";
import { tavily } from "@tavily/core";
import { getResearcherPrompt, buildResearcherUserMessage } from "@/prompts/researcher";
import { saveResearchNote, deleteResearchNote, getAllResearchNotes } from "@/app/actions/research";
import type { ResearchSource } from "@/lib/types";

export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (
    authHeader !== `Bearer ${process.env.CRON_SECRET}` &&
    req.cookies.get("auth")?.value !== "1"
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tavilyApiKey = process.env.TAVILY_API_KEY;
  if (!tavilyApiKey) {
    return NextResponse.json({ error: "TAVILY_API_KEY not configured" }, { status: 500 });
  }

  const tavilyClient = tavily({ apiKey: tavilyApiKey });

  try {
    // Fetch existing notes for self-management
    const existingNotes = await getAllResearchNotes();
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
            const results = response.results.map((r) => ({
              title: r.title,
              url: r.url,
              snippet: r.content?.slice(0, 500) ?? "",
            }));
            allSources.push(...results);
            return results;
          },
        }),
        deleteOldNote: tool({
          description: "Delete an outdated research note by ID",
          inputSchema: z.object({
            noteId: z.string().describe("ID of the research note to delete"),
            reason: z.string().describe("Why this note is being deleted"),
          }),
          execute: async ({ noteId, reason }) => {
            await deleteResearchNote(noteId);
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
    const topic = topicMatch?.[1]?.trim() ?? `Research — ${new Date().toISOString().split("T")[0]}`;

    const saved = await saveResearchNote({
      topic,
      summary: text,
      sources: allSources.slice(0, 20),
      queries: searchQueries,
    });

    return NextResponse.json({
      ok: true,
      noteId: saved.id,
      topic: saved.topic,
      queriesUsed: searchQueries.length,
      sourcesFound: allSources.length,
    });
  } catch (err) {
    Sentry.captureException(err);
    console.error("[researcher]", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
