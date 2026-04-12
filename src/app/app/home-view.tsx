"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChatInput } from "@/components/chat-input";
import { DailyInsightCard } from "@/components/daily-insight-card";
import { GoalTrackingCard } from "@/components/goal-tracking-card";
import { PlanProposalBanner } from "@/components/plan-proposal-banner";
import { createConversationWithMessage } from "@/app/actions/conversations";
import type { ContentType, GoalTrackingData, PlanProposalItem } from "@/lib/types";
import { HomeComposerPanel } from "@/components/home-composer-panel";

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
  const [contentType, setContentType] = useState<ContentType>("Post");
  const [isLoading, setIsLoading] = useState(false);

  async function handleSend() {
    const text = input.trim();
    if (!text || isLoading) return;
    setIsLoading(true);
    try {
      const id = await createConversationWithMessage(text, contentType);
      router.push(`/c/${id}`);
    } catch {
      setIsLoading(false);
    }
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-4 md:rounded-[12px] md:bg-sidebar">
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
      </div>
      <HomeComposerPanel />
    </div>
  );
}
