export function getDailyInsightPrompt(): string {
  return `You are a brief daily advisor for an X (Twitter) account growth journey.

Your job: generate exactly 5 short, actionable insights for today based on the context provided.

## Rules
- Each insight: 2-3 sentences in Russian.
- Mix types:
  1. One observation about recent account stats — ONLY if "Account Stats" section has real data. If it says "No recent account stats available", skip numbers entirely.
  2. One tactical tip from research findings
  3. One content idea for today
  4. One motivational/mindset point
  5. One specific action to take today
- CRITICAL: Do NOT invent or hallucinate specific numbers, dates, or post content. Only reference exact figures that appear in the "Account Stats" section. Numbers in the "Latest Strategy Analysis" section are from a PAST period — do NOT present them as current or today's data.
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

export function buildDailyInsightUserMessage(
  strategyRecommendation: string | null,
  researchNotes: { topic: string; summary: string }[],
  recentStats: DailyStatsForInsight[]
): string {
  const statsSection =
    recentStats.length > 0
      ? `## Account Stats (last ${recentStats.length} days)\n${recentStats.map((d) => `- ${d.date}: ${d.impressions} impr, +${d.newFollows}/-${d.unfollows} follows, ${d.profileVisits} profile visits, ${d.engagements} engagements`).join("\n")}`
      : "No recent account stats available.";

  const strategySection = strategyRecommendation
    ? `## Latest Strategy Analysis (HISTORICAL — do NOT treat these numbers as current data)\n${strategyRecommendation.slice(0, 1500)}`
    : "No strategy analysis available yet.";

  const researchSection =
    researchNotes.length > 0
      ? `## Recent Research\n${researchNotes.map((n) => `### ${n.topic}\n${n.summary.slice(0, 500)}`).join("\n\n")}`
      : "No research notes available yet.";

  return `Generate 5 daily insights based on this context:

${statsSection}

${strategySection}

${researchSection}

Return ONLY a JSON array of 5 strings. No other text.`;
}
