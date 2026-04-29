"use client";

import { Sparkles } from "lucide-react";
import { InsightCard, type InsightCardProps } from "./insight-card";
import type { DailyInsightPayload } from "@/lib/types";

// 2026-04 refactor: variable-length card feed (1–7 cards/day) replaces
// the rotating-bullet `<DailyInsightCard>`. Two render paths:
//
//   1. New shape (`DailyInsightCards` object): the cron writes this
//      after the model returns a structured response.
//   2. Legacy shape (`string[]`): pre-refactor rows, kept renderable so
//      we don't need a one-off DB backfill of the JSON column. Each
//      string becomes a tactical card with no platform tag — reasonable
//      degradation for old data.
//
// Discriminator-free: `Array.isArray` distinguishes legacy from new at
// the type level. The DB column is `Json`, so any reader code that
// touches it goes through this component.
//
// Layout: composer-first home preserved. Cards stack with `gap-3` and
// the container is height-capped at 40dvh with scroll — variable-
// length feed never pushes the chat input below the iPhone keyboard.

const FALLBACK_HEADLINE = "Hi! Connect a platform to get daily, tailored insights.";

interface InsightFeedProps {
  cards: DailyInsightPayload | null;
  date: string | null;
}

export function InsightFeed({ cards, date }: InsightFeedProps) {
  // Cold-start state: no insight yet today (or ever).
  if (cards === null) {
    return (
      <div className="mx-auto flex w-full max-w-chat items-start gap-3 px-1">
        <Sparkles className="size-4 shrink-0 mt-0.5 text-muted-foreground" />
        <p className="text-sm leading-relaxed text-muted-foreground">{FALLBACK_HEADLINE}</p>
      </div>
    );
  }

  const renderable = toRenderableCards(cards);

  if (renderable.length === 0) {
    // Defensive: a malformed-but-non-null payload that yielded zero
    // cards. Render the fallback rather than an empty container that
    // collapses unpredictably.
    return (
      <div className="mx-auto flex w-full max-w-chat items-start gap-3 px-1">
        <Sparkles className="size-4 shrink-0 mt-0.5 text-muted-foreground" />
        <p className="text-sm leading-relaxed text-muted-foreground">{FALLBACK_HEADLINE}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-chat flex-col gap-2.5 px-1">
      <div className="flex max-h-[40dvh] flex-col gap-2.5 overflow-y-auto pr-1">
        {renderable.map((card, i) => (
          <InsightCard
            key={`${card.type}-${i}`}
            type={card.type}
            text={card.text}
            platform={card.platform}
          />
        ))}
      </div>
      {date && <p className="px-3 text-xs text-muted-foreground">{date}</p>}
    </div>
  );
}

/**
 * Discriminate legacy `string[]` from the new `DailyInsightCards` object
 * and emit a stable-ordered array of renderable cards. Exported so the
 * unit test can exercise the dispatch logic without needing React
 * Testing Library — that's where ~all the interesting branching lives.
 */
export function toRenderableCards(payload: DailyInsightPayload): InsightCardProps[] {
  if (Array.isArray(payload)) {
    // Legacy `string[]` — render each as a generic tactical card. No
    // platform tag because legacy data didn't carry one.
    return payload
      .filter((s) => typeof s === "string" && s.length > 0)
      .map((text) => ({ type: "tactical" as const, text }));
  }

  // New shape: emit cards in stable order — headline first, then
  // tactical (in given order), opportunity, warning, encouragement.
  // The model decides what to skip via null/empty arrays; we never
  // synthesize cards that weren't returned.
  const out: InsightCardProps[] = [];

  if (payload.headline) {
    out.push({ type: "headline", text: payload.headline });
  }
  for (const t of payload.tactical ?? []) {
    out.push({ type: "tactical", text: t.text, platform: t.platform });
  }
  if (payload.opportunity) {
    out.push({
      type: "opportunity",
      text: payload.opportunity.text,
      platform: payload.opportunity.platform,
    });
  }
  if (payload.warning) {
    out.push({
      type: "warning",
      text: payload.warning.text,
      platform: payload.warning.platform,
    });
  }
  if (payload.encouragement) {
    out.push({ type: "encouragement", text: payload.encouragement });
  }

  return out;
}
