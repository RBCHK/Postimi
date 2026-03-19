"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/auth";
import type { ContentType, DraftStatus } from "@/lib/types";
import { fetchTweetFromText, extractTweetUrl } from "@/lib/parse-tweet";
import { fetchTweetById } from "@/lib/x-api";
import { getXApiTokenForUserInternal } from "@/app/actions/x-token";
import {
  ContentType as PrismaContentType,
  ConversationStatus as PrismaConversationStatus,
} from "@/generated/prisma";

const contentTypeToPrisma: Record<ContentType, PrismaContentType> = {
  Reply: "REPLY",
  Post: "POST",
  Thread: "THREAD",
  Article: "ARTICLE",
};

const statusToPrisma: Record<DraftStatus, PrismaConversationStatus> = {
  draft: "DRAFT",
  packaged: "DRAFT", // packaged = draft with content ready
  scheduled: "SCHEDULED",
  posted: "POSTED",
};

const contentTypeFromPrisma = (v: PrismaContentType): ContentType =>
  (v.toLowerCase().charAt(0).toUpperCase() + v.slice(1).toLowerCase()) as ContentType;

const statusFromPrisma = (v: PrismaConversationStatus): DraftStatus => {
  if (v === "DRAFT") return "draft";
  if (v === "SCHEDULED") return "scheduled";
  return "posted";
};

export async function getConversations() {
  const userId = await requireUserId();
  const rows = await prisma.conversation.findMany({
    orderBy: { createdAt: "desc" },
    where: { userId, status: { in: ["DRAFT"] } },
  });
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    contentType: contentTypeFromPrisma(r.contentType),
    status: statusFromPrisma(r.status),
    pinned: r.pinned,
    updatedAt: r.updatedAt,
  }));
}

export async function getConversation(id: string) {
  const userId = await requireUserId();
  const c = await prisma.conversation.findFirst({
    where: { id, userId },
    include: {
      messages: { orderBy: { createdAt: "asc" } },
      notes: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!c) return null;
  return {
    id: c.id,
    title: c.title,
    contentType: contentTypeFromPrisma(c.contentType),
    status: statusFromPrisma(c.status),
    originalPostText: c.originalPostText,
    originalPostUrl: c.originalPostUrl,
    updatedAt: c.updatedAt,
    messages: c.messages.map((m) => ({
      id: m.id,
      role: m.role as "user" | "assistant",
      content: m.content,
      createdAt: m.createdAt,
    })),
    notes: c.notes.map((n) => ({
      id: n.id,
      content: n.content,
      createdAt: n.createdAt,
    })),
  };
}

export async function createConversation(data: {
  title: string;
  contentType?: ContentType;
  initialContent?: string;
}) {
  const userId = await requireUserId();
  const contentType = data.contentType ?? "Reply";
  const conv = await prisma.conversation.create({
    data: {
      userId,
      title: data.title,
      contentType: contentTypeToPrisma[contentType],
      status: "DRAFT",
    },
  });
  if (data.initialContent) {
    await prisma.message.create({
      data: {
        conversationId: conv.id,
        role: "user",
        content: data.initialContent,
      },
    });
  }
  return conv.id;
}

export async function updateConversation(
  id: string,
  data: { title?: string; contentType?: ContentType; status?: DraftStatus; pinned?: boolean }
) {
  const userId = await requireUserId();
  const update: Record<string, unknown> = {};
  if (data.title != null) update.title = data.title;
  if (data.contentType != null) update.contentType = contentTypeToPrisma[data.contentType];
  if (data.status != null) update.status = statusToPrisma[data.status];
  if (data.pinned != null) update.pinned = data.pinned;
  await prisma.conversation.updateMany({ where: { id, userId }, data: update });
}

export async function addMessage(
  conversationId: string,
  role: "user" | "assistant",
  content: string
) {
  const userId = await requireUserId();
  await prisma.message.create({
    data: { conversationId, role, content },
  });
  await prisma.conversation.updateMany({
    where: { id: conversationId, userId },
    data: { lastActivityAt: new Date() },
  });
  revalidatePath(`/c/${conversationId}`);
}

export async function deleteConversation(id: string) {
  const userId = await requireUserId();
  await prisma.conversation.deleteMany({ where: { id, userId } });
  revalidatePath("/");
}

/**
 * Returns MODE letters (A–E) from the first assistant message of the last N reply conversations.
 * Used by the reply prompt to enforce anti-repeat mode rotation.
 * Excludes the current conversation so it doesn't count itself.
 */
export async function getRecentUsedModes(excludeId?: string, limit = 5): Promise<string[]> {
  const userId = await requireUserId();
  const where = {
    userId,
    contentType: "REPLY" as const,
    ...(excludeId ? { id: { not: excludeId } } : {}),
  };
  const convs = await prisma.conversation.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: limit,
    include: { messages: { where: { role: "assistant" }, orderBy: { createdAt: "asc" }, take: 1 } },
  });
  const modes: string[] = [];
  for (const c of convs) {
    const firstMsg = c.messages[0]?.content ?? "";
    const match = firstMsg.match(/\bMODE\s+([A-E])\b/i);
    if (match) modes.push(match[1].toUpperCase());
  }
  return modes;
}

export async function markAsPosted(conversationId: string) {
  const userId = await requireUserId();
  await prisma.conversation.updateMany({
    where: { id: conversationId, userId },
    data: { status: "POSTED" },
  });
  revalidatePath("/");
}

/**
 * Resolves the conversation title from user input.
 * If the text contains a tweet URL, fetches the tweet and returns its text (truncated to 80 chars).
 * Otherwise returns the input as-is.
 * Called on the home page before createConversation().
 */
/**
 * Fetches the full text of a tweet from a URL.
 * Tries X API v2 first (full text), falls back to oEmbed (may truncate long posts).
 * Called from client components as a server action.
 */
export async function fetchTweetFullTextAction(text: string): Promise<string | null> {
  const userId = await requireUserId();
  const url = extractTweetUrl(text);
  if (!url) return null;

  const tweetIdMatch = url.match(/\/status\/(\d+)/);
  if (tweetIdMatch) {
    const credentials = await getXApiTokenForUserInternal(userId);
    if (credentials) {
      const fullText = await fetchTweetById(credentials, tweetIdMatch[1]);
      if (fullText) return fullText;
    }
  }

  // Fallback: oEmbed
  const result = await fetchTweetFromText(text);
  return result ? result.text : null;
}

export async function resolveTitleFromInput(text: string): Promise<string> {
  await requireUserId();
  const tweet = await fetchTweetFromText(text);
  if (tweet) {
    return tweet.text.length > 80 ? tweet.text.slice(0, 80) + "…" : tweet.text;
  }
  return text;
}
