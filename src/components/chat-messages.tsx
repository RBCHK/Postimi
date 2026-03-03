"use client";

import { useEffect, useRef } from "react";
import { ChatBubble } from "@/components/chat-bubble";
import { useConversation } from "@/contexts/conversation-context";

const SCROLL_TOP_OFFSET = 32; // px = pt-8

export function ChatMessages() {
  const { messages, isLoading } = useConversation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const spacerRef = useRef<HTMLDivElement>(null);
  const wasLoadingRef = useRef(false);

  const userCount = messages.filter((m) => m.role === "user").length;
  const prevUserCount = useRef(userCount);

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
          const offset =
            lastMsg.getBoundingClientRect().top -
            el.getBoundingClientRect().top;
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
      <div ref={scrollRef} className="absolute inset-0 overflow-y-auto">
        <div data-chat-messages className="mx-auto flex w-full max-w-chat flex-col gap-4 px-4 pt-8 pb-6">
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
      <div
        className="pointer-events-none absolute left-0 right-0 top-0 z-10 h-[18px] bg-linear-to-b from-background to-transparent"
        aria-hidden
      />
    </div>
  );
}
