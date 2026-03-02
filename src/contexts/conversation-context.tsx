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
  clearNotes as clearNotesAction,
} from "@/app/actions/notes";
import { addMessage } from "@/app/actions/conversations";
import { getStoredModel, getStoredLanguageSettings } from "@/components/settings-sheet";

interface ConversationContextValue {
  conversationId: string;
  messages: Message[];
  notes: Note[];
  contentType: ContentType;
  input: string;
  isLoading: boolean;
  error: Error | undefined;

  setInput: (value: string) => void;
  setContentType: (type: ContentType) => void;
  sendMessage: () => void;
  addNote: (content: string) => void;
  removeNote: (id: string) => void;
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

export function ConversationProvider({
  conversationId,
  initialData,
  initialMessage,
  children,
}: {
  conversationId: string;
  initialData?: {
    messages: Message[];
    notes: Note[];
    contentType: ContentType;
    title?: string;
  };
  initialMessage?: string;
  children: ReactNode;
}) {
  const [notes, setNotes] = useState<Note[]>(initialData?.notes ?? []);
  const [contentType, setContentType] = useState<ContentType>(
    initialData?.contentType ?? "Reply"
  );
  const [input, setInput] = useState("");
  const router = useRouter();

  // Refs so the transport body closure always reads latest values
  const notesRef = useRef(notes);
  const contentTypeRef = useRef(contentType);
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
          };
        },
      })
  );

  const initialMessages: UIMessage[] = (initialData?.messages ?? []).map((m) => ({
    id: m.id,
    role: m.role as "user" | "assistant",
    parts: [{ type: "text" as const, text: m.content }],
    metadata: undefined,
  }));

  const { messages: aiMessages, sendMessage: aiSendMessage, status, error } = useChat({
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

  const isLoading = status === "submitted" || status === "streaming";

  // Reset notes and contentType when conversation changes
  useEffect(() => {
    const nts = (initialData?.notes ?? []).map((n) => ({
      ...n,
      createdAt:
        n.createdAt instanceof Date ? n.createdAt : new Date(n.createdAt as string),
    }));
    setNotes(nts);
    setContentType(initialData?.contentType ?? "Reply");
  }, [conversationId, initialData]);

  // Map AI SDK UIMessage[] to our Message type
  const messages: Message[] = aiMessages.map((m) => ({
    id: m.id,
    role: m.role as "user" | "assistant",
    content: getTextFromUIMessage(m),
    createdAt: new Date(),
  }));

  const hasSentInitial = useRef(false);
  useEffect(() => {
    console.log("[ConversationProvider] Initial effect:", { initialMessage, hasSentInitial: hasSentInitial.current, initialDataMessages: initialData?.messages?.length ?? 0 });
    if (!initialMessage || hasSentInitial.current) return;
    // Skip if conversation already has messages (e.g. page reload)
    if (initialData?.messages && initialData.messages.length > 0) return;
    hasSentInitial.current = true;
    const text = initialMessage.trim();
    if (!text) return;
    console.log("[ConversationProvider] Sending initial message:", { conversationId, text: text.substring(0, 100) });
    addMessage(conversationId, "user", text)
      .then(() => {
        console.log("[ConversationProvider] Initial message added, sending to AI");
        window.dispatchEvent(new Event("drafts-updated"));
        aiSendMessage({ text });
        // Clean up URL after sending message
        router.replace(`/c/${conversationId}`);
      })
      .catch((error) => {
        console.error("[ConversationProvider] Failed to add initial message:", error);
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || isLoading) return;
    setInput("");
    // Save user message to DB
    await addMessage(conversationId, "user", text);
    window.dispatchEvent(new Event("drafts-updated"));
    // Send to AI (transport body closure provides notes + contentType)
    aiSendMessage({ text });
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
        error,
        setInput,
        setContentType,
        sendMessage,
        addNote,
        removeNote,
        clearNotes,
      }}
    >
      {children}
    </ConversationContext.Provider>
  );
}
