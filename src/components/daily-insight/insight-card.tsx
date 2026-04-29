"use client";

import {
  Sparkles,
  Lightbulb,
  TrendingUp,
  AlertTriangle,
  Heart,
  type LucideIcon,
} from "lucide-react";
import { XIcon, LinkedInIcon, ThreadsIcon } from "@/components/platform-icons";
import type { Platform } from "@/lib/types";

// 2026-04 refactor: Insight cards now have 5 deliberate types instead
// of one rotating bullet. Visual differentiation is via:
//   - icon (lucide) on the left
//   - thin left-border accent in the type's tone
//   - small platform glyph next to the icon when the card is platform-
//     specific (tactical/opportunity/warning) — reuses the same
//     monochrome SlotItem pattern from the schedule list
//
// Colors come from existing palette tokens (no new theme additions).
//   - headline: foreground (the lead — no accent)
//   - tactical: blue-400 (matches active/scheduled in the rest of the UI)
//   - opportunity: emerald-400 (matches "posted/positive")
//   - warning: amber-500 (between blue and destructive)
//   - encouragement: muted-foreground (deliberately quiet)

export type InsightCardType = "headline" | "tactical" | "opportunity" | "warning" | "encouragement";

const ICON_MAP: Record<InsightCardType, LucideIcon> = {
  headline: Sparkles,
  tactical: Lightbulb,
  opportunity: TrendingUp,
  warning: AlertTriangle,
  encouragement: Heart,
};

const ACCENT_MAP: Record<InsightCardType, string> = {
  headline: "text-foreground",
  tactical: "text-blue-400",
  opportunity: "text-emerald-400",
  warning: "text-amber-500",
  encouragement: "text-muted-foreground",
};

const BORDER_MAP: Record<InsightCardType, string> = {
  headline: "border-l-foreground/40",
  tactical: "border-l-blue-400",
  opportunity: "border-l-emerald-400",
  warning: "border-l-amber-500",
  encouragement: "border-l-muted-foreground/50",
};

const TYPE_LABEL: Record<InsightCardType, string> = {
  headline: "Сегодня",
  tactical: "Тактика",
  opportunity: "Окно",
  warning: "Внимание",
  encouragement: "Поддержка",
};

const PLATFORM_ICON: Record<Platform, typeof XIcon> = {
  X: XIcon,
  LINKEDIN: LinkedInIcon,
  THREADS: ThreadsIcon,
};

export interface InsightCardProps {
  type: InsightCardType;
  text: string;
  /** Optional platform tag — only meaningful for tactical / opportunity / warning. */
  platform?: Platform;
}

export function InsightCard({ type, text, platform }: InsightCardProps) {
  const Icon = ICON_MAP[type];
  const accent = ACCENT_MAP[type];
  const border = BORDER_MAP[type];
  const PlatformGlyph = platform ? PLATFORM_ICON[platform] : null;

  return (
    <div
      className={`flex flex-col gap-1.5 rounded-md border-l-2 bg-card/60 px-3 py-2.5 ${border}`}
      role="article"
      aria-label={TYPE_LABEL[type]}
    >
      <header className="flex items-center gap-2">
        <Icon className={`h-4 w-4 shrink-0 ${accent}`} aria-hidden />
        {PlatformGlyph && <PlatformGlyph className="h-3 w-3 shrink-0 text-muted-foreground" />}
        <span className="text-xs uppercase tracking-wider text-muted-foreground">
          {TYPE_LABEL[type]}
        </span>
      </header>
      <p className="text-sm leading-relaxed text-foreground/90">{text}</p>
    </div>
  );
}
