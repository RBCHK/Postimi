export function getDailyInsightPrompt(): string {
  return `You are a brief daily advisor for an X (Twitter) account growth journey.

Your job: generate exactly 5 short, actionable insights for today based on the context provided.

## Rules
- Each insight: 2-3 sentences in Russian.
- Mix types:
  1. One observation about recent account stats — ONLY if "Account Stats" section has real data. If it says "No recent account stats available", skip numbers entirely.
  2. One tactical tip from research findings
  3. One content idea for today — if "Trending Today on X" section has trends, at least one insight MUST propose a specific angle on an active trend. Emphasize urgency: "тренд живёт 12–24 часа, действуй сегодня".
  4. One motivational/mindset point
  5. One specific action to take today
- CRITICAL: Do NOT invent or hallucinate specific numbers, dates, or post content. Only reference exact figures that appear in the "Account Stats" or "Followers" sections. Numbers in the "Latest Strategy Analysis" section are from a PAST period — do NOT present them as current or today's data.
- If unfollows exceed new follows for 2+ consecutive days in Account Stats, include a warning insight about potential content-audience misalignment and suggest reviewing recent content strategy.
- Do NOT use markdown formatting inside insights — plain text only.
- Do NOT number the insights.
- Output MUST be valid JSON: ["insight1", "insight2", "insight3", "insight4", "insight5"]
- Language: Russian.`;
}

interface DailyStatsForInsight {
  date: string;
  impressions: number;
  newFollows: number;
  unfollows: number;
  profileVisits: number;
  engagements: number;
}

export interface TrendForInsight {
  trendName: string;
  postCount: number;
  category?: string;
}

export function buildDailyInsightUserMessage(
  strategyRecommendation: string | null,
  researchNotes: { topic: string; summary: string }[],
  recentStats: DailyStatsForInsight[],
  trends?: TrendForInsight[],
  latestFollowers?: { followersCount: number; deltaFollowers: number } | null
): string {
  const statsSection =
    recentStats.length > 0
      ? `## Account Stats (last ${recentStats.length} days)\n${recentStats.map((d) => `- ${d.date}: ${d.impressions} impr, +${d.newFollows}/-${d.unfollows} follows, ${d.profileVisits} profile visits, ${d.engagements} engagements`).join("\n")}`
      : "No recent account stats available.";

  const followersSection = latestFollowers
    ? `## Followers (current)\n- Total: ${latestFollowers.followersCount}\n- Today's change: ${latestFollowers.deltaFollowers >= 0 ? "+" : ""}${latestFollowers.deltaFollowers}`
    : "";

  const strategySection = strategyRecommendation
    ? `## Latest Strategy Analysis (HISTORICAL — do NOT treat these numbers as current data)\n${strategyRecommendation.slice(0, 1500)}`
    : "No strategy analysis available yet.";

  const researchSection =
    researchNotes.length > 0
      ? `## Recent Research\n${researchNotes.map((n) => `### ${n.topic}\n${n.summary.slice(0, 500)}`).join("\n\n")}`
      : "No research notes available yet.";

  const trendsSection =
    trends && trends.length > 0
      ? `## Trending Today on X\n${trends
          .slice(0, 8)
          .map(
            (t) => `- ${t.trendName}${t.category ? ` [${t.category}]` : ""} — ${t.postCount} posts`
          )
          .join("\n")}`
      : "";

  const sections = [
    "Generate 5 daily insights based on this context:",
    statsSection,
    followersSection,
    strategySection,
    researchSection,
    trendsSection,
    "Return ONLY a JSON array of 5 strings. No other text.",
  ].filter(Boolean);

  return sections.join("\n\n");
}
