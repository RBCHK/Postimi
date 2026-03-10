import { NextRequest, NextResponse } from "next/server";
import { anthropic } from "@ai-sdk/anthropic";
import { streamText, tool, stepCountIs } from "ai";
import { z } from "zod";
import { tavily } from "@tavily/core";
import { getStrategistPrompt, buildStrategistUserMessage } from "@/prompts/strategist";
import type { CsvSummary } from "@/lib/types";

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const auth = req.cookies.get("auth")?.value;
  if (auth !== "1") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { csvSummary, weekStart }: { csvSummary: CsvSummary; weekStart: string } = body;

  if (!csvSummary || !weekStart) {
    return NextResponse.json({ error: "Missing csvSummary or weekStart" }, { status: 400 });
  }

  const tavilyApiKey = process.env.TAVILY_API_KEY;
  if (!tavilyApiKey) {
    return NextResponse.json({ error: "TAVILY_API_KEY is not configured" }, { status: 500 });
  }

  const tavilyClient = tavily({ apiKey: tavilyApiKey });

  const result = streamText({
    model: anthropic("claude-sonnet-4-6"),
    system: getStrategistPrompt(),
    messages: [
      {
        role: "user",
        content: buildStrategistUserMessage(csvSummary, weekStart),
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
