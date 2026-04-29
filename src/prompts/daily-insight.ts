import type {
  AnalyticsSummary,
  CsvSummary,
  FollowersSnapshotItem,
  Platform,
  TrendItem,
} from "@/lib/types";
import { z } from "zod";

// 2026-04 refactor: Daily Insight is now a structured card feed,
// produced by Sonnet 4.6 via AI SDK `generateObject`. The model
// decides 1–7 cards/day rather than always emitting 5 generic bullets.
//
// Card types:
//   - headline (always exactly 1) — the main focus today
//   - tactical[] (0–3) — platform-specific tips when signal exists
//   - opportunity? (0–1) — live trend window
//   - warning? (0–1) — declining metric, alert
//   - encouragement? (0–1) — motivational, only on bad days
//
// The Zod schema below is the source of truth: it's enforced by
// `generateObject` so the model can't return malformed JSON. If the
// model can't satisfy the schema after retries, the SDK throws
// `NoObjectGeneratedError` — the cron catches that and writes a
// clamped fallback so the UI still renders something.

const PLATFORM_ENUM = z.enum(["X", "LINKEDIN", "THREADS"]);

export const DAILY_INSIGHT_CARDS_SCHEMA = z.object({
  headline: z.string().min(1).max(500).describe("The main focus for today (1–2 sentences)"),
  tactical: z
    .array(
      z.object({
        platform: PLATFORM_ENUM,
        text: z.string().min(1).max(500),
      })
    )
    .max(3)
    .describe("0–3 platform-specific tactical tips. Only include when signal exists."),
  opportunity: z
    .object({
      platform: PLATFORM_ENUM,
      text: z.string().min(1).max(500),
    })
    .nullable()
    .describe("Optional 0–1 live trend window — set to null when nothing fits."),
  warning: z
    .object({
      platform: PLATFORM_ENUM,
      text: z.string().min(1).max(500),
    })
    .nullable()
    .describe("Optional 0–1 alert about a declining metric — null when not needed."),
  encouragement: z
    .string()
    .max(500)
    .nullable()
    .describe("Optional 0–1 motivational note — only on visibly bad days."),
});

export type DailyInsightCardsParsed = z.infer<typeof DAILY_INSIGHT_CARDS_SCHEMA>;

const DISPLAY_NAME: Record<Platform, string> = {
  X: "X (Twitter)",
  LINKEDIN: "LinkedIn",
  THREADS: "Threads",
};

// ─── System prompt ───────────────────────────────────────

interface PromptOpts {
  outputLanguageName: string;
  /** Platforms the user has connected — drives which sections are addressable. */
  connectedPlatforms: Platform[];
}

export function getDailyInsightPrompt(opts: PromptOpts): string {
  const platforms = opts.connectedPlatforms.map((p) => DISPLAY_NAME[p]).join(", ") || "(none yet)";

  return `You are a brief daily advisor for a creator growing accounts on multiple social platforms (${platforms}).

Your job: produce a structured set of 1–7 cards describing today's focus and any platform-specific tactics, opportunities, warnings, or encouragement based on the context provided.

## Card types

- **headline** (always exactly 1): the single most-important focus for today. 1–2 sentences. No platform tag — it's the lead.
- **tactical** (0–3): platform-specific tips. Each is 1–2 sentences and tagged with one platform. ONLY include when there's a concrete signal (e.g. a recent strong post worth amplifying, a posting-cadence gap, an algorithm pattern visible in the data). Do not invent generic advice.
- **opportunity** (0 or 1): a live trend window with a clear time horizon (e.g. "this trend has 12–24 hours"). Tagged with one platform. Skip with null if nothing relevant is trending.
- **warning** (0 or 1): an alert about a declining metric — engagement falling 3+ days, unfollows exceeding follows for 2+ days, etc. Tagged with one platform. Skip with null if metrics are stable.
- **encouragement** (0 or 1): a quiet motivational note. ONLY on visibly bad days (e.g. low publishing frequency AND declining metrics). On good days set to null — don't fake positivity.

## Tone per platform

- ${DISPLAY_NAME["X"]}: short, sharp, conversational.
- ${DISPLAY_NAME["LINKEDIN"]}: professional, measured, focused on dwell-time and comment quality.
- ${DISPLAY_NAME["THREADS"]}: chatty, reactive, leans on replies and quick takes.

## Hard rules

- Do NOT invent or hallucinate specific numbers, dates, or post content. Only reference figures that appear in the context the user message provides.
- Numbers in any "Latest Strategy Analysis" section are from a PAST period — never present them as today's data.
- Output language: ${opts.outputLanguageName}.
- The structured response is enforced by schema — return EXACTLY the shape requested.
- Quiet days are valid: 1 headline + null/empty for everything else IS the right answer when nothing is happening.`;
}

// ─── User message builder ─────────────────────────────────

interface DailyStatsForInsight {
  date: string;
  impressions: number;
  newFollows: number;
  unfollows: number;
  profileVisits: number;
  engagements: number;
}

export interface PerPlatformContext {
  platform: Platform;
  /** Last 7 days of daily stats, most-recent first. May be empty. */
  recentStats: DailyStatsForInsight[];
  /** Latest followers snapshot for this platform. May be null. */
  latestFollowers: FollowersSnapshotItem | null;
  /** Latest strategy recommendation (truncated text). May be null. */
  strategyRecommendation: string | null;
  /** Most recent research notes for this platform (mix of GLOBAL + USER scope). */
  researchNotes: { topic: string; summary: string }[];
  /** Optional analytics summary if a richer view was available (X-only today). */
  analyticsSummary?: AnalyticsSummary | CsvSummary;
  /** Trends — only populated for X (other platforms have no trend feed). */
  trends?: TrendItem[];
}

export function buildDailyInsightUserMessage(perPlatformContexts: PerPlatformContext[]): string {
  if (perPlatformContexts.length === 0) {
    return "No platforms are connected yet. Produce a single headline encouraging the user to connect their first platform; set tactical=[], opportunity=null, warning=null, encouragement=null.";
  }

  const sections: string[] = ["Generate a daily insight feed using only the context below."];

  for (const ctx of perPlatformContexts) {
    const name = DISPLAY_NAME[ctx.platform];
    sections.push(`# ${name}`);

    sections.push(
      ctx.recentStats.length > 0
        ? `## Account Stats (last ${ctx.recentStats.length} days)\n${ctx.recentStats
            .map(
              (d) =>
                `- ${d.date}: ${d.impressions} impr, +${d.newFollows}/-${d.unfollows} follows, ${d.profileVisits} profile visits, ${d.engagements} engagements`
            )
            .join("\n")}`
        : `## Account Stats\nNo recent stats available for ${name}.`
    );

    if (ctx.latestFollowers) {
      const f = ctx.latestFollowers;
      sections.push(
        `## Followers (current ${name})\n- Total: ${f.followersCount}\n- Today's change: ${
          f.deltaFollowers >= 0 ? "+" : ""
        }${f.deltaFollowers}`
      );
    }

    if (ctx.strategyRecommendation) {
      sections.push(
        `## Latest Strategy Analysis (${name}) — HISTORICAL — do NOT treat numbers as current\n${ctx.strategyRecommendation.slice(
          0,
          1500
        )}`
      );
    }

    if (ctx.researchNotes.length > 0) {
      sections.push(
        `## Recent Research (${name})\n${ctx.researchNotes
          .map((n) => `### ${n.topic}\n${n.summary.slice(0, 400)}`)
          .join("\n\n")}`
      );
    }

    if (ctx.platform === "X" && ctx.trends && ctx.trends.length > 0) {
      sections.push(
        `## Trending Today on X\n${ctx.trends
          .slice(0, 8)
          .map(
            (t) => `- ${t.trendName}${t.category ? ` [${t.category}]` : ""} — ${t.postCount} posts`
          )
          .join("\n")}`
      );
    }
  }

  sections.push(
    "Return ONLY the structured object. Quiet days are valid — set tactical=[], opportunity=null, warning=null, encouragement=null when nothing notable is happening, but always emit a headline."
  );

  return sections.join("\n\n");
}
