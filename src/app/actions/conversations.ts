"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/auth";
import { DRAFT_DEFAULT_TITLE } from "@/lib/types";
import type { ContentType, DraftStatus, ComposerContent, Platform } from "@/lib/types";
import { fetchTweetFromText, extractTweetUrl } from "@/lib/parse-tweet";
import { deleteMediaStorageForConversation } from "@/lib/server/media";
import { fetchTweetById } from "@/lib/x-api";
import { getXApiTokenForUser } from "@/lib/server/x-token";
import { checkRateLimit } from "@/lib/ai-quota";
import {
  ContentType as PrismaContentType,
  ConversationStatus as PrismaConversationStatus,
} from "@/generated/prisma";

const contentTypeToPrisma: Record<ContentType, PrismaContentType> = {
  Reply: "REPLY",
  Post: "POST",
  Thread: "THREAD",
  Article: "ARTICLE",
  Quote: "QUOTE",
};

const statusToPrisma: Record<DraftStatus, PrismaConversationStatus> = {
  draft: "DRAFT",
  packaged: "DRAFT", // packaged = draft with content ready
  scheduled: "SCHEDULED",
  posted: "POSTED",
};

// Mirror of `contentTypeToPrisma` in reverse. Typed with
// `Record<Prisma, App>` so a new Prisma enum variant forces a TS error
// here — the old string-manipulation cast would have silently produced
// garbage like "Unknown".
const contentTypeFromPrismaMap: Record<PrismaContentType, ContentType> = {
  REPLY: "Reply",
  POST: "Post",
  THREAD: "Thread",
  ARTICLE: "Article",
  QUOTE: "Quote",
};

const contentTypeFromPrisma = (v: PrismaContentType): ContentType => contentTypeFromPrismaMap[v];

const statusFromPrisma = (v: PrismaConversationStatus): DraftStatus => {
  if (v === "DRAFT") return "draft";
  if (v === "SCHEDULED") return "scheduled";
  return "posted";
};

/**
 * Cap on drafts returned to the sidebar. A power user with 1000 drafts
 * would otherwise load every `composerContent`/`originalPostText`/
 * `pendingInput` JSON blob just to render a list that shows 5 fields.
 * Ordering is `updatedAt desc` so the most recent drafts always make
 * the cut; paginate if this cap ever proves too aggressive.
 */
const DRAFTS_LIST_LIMIT = 200;

export async function getConversations() {
  const userId = await requireUserId();
  // Explicit `select` whitelists exactly the fields the Draft type needs
  // (see `Draft` in src/lib/types.ts and DraftItem/left-sidebar). Without
  // this, Prisma returns every column including large JSON blobs.
  const rows = await prisma.conversation.findMany({
    orderBy: { createdAt: "desc" },
    where: { userId, status: { in: ["DRAFT"] } },
    select: {
      id: true,
      title: true,
      contentType: true,
      status: true,
      pinned: true,
      updatedAt: true,
      originalPostUrl: true,
    },
    take: DRAFTS_LIST_LIMIT,
  });
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    contentType: contentTypeFromPrisma(r.contentType),
    status: statusFromPrisma(r.status),
    pinned: r.pinned,
    updatedAt: r.updatedAt,
    originalPostUrl: r.originalPostUrl ?? undefined,
  }));
}

/**
 * Cap on messages returned to the client on the conversation page.
 * Render cost and payload size grow linearly with history length; 100
 * covers the long-tail of real conversations while protecting the
 * response from a pathological 500+ message thread shipping 500 KB of
 * JSON through the action wire format on every navigation.
 */
const CONVERSATION_MESSAGES_LIMIT = 100;

export async function getConversation(id: string) {
  const userId = await requireUserId();
  // Whitelist fields the client actually consumes (see ConversationPage
  // and ConversationProvider). `originalPostText`, `status`, `updatedAt`
  // and `id` were returned before but not read downstream; keep
  // returning them from the app-layer shape for callers outside of the
  // UI that may depend on them, using safe defaults when the column
  // isn't fetched.
  const c = await prisma.conversation.findFirst({
    where: { id, userId },
    select: {
      id: true,
      title: true,
      contentType: true,
      status: true,
      originalPostText: true,
      originalPostUrl: true,
      composerContent: true,
      composerPlatform: true,
      pendingInput: true,
      updatedAt: true,
      messages: {
        select: { id: true, role: true, content: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: CONVERSATION_MESSAGES_LIMIT,
      },
      notes: {
        select: { id: true, messageId: true, content: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!c) return null;
  // Client renders messages in ascending (chronological) order. We query
  // `desc + take: N` so Postgres can use the
  // `(conversationId, createdAt)` index to grab the latest N without
  // scanning the whole thread, then reverse here for the UI contract.
  const messagesAsc = [...c.messages].reverse();
  return {
    id: c.id,
    title: c.title,
    contentType: contentTypeFromPrisma(c.contentType),
    status: statusFromPrisma(c.status),
    originalPostText: c.originalPostText,
    originalPostUrl: c.originalPostUrl,
    composerContent: (c.composerContent as unknown as ComposerContent) ?? null,
    composerPlatform: (c.composerPlatform as Platform) ?? null,
    pendingInput: c.pendingInput,
    updatedAt: c.updatedAt,
    messages: messagesAsc.map((m) => ({
      id: m.id,
      role: m.role as "user" | "assistant",
      content: m.content,
      createdAt: m.createdAt,
    })),
    notes: c.notes.map((n) => ({
      id: n.id,
      messageId: n.messageId,
      content: n.content,
      createdAt: n.createdAt,
    })),
  };
}

export async function createConversation(data: {
  title: string;
  contentType?: ContentType;
  initialContent?: string;
  originalPostUrl?: string;
}) {
  const userId = await requireUserId();
  const contentType = data.contentType ?? "Post";
  const conv = await prisma.conversation.create({
    data: {
      userId,
      title: data.title,
      contentType: contentTypeToPrisma[contentType],
      status: "DRAFT",
      ...(data.originalPostUrl ? { originalPostUrl: data.originalPostUrl } : {}),
      ...(data.initialContent ? { pendingInput: data.initialContent } : {}),
    },
  });
  return conv.id;
}

/**
 * Single server action for the home page: resolves title, creates conversation,
 * and saves the first user message — all in one round-trip (instead of 3).
 * No revalidatePath needed because we navigate to the new conversation page.
 */
export async function createConversationWithMessage(
  text: string,
  contentType: ContentType
): Promise<string> {
  const userId = await requireUserId();

  // Resolve title: use tweet text if it's a URL, otherwise the message itself
  const tweetUrl = extractTweetUrl(text);
  let title = text;
  if (tweetUrl) {
    const tweet = await fetchTweetFromText(text);
    if (tweet) title = tweet.text;
  }
  if (title.length > 80) title = title.slice(0, 80) + "…";

  const conv = await prisma.conversation.create({
    data: {
      userId,
      title,
      contentType: contentTypeToPrisma[contentType],
      status: "DRAFT",
      ...(tweetUrl ? { originalPostUrl: tweetUrl } : {}),
    },
  });

  await prisma.message.create({
    data: { conversationId: conv.id, role: "user", content: text },
  });

  return conv.id;
}

export async function updateConversation(
  id: string,
  data: {
    title?: string;
    contentType?: ContentType;
    status?: DraftStatus;
    pinned?: boolean;
    originalPostUrl?: string;
  }
) {
  const userId = await requireUserId();
  const update: Record<string, unknown> = {};
  if (data.title != null) update.title = data.title;
  if (data.contentType != null) update.contentType = contentTypeToPrisma[data.contentType];
  if (data.status != null) update.status = statusToPrisma[data.status];
  if (data.pinned != null) update.pinned = data.pinned;
  if (data.originalPostUrl != null) update.originalPostUrl = data.originalPostUrl;
  await prisma.conversation.updateMany({ where: { id, userId }, data: update });
}

export async function clearPendingInput(id: string) {
  const userId = await requireUserId();
  await prisma.conversation.updateMany({
    where: { id, userId },
    data: { pendingInput: null },
  });
}

// Allowed client-supplied id formats: cuid (Prisma default) or AI SDK's
// generated id (the assistant's UIMessage.id). Both fit the charset below
// and stay under 48 chars. An attacker could in theory pass a cuid that
// collides with another user's Message row and cause a P2002 insertion
// error (Message.id is `@id @unique`) — not a data leak, but worth
// validating shape so the DB layer rejects anything unexpected early.
const CLIENT_MESSAGE_ID_RE = /^[A-Za-z0-9_-]{1,48}$/;

export async function addMessage(
  conversationId: string,
  role: "user" | "assistant",
  content: string,
  id?: string
) {
  const userId = await requireUserId();

  // Verify conversation exists and belongs to this user.
  // Guards against FK violations when conversation was deleted while AI was streaming,
  // and prevents writing to another user's conversation.
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, userId },
    select: { id: true },
  });
  if (!conversation) return null;

  // Validate client-supplied id shape. If it doesn't match, fall back to
  // Prisma's default cuid generation instead of throwing — the caller
  // should not be able to 500 the server just by passing a garbage id.
  const safeId = id && CLIENT_MESSAGE_ID_RE.test(id) ? id : undefined;

  const message = await prisma.message.create({
    data: { ...(safeId ? { id: safeId } : {}), conversationId, role, content },
  });
  await prisma.conversation.updateMany({
    where: { id: conversationId, userId },
    data: { lastActivityAt: new Date() },
  });
  revalidatePath(`/c/${conversationId}`);
  return message.id;
}

export async function deleteConversation(id: string) {
  const userId = await requireUserId();
  // Delete media files from Storage before cascade removes DB records
  await deleteMediaStorageForConversation(id, userId);
  await prisma.conversation.deleteMany({ where: { id, userId } });
  // Draft list and the specific /c/[id] view both depend on this row.
  // Narrower than "/" which was blowing the entire dashboard cache.
  revalidatePath("/drafts");
  revalidatePath(`/c/${id}`);
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

/**
 * Updates the conversation title only if it is still the default "Untitled".
 * Safe to call without checking client-side title state.
 */
export async function resolveConversationTitle(id: string, title: string) {
  const userId = await requireUserId();
  await prisma.conversation.updateMany({
    where: { id, userId, title: { in: ["Untitled", DRAFT_DEFAULT_TITLE] } },
    data: { title },
  });
}

export async function markAsPosted(conversationId: string) {
  const userId = await requireUserId();
  await prisma.conversation.updateMany({
    where: { id: conversationId, userId },
    data: { status: "POSTED" },
  });
  // Conversation leaves DRAFT so it disappears from /drafts; /schedule
  // may surface it if there is a linked slot.
  revalidatePath("/drafts");
  revalidatePath("/schedule");
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
  // Each call burns one of the user's X API quota (free tier caps at
  // 1 000 users/me-equivalent calls / 24h). Share the same rolling
  // 1-minute rate limit as /api/chat so a logged-in user can't DoS
  // their own X integration by looping this action.
  await checkRateLimit(userId);

  const url = extractTweetUrl(text);
  if (!url) return null;

  const tweetIdMatch = url.match(/\/status\/(\d+)/);
  if (tweetIdMatch) {
    const credentials = await getXApiTokenForUser(userId);
    if (credentials) {
      const fullText = await fetchTweetById(credentials, tweetIdMatch[1]);
      if (fullText) return fullText;
    }
  }

  // Fallback: oEmbed
  const result = await fetchTweetFromText(text);
  return result ? result.text : null;
}

export async function updateComposerContent(
  conversationId: string,
  composerContent: ComposerContent,
  composerPlatform: Platform,
  title?: string
) {
  const userId = await requireUserId();
  const data: Record<string, unknown> = {
    composerContent: JSON.parse(JSON.stringify(composerContent)),
    composerPlatform,
  };
  if (title !== undefined) {
    data.title = title;
  }
  await prisma.conversation.updateMany({
    where: { id: conversationId, userId },
    data,
  });
}

export async function resolveTitleFromInput(text: string): Promise<string> {
  await requireUserId();
  const tweet = await fetchTweetFromText(text);
  if (tweet) {
    return tweet.text.length > 80 ? tweet.text.slice(0, 80) + "…" : tweet.text;
  }
  return text;
}
