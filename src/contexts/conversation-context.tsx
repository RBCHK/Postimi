"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage, type TextUIPart } from "ai";
import type { ContentType, Message, Note } from "@/lib/types";
import {
  addNote as addNoteAction,
  removeNote as removeNoteAction,
  updateNote as updateNoteAction,
  clearNotes as clearNotesAction,
} from "@/app/actions/notes";
import { addMessage, fetchTweetFullTextAction } from "@/app/actions/conversations";
import { getStoredModel } from "@/lib/model";
import { getStoredLanguageSettings } from "@/lib/language";

interface ConversationContextValue {
  conversationId: string;
  messages: Message[];
  notes: Note[];
  contentType: ContentType;
  input: string;
  isLoading: boolean;
  isFetchingTweet: boolean;
  error: Error | undefined;

  setInput: (value: string) => void;
  setContentType: (type: ContentType) => void;
  sendMessage: () => void;
  addNote: (content: string) => void;
  removeNote: (id: string) => void;
  updateNote: (id: string, content: string) => void;
  clearNotes: () => void;
}

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
 * - Auto-starts AI if initialData.messages has exactly 1 user message (new conversation).
 *   Does NOT auto-start on page refresh of an ongoing conversation (2+ messages).
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
    title?: string;
  };
  children: ReactNode;
}) {
  const [notes, setNotes] = useState<Note[]>(initialData?.notes ?? []);
  const [contentType, setContentType] = useState<ContentType>(initialData?.contentType ?? "Reply");
  const [input, setInput] = useState("");
  const [isFetchingTweet, setIsFetchingTweet] = useState(false);
  const router = useRouter();

  // Refs so the transport body closure always reads latest values
  const notesRef = useRef(notes);
  const contentTypeRef = useRef(contentType);
  const tweetContextRef = useRef("");
  notesRef.current = notes;
  contentTypeRef.current = contentType;

  // Create transport once per conversation mount
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

  // For auto-start (1 user message, no reply yet), pass empty initialMessages so
  // aiSendMessage can add it once. Otherwise useChat would show it twice.
  const isAutoStart =
    (initialData?.messages ?? []).length === 1 && initialData?.messages?.[0]?.role === "user";

  const initialMessages: UIMessage[] = isAutoStart
    ? []
    : (initialData?.messages ?? []).map((m) => ({
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
    onFinish: async ({ message }: { message: UIMessage }) => {
      const text = getTextFromUIMessage(message);
      if (text) {
        await addMessage(conversationId, "assistant", text);
        window.dispatchEvent(new Event("drafts-updated"));
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
  }, [conversationId, initialData]);

  // Map AI SDK UIMessage[] to our Message type.
  // During auto-start, aiMessages is empty until aiSendMessage fires — fall back to initialData.
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

  // Auto-start AI for new conversations (exactly 1 user message, no assistant reply yet).
  // hasSentInitial guards against StrictMode double-invoke and future re-renders.
  // Empty deps array is intentional: runs once on mount using initialData captured at creation.
  const hasSentInitial = useRef(false);
  useEffect(() => {
    if (hasSentInitial.current) return;
    const msgs = initialData?.messages ?? [];
    if (msgs.length === 1 && msgs[0].role === "user") {
      hasSentInitial.current = true;
      const text = msgs[0].content;
      (async () => {
        const tweetText = await fetchTweetFullTextAction(text);
        tweetContextRef.current = tweetText ?? "";
        aiSendMessage({ text });
        tweetContextRef.current = "";
      })();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || isLoading) return;
    setInput("");
    setIsFetchingTweet(true);
    const tweetText = await fetchTweetFullTextAction(text);
    tweetContextRef.current = tweetText ?? "";
    setIsFetchingTweet(false);
    // Save user message to DB
    await addMessage(conversationId, "user", text);
    window.dispatchEvent(new Event("drafts-updated"));
    // Send to AI (transport body closure provides notes + contentType + tweetContext)
    aiSendMessage({ text });
    tweetContextRef.current = "";
  }, [input, isLoading, conversationId, aiSendMessage]);

  const addNote = useCallback(
    async (content: string) => {
      const tempId = `n-${Date.now()}`;
      setNotes((prev) => [...prev, { id: tempId, content, createdAt: new Date() }]);
      try {
        const created = await addNoteAction(conversationId, content);
        setNotes((prev) => prev.map((n) => (n.id === tempId ? created : n)));
      } catch {
        setNotes((prev) => prev.filter((n) => n.id !== tempId));
      }
      router.refresh();
    },
    [conversationId, router]
  );

  const removeNote = useCallback(
    async (id: string) => {
      setNotes((prev) => prev.filter((n) => n.id !== id));
      try {
        await removeNoteAction(id, conversationId);
      } catch {
        router.refresh();
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
        router.refresh();
      }
      router.refresh();
    },
    [conversationId, router]
  );

  const clearNotes = useCallback(async () => {
    setNotes([]);
    await clearNotesAction(conversationId);
    router.refresh();
  }, [conversationId, router]);

  return (
    <ConversationContext.Provider
      value={{
        conversationId,
        messages,
        notes,
        contentType,
        input,
        isLoading,
        isFetchingTweet,
        error,
        setInput,
        setContentType,
        sendMessage,
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
