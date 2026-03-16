"use client";

import { useRef, useCallback, useLayoutEffect, useEffect, type KeyboardEvent } from "react";
import { ContentTypeDropdown } from "@/components/content-type-dropdown";
import { ModelDropdown } from "@/components/model-dropdown";
import { SendMessageButton } from "@/components/send-message-button";
import { type ContentType } from "@/lib/types";
import { cn } from "@/lib/utils";

const MIN_HEIGHT_PX = 48; /* matches bottom row (dropdown + send button) */
const MAX_HEIGHT_PX = 150;

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  contentType: ContentType;
  onContentTypeChange: (type: ContentType) => void;
  onSend: () => void;
  disabled?: boolean;
  isFetchingTweet?: boolean;
  autoFocus?: boolean;
  className?: string;
}

export function ChatInput({
  value,
  onChange,
  contentType,
  onContentTypeChange,
  onSend,
  disabled,
  isFetchingTweet,
  autoFocus,
  className,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const h = Math.min(Math.max(el.scrollHeight, MIN_HEIGHT_PX), MAX_HEIGHT_PX);
    el.style.height = `${h}px`;
  }, []);

  useLayoutEffect(() => {
    adjustHeight();
  }, [value, adjustHeight]);

  useEffect(() => {
    if (!autoFocus) return;
    textareaRef.current?.focus();
    const handler = () => textareaRef.current?.focus();
    window.addEventListener("focus-chat-input", handler);
    return () => window.removeEventListener("focus-chat-input", handler);
  }, [autoFocus]);

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    onChange(e.target.value);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (value.trim()) onSend();
    }
  }

  return (
    <div className={cn("px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]", className)}>
      <div className="mx-auto w-full max-w-chat">
        <div className="rounded-xl border border-border bg-card transition-colors duration-150 focus-within:border-white/8">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder="Paste a tweet URL or type your message…"
            rows={1}
            disabled={disabled}
            style={{ minHeight: MIN_HEIGHT_PX }}
            className="w-full resize-none border-0 bg-transparent pl-[26px] pr-4 pt-[18px] pb-1 text-left text-[16px] leading-relaxed text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-0 disabled:opacity-50"
          />
          <div className="flex items-center justify-between gap-5 px-4 pb-3 pt-1">
            <ContentTypeDropdown
              value={contentType}
              onValueChange={onContentTypeChange}
              disabled={disabled}
            />

            <div className="flex items-center gap-3">
              {isFetchingTweet && (
                <span className="text-xs text-muted-foreground animate-pulse">Loading tweet…</span>
              )}
              <ModelDropdown disabled={disabled} />
              <SendMessageButton onClick={onSend} disabled={disabled || !value.trim()} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
