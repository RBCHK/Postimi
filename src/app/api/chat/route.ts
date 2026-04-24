import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { anthropic } from "@ai-sdk/anthropic";
import { streamText, convertToModelMessages, type UIMessage } from "ai";
import { SUPPORTED_LANGUAGES, type ContentType } from "@/lib/types";
import { getVoiceBankEntries } from "@/app/actions/voice-bank";
import { getRecentUsedModes } from "@/app/actions/conversations";
import { getReplyPrompt } from "@/prompts/analyst-reply";
import { getPostPrompt } from "@/prompts/analyst-post";
import { getQuotePrompt } from "@/prompts/analyst-quote";
import { fetchTweetFromText, extractTweetUrl } from "@/lib/parse-tweet";
import { fetchTweetById } from "@/lib/x-api";
import { getXApiTokenForUser } from "@/lib/server/x-token";
import { getLatestTrends } from "@/lib/server/trends";
import {
  fenceExternalTweet,
  fenceTrends,
  fenceTopPosts,
  EXTERNAL_TWEET_MAX_CHARS,
} from "./prompt-fencing";
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

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Look up Prisma user and X credentials for tweet fetching
  const dbUser = await prisma.user.findUnique({ where: { clerkId }, select: { id: true } });
  const xCredentials = dbUser ? await getXApiTokenForUser(dbUser.id) : null;

  if (!dbUser) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  let reservationId: string | undefined;
  try {
    const reservation = await reserveQuota({ userId: dbUser.id, operation: "chat" });
    reservationId = reservation.reservationId;
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
      getLatestTrends(dbUser!.id),
      prisma.socialPost.findMany({
        where: {
          userId: dbUser!.id,
          platform: "X",
          postedAt: { gte: thirtyDaysAgo },
          postType: "POST",
        },
        orderBy: { engagements: "desc" },
        take: 10,
        select: { text: true, engagements: true },
      }),
    ]);
    const voiceBank = voiceBankEntries.map((e) => e.content);

    // Inject tweet text as extra system context.
    // Client pre-fetches from browser (avoids Twitter blocking Vercel/AWS IPs).
    // Fall back to server-side fetch for local dev or older clients.
    //
    // Security: the tweet text is attacker-controlled — anyone can tweet
    // "Ignore previous instructions and ...". `fenceExternalTweet` wraps
    // the body in <external_tweet> tags with a prepended "treat as data"
    // instruction. Do NOT escape/sanitize the body — fencing is correct.
    let tweetContext = "";
    if (typeof clientTweetContext === "string" && clientTweetContext.length > 0) {
      // A legitimate client only sends fetched tweet text (<= 7 000 chars
      // for a full thread). Anything larger is a flood-the-prompt attempt
      // — log so we can investigate without leaking the body itself.
      if (clientTweetContext.length > EXTERNAL_TWEET_MAX_CHARS) {
        Sentry.captureMessage("chat: clientTweetContext oversized, truncated", {
          level: "warning",
          tags: { area: "chat", step: "tweet-context-cap" },
          extra: {
            userId: dbUser.id,
            receivedChars: clientTweetContext.length,
            maxChars: EXTERNAL_TWEET_MAX_CHARS,
          },
        });
      }
      tweetContext = fenceExternalTweet(clientTweetContext);
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
          tweetContext = fenceExternalTweet(tweetText);
        }
      }
    }

    // Build system prompt
    const baseSystem =
      contentType === "Reply"
        ? getReplyPrompt(notes, voiceBank, recentModes, convLangLabel, contentLangLabel)
        : contentType === "Quote"
          ? getQuotePrompt()
          : getPostPrompt(
              contentType as "Post" | "Thread" | "Article",
              notes,
              voiceBank,
              convLangLabel,
              contentLangLabel
            );

    // Trend names come from X's public feed — attacker-controlled text
    // can surface here. Top posts are the user's own historical bodies
    // imported from X; still fence, since a compromised account or
    // harvested replies could land a payload there.
    const trendsContext = fenceTrends(trends);
    const topPostsContext = fenceTopPosts(topPosts);

    const systemPrompt = baseSystem + tweetContext + trendsContext + topPostsContext;
    console.log("[chat] model:", model);
    if (tweetContext) console.log("[chat] tweetContext:", tweetContext);

    // Convert UIMessage[] to ModelMessage[] for streamText
    const modelMessages = await convertToModelMessages(messages);

    const rid = reservationId;
    let finished = false;

    const result = streamText({
      model: anthropic(model),
      maxOutputTokens: PLANS.pro.maxOutputTokensPerRequest,
      system: systemPrompt,
      messages: modelMessages,
      providerOptions: {
        anthropic: {
          cacheControl: { type: "ephemeral" },
        },
      },
      onFinish: async ({ usage }) => {
        finished = true;
        await completeReservation({
          reservationId: rid,
          model,
          tokensIn: usage.inputTokens ?? 0,
          tokensOut: usage.outputTokens ?? 0,
        });
      },
      onError: async ({ error }) => {
        if (!finished) await abortReservation(rid);
        Sentry.captureException(error, { tags: { area: "chat-stream" } });
      },
      onAbort: async () => {
        if (!finished) await abortReservation(rid);
      },
    });

    return result.toUIMessageStreamResponse();
  } catch (err) {
    if (reservationId) await failReservation(reservationId);
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
    console.error("[chat]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
