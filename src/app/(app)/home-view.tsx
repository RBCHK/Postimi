"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChatInput } from "@/components/chat-input";
import { DailyInsightCard } from "@/components/daily-insight-card";
import { GoalTrackingCard } from "@/components/goal-tracking-card";
import { PlanProposalBanner } from "@/components/plan-proposal-banner";
import { createConversation, resolveTitleFromInput, addMessage } from "@/app/actions/conversations";
import { extractTweetUrl } from "@/lib/parse-tweet";
import type { ContentType, GoalTrackingData, PlanProposalItem } from "@/lib/types";
import { PageContainer } from "@/components/page-container";

interface HomeViewProps {
  insights: string[] | null;
  insightDate: string | null;
  goalData: GoalTrackingData | null;
  hasGoalConfig: boolean;
  pendingProposal: PlanProposalItem | null;
}

export function HomeView({
  insights,
  insightDate,
  goalData,
  hasGoalConfig,
  pendingProposal,
}: HomeViewProps) {
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
      const originalPostUrl = extractTweetUrl(text) ?? undefined;
      const id = await createConversation({ title, contentType, originalPostUrl });
      await addMessage(id, "user", text);
      router.push(`/c/${id}`);
    } catch {
      setIsLoading(false);
    }
  }

  return (
    <PageContainer className="flex flex-1 flex-col items-center justify-center gap-4">
      {pendingProposal && <PlanProposalBanner proposal={pendingProposal} />}
      <GoalTrackingCard goalData={goalData} hasGoalConfig={hasGoalConfig} />
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
    </PageContainer>
  );
}
