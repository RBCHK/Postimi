"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChatInput } from "@/components/chat-input";
import { DailyInsightCard } from "@/components/daily-insight-card";
import {
  createConversation,
  resolveTitleFromInput,
  addMessage,
} from "@/app/actions/conversations";
import type { ContentType } from "@/lib/types";

interface HomeViewProps {
  insights: string[] | null;
  insightDate: string | null;
}

export function HomeView({ insights, insightDate }: HomeViewProps) {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [contentType, setContentType] = useState<ContentType>("Reply");
  const [isLoading, setIsLoading] = useState(false);

  async function handleSend() {
    const text = input.trim();
    if (!text || isLoading) return;
    setIsLoading(true);
    try {
      const title = await resolveTitleFromInput(text);
      const id = await createConversation({ title, contentType });
      await addMessage(id, "user", text);
      router.push(`/c/${id}`);
    } catch {
      setIsLoading(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4">
      <DailyInsightCard insights={insights} date={insightDate} />
      <div className="w-full">
        <ChatInput
          value={input}
          onChange={setInput}
          contentType={contentType}
          onContentTypeChange={setContentType}
          onSend={handleSend}
          disabled={isLoading}
          autoFocus
        />
      </div>
    </div>
  );
}
