"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { ArrowDown } from "lucide-react";
import { ChatBubble } from "@/components/chat-bubble";
import { useConversation } from "@/contexts/conversation-context";

const SCROLL_TOP_OFFSET = 32; // px = pt-8
const SCROLL_THRESHOLD = 100; // px from bottom to show button

export function ChatMessages() {
  const { messages, isLoading } = useConversation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const spacerRef = useRef<HTMLDivElement>(null);
  const wasLoadingRef = useRef(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  const userCount = messages.filter((m) => m.role === "user").length;
  const prevUserCount = useRef(userCount);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, []);

  // Отслеживаем позицию скролла чтобы показывать кнопку
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const onScroll = () => {
      const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      setShowScrollBtn(distFromBottom > SCROLL_THRESHOLD);
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // Подрезаем spacer когда стриминг заканчивается —
  // ровно до минимума нужного чтобы контент не прыгнул
  useEffect(() => {
    if (wasLoadingRef.current && !isLoading) {
      const spacer = spacerRef.current;
      const el = scrollRef.current;
      if (spacer && el) {
        const currentSpacerHeight = parseFloat(spacer.style.height) || 0;
        const actualContentHeight = el.scrollHeight - currentSpacerHeight;
        const needed = Math.max(0, el.scrollTop + el.clientHeight - actualContentHeight);
        spacer.style.transition = "none";
        spacer.style.height = `${needed}px`;
      }
    }
    wasLoadingRef.current = isLoading;
  }, [isLoading]);

  useEffect(() => {
    const el = scrollRef.current;
    const spacer = spacerRef.current;
    if (!el) return;

    if (userCount > prevUserCount.current) {
      prevUserCount.current = userCount;

      // Spacer создаёт место для скролла — без него браузер не может
      // поднять сообщение к верху, если контента меньше чем высота экрана
      if (spacer) {
        spacer.style.transition = "none";
        spacer.style.height = `${el.clientHeight}px`;
      }

      requestAnimationFrame(() => {
        const userMsgs = el.querySelectorAll('[data-role="user"]');
        const lastMsg = userMsgs[userMsgs.length - 1] as HTMLElement | undefined;
        if (lastMsg) {
          const offset = lastMsg.getBoundingClientRect().top - el.getBoundingClientRect().top;
          el.scrollTo({ top: el.scrollTop + offset - SCROLL_TOP_OFFSET, behavior: "smooth" });
        }
      });
    }
  }, [messages, userCount]);

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-base leading-relaxed text-muted-foreground">
          Start a conversation — paste a tweet or describe your topic
        </p>
      </div>
    );
  }

  return (
    <div className="relative flex-1 min-h-0 overflow-hidden">
      <div ref={scrollRef} className="absolute inset-0 overflow-y-auto overflow-x-hidden">
        <div
          data-chat-messages
          className="mx-auto flex w-full max-w-chat flex-col gap-4 px-8 pt-8 pb-6"
        >
          {messages.map((msg, i) => (
            <ChatBubble
              key={msg.id}
              message={msg}
              isStreaming={isLoading && i === messages.length - 1 && msg.role === "assistant"}
            />
          ))}
          <div ref={spacerRef} className="shrink-0" />
        </div>
      </div>
      {showScrollBtn && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-4 left-1/2 z-10 flex h-10 w-10 -translate-x-1/2 items-center justify-center rounded-full bg-secondary text-secondary-foreground shadow-md transition-opacity hover:opacity-80"
          aria-label="Scroll to bottom"
        >
          <ArrowDown className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
