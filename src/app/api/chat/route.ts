import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { anthropic } from "@ai-sdk/anthropic";
import { streamText, convertToModelMessages, type UIMessage } from "ai";
import { SUPPORTED_LANGUAGES, type ContentType } from "@/lib/types";
import { getVoiceBankEntries } from "@/app/actions/voice-bank";
import { getRecentUsedModes } from "@/app/actions/conversations";
import { getReplyPrompt } from "@/prompts/analyst-reply";
import { getPostPrompt } from "@/prompts/analyst-post";
import { fetchTweetFromText, extractTweetUrl } from "@/lib/parse-tweet";
import { fetchTweetById } from "@/lib/x-api";
import { getXApiTokenForUserInternal } from "@/app/actions/x-token";
import { getLatestTrends } from "@/app/actions/trends";
import { prisma } from "@/lib/prisma";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Look up Prisma user and X credentials for tweet fetching
  const dbUser = await prisma.user.findUnique({ where: { clerkId }, select: { id: true } });
  const xCredentials = dbUser ? await getXApiTokenForUserInternal(dbUser.id) : null;

  try {
    const body = await req.json();
    const {
      messages,
      contentType,
      notes,
      conversationId,
      model: modelParam,
      conversationLanguage,
      contentLanguage,
      tweetContext: clientTweetContext,
    }: {
      messages: UIMessage[];
      contentType: ContentType;
      notes: string[];
      conversationId?: string;
      model?: string;
      conversationLanguage?: string;
      contentLanguage?: string;
      tweetContext?: string;
    } = body;

    function resolveLanguageLabel(value: string | undefined, defaultLabel: string): string {
      const lang = SUPPORTED_LANGUAGES.find((l) => l.value === value);
      return lang ? lang.label : defaultLabel;
    }
    const convLangLabel = resolveLanguageLabel(conversationLanguage, "Russian");
    const contentLangLabel = resolveLanguageLabel(contentLanguage, "English");

    const ALLOWED_MODELS = ["claude-sonnet-4-6", "claude-haiku-4-5-20251001"] as const;
    type AllowedModel = (typeof ALLOWED_MODELS)[number];
    const model: AllowedModel = ALLOWED_MODELS.includes(modelParam as AllowedModel)
      ? (modelParam as AllowedModel)
      : "claude-sonnet-4-6";

    // Load voice bank, recent modes, trends, and top posts in parallel
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setUTCDate(thirtyDaysAgo.getUTCDate() - 30);

    const [voiceBankEntries, recentModes, trends, topPosts] = await Promise.all([
      getVoiceBankEntries(contentType === "Reply" ? "REPLY" : "POST", 25),
      contentType === "Reply" ? getRecentUsedModes(conversationId, 5) : Promise.resolve([]),
      getLatestTrends(),
      prisma.xPost.findMany({
        where: { date: { gte: thirtyDaysAgo }, postType: "POST" },
        orderBy: { engagements: "desc" },
        take: 10,
        select: { text: true, engagements: true },
      }),
    ]);
    const voiceBank = voiceBankEntries.map((e) => e.content);

    // Inject tweet text as extra system context.
    // Client pre-fetches from browser (avoids Twitter blocking Vercel/AWS IPs).
    // Fall back to server-side fetch for local dev or older clients.
    let tweetContext = "";
    if (clientTweetContext) {
      tweetContext = `\n\n## Original Post (fetched from URL)\n${clientTweetContext}`;
    } else {
      const firstUserMsg = messages.find((m) => m.role === "user");
      if (firstUserMsg) {
        const firstText = firstUserMsg.parts
          .filter((p) => p.type === "text")
          .map((p) => (p as { type: "text"; text: string }).text)
          .join("");
        const tweetUrl = extractTweetUrl(firstText);
        let tweetText: string | null = null;
        if (tweetUrl) {
          const tweetIdMatch = tweetUrl.match(/\/status\/(\d+)/);
          if (tweetIdMatch && xCredentials)
            tweetText = await fetchTweetById(xCredentials, tweetIdMatch[1]);
        }
        if (!tweetText) {
          const tweet = await fetchTweetFromText(firstText);
          tweetText = tweet?.text ?? null;
        }
        if (tweetText) {
          tweetContext = `\n\n## Original Post (fetched from URL)\n${tweetText}`;
        }
      }
    }

    // Build system prompt
    const baseSystem =
      contentType === "Reply"
        ? getReplyPrompt(notes, voiceBank, recentModes, convLangLabel, contentLangLabel)
        : getPostPrompt(
            contentType as "Post" | "Thread" | "Article",
            notes,
            voiceBank,
            convLangLabel,
            contentLangLabel
          );

    const trendsContext =
      trends.length > 0
        ? `\n\n## Trending Now on X\n${trends.map((t) => `- ${t.trendName}${t.category ? ` [${t.category}]` : ""} (${t.postCount} posts)`).join("\n")}`
        : "";

    const topPostsContext =
      topPosts.length > 0
        ? `\n\n## Your Top Performing Posts (last 30 days)\n${topPosts
            .map(
              (p, i) =>
                `${i + 1}. "${p.text.slice(0, 100)}${p.text.length > 100 ? "..." : ""}" — ${p.engagements} engagements`
            )
            .join("\n")}`
        : "";

    const systemPrompt = baseSystem + tweetContext + trendsContext + topPostsContext;
    console.log("[chat] model:", model);
    if (tweetContext) console.log("[chat] tweetContext:", tweetContext);

    // Convert UIMessage[] to ModelMessage[] for streamText
    const modelMessages = await convertToModelMessages(messages);

    const result = streamText({
      model: anthropic(model),
      system: systemPrompt,
      messages: modelMessages,
      providerOptions: {
        anthropic: {
          cacheControl: { type: "ephemeral" },
        },
      },
    });

    return result.toUIMessageStreamResponse();
  } catch (err) {
    console.error("[chat]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
