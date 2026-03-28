"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, generateId, type UIMessage, type TextUIPart } from "ai";
import type { ContentType, Message, Note, ComposerContent, Platform } from "@/lib/types";
import {
  addNote as addNoteAction,
  removeNote as removeNoteAction,
  updateNote as updateNoteAction,
  clearNotes as clearNotesAction,
} from "@/app/actions/notes";
import {
  addMessage,
  clearPendingInput,
  fetchTweetFullTextAction,
  updateConversation,
  updateComposerContent,
  resolveConversationTitle,
} from "@/app/actions/conversations";
import { extractTweetUrl } from "@/lib/parse-tweet";
import { getStoredModel } from "@/lib/model";
import { getStoredLanguageSettings } from "@/lib/language";

interface ConversationContextValue {
  conversationId: string;
  messages: Message[];
  notes: Note[];
  contentType: ContentType;
  composerContent: ComposerContent;
  composerPlatform: Platform;
  composerSaveStatus: "idle" | "saving" | "saved";
  input: string;
  isLoading: boolean;
  isFetchingTweet: boolean;
  error: Error | undefined;

  setInput: (value: string) => void;
  sendMessage: () => void;
  changeContentType: (type: ContentType) => void;
  updateComposer: (content: ComposerContent, platform: Platform) => void;
  addNote: (content: string, messageId: string) => Promise<boolean>;
  removeNote: (id: string) => void;
  updateNote: (id: string, content: string) => void;
  clearNotes: () => void;
}

const DEFAULT_COMPOSER: ComposerContent = { linked: true, shared: "" };

const ConversationContext = createContext<ConversationContextValue | null>(null);

export function useConversation() {
  const ctx = useContext(ConversationContext);
  if (!ctx) {
    throw new Error("useConversation must be used within ConversationProvider");
  }
  return ctx;
}

function getTextFromUIMessage(message: UIMessage): string {
  return message.parts
    .filter((p): p is TextUIPart => p.type === "text")
    .map((p) => p.text)
    .join("");
}

/**
 * Provides conversation state and AI chat for a single conversation.
 *
 * CONTRACT:
 * - Pass loaded data via `initialData.messages` — there is no `initialMessage` prop.
 * - Do NOT pass initial content via URL params; save to DB before redirecting here.
 * - If `initialData.pendingInput` is set (from highlights), it pre-fills the input field
 *   without auto-sending, so the user can choose contentType before sending.
 * - To send a message use `sendMessage` from `useConversation()`, not `aiSendMessage` directly.
 */
export function ConversationProvider({
  conversationId,
  initialData,
  children,
}: {
  conversationId: string;
  initialData?: {
    messages: Message[];
    notes: Note[];
    contentType: ContentType;
    composerContent?: ComposerContent | null;
    composerPlatform?: Platform | null;
    title?: string;
    originalPostUrl?: string;
    pendingInput?: string;
  };
  children: ReactNode;
}) {
  const [notes, setNotes] = useState<Note[]>(initialData?.notes ?? []);
  const [contentType, setContentType] = useState<ContentType>(initialData?.contentType ?? "Reply");
  const [input, setInput] = useState(initialData?.pendingInput ?? "");
  const [isFetchingTweet, setIsFetchingTweet] = useState(false);
  const router = useRouter();

  const [composerContent, setComposerContent] = useState<ComposerContent>(
    initialData?.composerContent ?? DEFAULT_COMPOSER
  );
  const [composerPlatform, setComposerPlatform] = useState<Platform>(
    initialData?.composerPlatform ?? "X"
  );
  const [composerSaveStatus, setComposerSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const composerSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Refs so the transport body closure always reads latest values
  const notesRef = useRef(notes);
  const contentTypeRef = useRef(contentType);
  const tweetContextRef = useRef("");
  const originalPostUrlRef = useRef(initialData?.originalPostUrl ?? null);
  const pendingInputClearedRef = useRef(false);
  const nextMessageIdRef = useRef<string | null>(null);
  // True once title has been resolved from first message (URL or plain text)
  const hasResolvedTitleRef = useRef(
    initialData?.originalPostUrl != null ||
      (initialData?.title != null && initialData.title !== "Untitled")
  );

  // Keep refs in sync with latest state values.
  // useLayoutEffect (synchronous) ensures refs are current before any user
  // interaction triggers the transport body closure.
  useLayoutEffect(() => {
    notesRef.current = notes;
    contentTypeRef.current = contentType;
  });

  // Create transport once per conversation mount.
  // The body closure captures ref objects and reads .current lazily at send
  // time — not during render. The react-hooks/refs rule is a false positive here.
  /* eslint-disable react-hooks/refs */
  const [transport] = useState(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        body: () => {
          const lang = getStoredLanguageSettings();
          return {
            conversationId,
            contentType: contentTypeRef.current,
            notes: notesRef.current.map((n) => n.content),
            model: getStoredModel(),
            conversationLanguage: lang.conversationLanguage,
            contentLanguage: lang.contentLanguage,
            tweetContext: tweetContextRef.current,
          };
        },
      })
  );
  /* eslint-enable react-hooks/refs */

  const initialMessages: UIMessage[] = (initialData?.messages ?? []).map((m) => ({
    id: m.id,
    role: m.role as "user" | "assistant",
    parts: [{ type: "text" as const, text: m.content }],
    metadata: undefined,
  }));

  const {
    messages: aiMessages,
    sendMessage: aiSendMessage,
    status,
    error,
  } = useChat({
    transport,
    messages: initialMessages,
    generateId: () => {
      if (nextMessageIdRef.current) {
        const id = nextMessageIdRef.current;
        nextMessageIdRef.current = null;
        return id;
      }
      return generateId();
    },
    onFinish: async ({ message }: { message: UIMessage }) => {
      const text = getTextFromUIMessage(message);
      if (text) {
        try {
          await addMessage(conversationId, "assistant", text, message.id);
          window.dispatchEvent(new Event("drafts-updated"));
        } catch (e) {
          console.error("Failed to save assistant message:", e);
        }
      }
    },
  });

  const isLoading = status === "submitted" || status === "streaming" || isFetchingTweet;

  // Reset notes and contentType when conversation changes
  useEffect(() => {
    const nts = (initialData?.notes ?? []).map((n) => ({
      ...n,
      createdAt: n.createdAt instanceof Date ? n.createdAt : new Date(n.createdAt as string),
    }));
    setNotes(nts);
    setContentType(initialData?.contentType ?? "Reply");
    setComposerContent(initialData?.composerContent ?? DEFAULT_COMPOSER);
    setComposerPlatform(initialData?.composerPlatform ?? "X");
    setComposerSaveStatus("idle");
  }, [conversationId, initialData]);

  // Map AI SDK UIMessage[] to our Message type.
  // Fall back to initialData when aiMessages is empty (first render before useChat hydrates).
  const messages: Message[] =
    aiMessages.length > 0
      ? aiMessages.map((m) => ({
          id: m.id,
          role: m.role as "user" | "assistant",
          content: getTextFromUIMessage(m),
          createdAt: new Date(),
        }))
      : (initialData?.messages ?? []).map((m) => ({
          ...m,
          createdAt: m.createdAt instanceof Date ? m.createdAt : new Date(m.createdAt as string),
        }));

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || isLoading) return;
    setInput("");

    try {
      setIsFetchingTweet(true);
      const tweetText = await fetchTweetFullTextAction(text);
      tweetContextRef.current = tweetText ?? "";
      setIsFetchingTweet(false);
      // Save tweet URL and resolve title on first occurrence if not already stored
      if (tweetText && !originalPostUrlRef.current) {
        const url = extractTweetUrl(text);
        if (url) {
          originalPostUrlRef.current = url;
          hasResolvedTitleRef.current = true;
          const resolvedTitle = tweetText.length > 80 ? tweetText.slice(0, 80) + "…" : tweetText;
          await Promise.all([
            updateConversation(conversationId, { originalPostUrl: url }),
            resolveConversationTitle(conversationId, resolvedTitle),
          ]);
          window.dispatchEvent(new Event("drafts-updated"));
        }
      }
      // For plain text first message, resolve title from the message text
      if (!hasResolvedTitleRef.current) {
        hasResolvedTitleRef.current = true;
        const resolvedTitle = text.length > 80 ? text.slice(0, 80) + "…" : text;
        await resolveConversationTitle(conversationId, resolvedTitle);
      }
      // Save user message to DB first to get the canonical ID.
      const dbMessageId = await addMessage(conversationId, "user", text);
      if (!dbMessageId) {
        // Conversation was deleted or ownership changed — abort
        setInput(text);
        return;
      }
      // Clear pendingInput (non-critical — don't let it abort the send)
      if (initialData?.pendingInput && !pendingInputClearedRef.current) {
        pendingInputClearedRef.current = true;
        clearPendingInput(conversationId).catch(() => {});
      }
      window.dispatchEvent(new Event("drafts-updated"));
      // Set the DB ID so generateId() returns it for the user message in useChat,
      // keeping IDs in sync between DB and rendered messages.
      nextMessageIdRef.current = dbMessageId;
      aiSendMessage({ text });
      tweetContextRef.current = "";
    } catch {
      // Restore input so the user can retry
      setInput(text);
      setIsFetchingTweet(false);
      tweetContextRef.current = "";
    }
  }, [input, isLoading, conversationId, aiSendMessage, initialData?.pendingInput]);

  const addNote = useCallback(
    async (content: string, messageId: string): Promise<boolean> => {
      const tempId = `n-${Date.now()}`;
      setNotes((prev) => [...prev, { id: tempId, messageId, content, createdAt: new Date() }]);
      try {
        const created = await addNoteAction(conversationId, content, messageId);
        setNotes((prev) => prev.map((n) => (n.id === tempId ? created : n)));
        router.refresh();
        return true;
      } catch {
        setNotes((prev) => prev.filter((n) => n.id !== tempId));
        router.refresh();
        return false;
      }
    },
    [conversationId, router]
  );

  const removeNote = useCallback(
    async (id: string) => {
      setNotes((prev) => prev.filter((n) => n.id !== id));
      try {
        await removeNoteAction(id, conversationId);
      } catch {
        // refresh will restore notes from server
      }
      router.refresh();
    },
    [conversationId, router]
  );

  const updateNote = useCallback(
    async (id: string, content: string) => {
      setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, content } : n)));
      try {
        await updateNoteAction(id, content, conversationId);
      } catch {
        // refresh will restore notes from server
      }
      router.refresh();
    },
    [conversationId, router]
  );

  const clearNotes = useCallback(async () => {
    const prev = notesRef.current;
    setNotes([]);
    try {
      await clearNotesAction(conversationId);
    } catch {
      setNotes(prev);
    }
    router.refresh();
  }, [conversationId, router]);

  const updateComposer = useCallback(
    (content: ComposerContent, platform: Platform) => {
      setComposerContent(content);
      setComposerPlatform(platform);
      setComposerSaveStatus("saving");
      if (composerSaveTimerRef.current) clearTimeout(composerSaveTimerRef.current);
      composerSaveTimerRef.current = setTimeout(async () => {
        await updateComposerContent(conversationId, content, platform);
        setComposerSaveStatus("saved");
        setTimeout(() => setComposerSaveStatus("idle"), 2000);
      }, 1500);
    },
    [conversationId]
  );

  const changeContentType = useCallback(
    (type: ContentType) => {
      setContentType(type);
      updateConversation(conversationId, { contentType: type });
    },
    [conversationId]
  );

  return (
    <ConversationContext.Provider
      value={{
        conversationId,
        messages,
        notes,
        contentType,
        composerContent,
        composerPlatform,
        composerSaveStatus,
        input,
        isLoading,
        isFetchingTweet,
        error,
        setInput,
        sendMessage,
        changeContentType,
        updateComposer,
        addNote,
        removeNote,
        updateNote,
        clearNotes,
      }}
    >
      {children}
    </ConversationContext.Provider>
  );
}
