"use client";

import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Sparkles } from "lucide-react";

interface DailyInsightCardProps {
  insights: string[] | null;
  date: string | null;
}

const FALLBACK_TEXT =
  "Hi! I’m ready to help grow your X account. I’ll start sharing daily insights as soon as you connect your X account.";

const ROTATION_MS = 15 * 60 * 1000; // 15 minutes

function getHourIndex(count: number): number {
  return Math.floor(Date.now() / ROTATION_MS) % count;
}

export function DailyInsightCard({ insights, date }: DailyInsightCardProps) {
  const hasInsights = insights && insights.length > 0;

  const [index, setIndex] = useState(() => (hasInsights ? getHourIndex(insights.length) : 0));

  useEffect(() => {
    if (!hasInsights) return;

    setIndex(getHourIndex(insights.length));

    const interval = setInterval(() => {
      setIndex(getHourIndex(insights.length));
    }, 60_000);

    return () => clearInterval(interval);
  }, [hasInsights, insights?.length]);

  const displayText = hasInsights ? insights[index] : FALLBACK_TEXT;

  return (
    <Card className="mx-auto w-full max-w-chat bg-transparent border-0 shadow-none">
      <CardContent className="flex items-start gap-3 p-0">
        <Sparkles className="size-4 shrink-0 mt-0.5 text-muted-foreground" />
        <div className="min-w-0">
          <p className="text-sm leading-relaxed">{displayText}</p>
          {date && hasInsights && <p className="mt-1.5 text-xs text-muted-foreground">{date}</p>}
        </div>
      </CardContent>
    </Card>
  );
}
