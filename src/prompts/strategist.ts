import type {
  AnalyticsSummary,
  CsvSummary,
  FollowersSnapshotItem,
  GoalTrackingData,
  PastDecisionItem,
  ScheduledSlot,
  TrendItem,
  XProfile,
} from "../lib/types";
import type { ScheduleConfig } from "../app/actions/schedule";

export function getStrategistPrompt(): string {
  return `You are an expert X (Twitter) growth strategist. Your job is to analyze account performance data and produce a concrete, actionable weekly content strategy.

You have access to a web search tool. Use it to find the latest research and best practices for growing X accounts in 2026.

## Your Process

### Step 0 — Review Past Decisions (skip if no Past Strategy Decisions provided)
If the user message contains a "## Past Strategy Decisions" section, evaluate each decision:
- Compare metrics before vs. now: impressions, followers/week, engagement rate
- Mark as EFFECTIVE if any key metric improved by >10%, INEFFECTIVE if metrics declined or unchanged
- Include your evaluation in the "📊 Your Numbers at a Glance" section under "**Past decisions review:**"
- Do NOT propose reversing effective decisions. Do NOT re-propose what already works.

### Step 1 — Research (use webSearch tool, 3–5 queries)
Always run these 2 core queries:
- "X Twitter algorithm 2026 what content gets boosted"
- "best posting time X Twitter 2026"

Then run 1–3 adaptive queries based on the user's data weaknesses:
- Engagement rate < 1.5% → "how to improve X engagement rate 2026"
- New follows < 5 per week → "X reply strategy to gain followers 2026"
- Threads are top performers → "X thread strategy growth 2026"
- Impressions are low → "X impression boosting tactics 2026"
- No clear pattern in top posts → "X content mix strategy 2026"

### Step 2 — Analysis
After searching, analyze the user's data alongside your research findings:
- What is working? (high-impression posts — what do they have in common?)
- What is underperforming? (low-impression posts — why?)
- What patterns emerge from the top 5 posts?
- How does posting frequency compare to recommended levels (target: 3+ posts/day OR 1 post + 10–15 quality replies/day)?
- Engagement rate benchmark: > 2.5% = strong, 1–2.5% = average, < 1% = needs fixing
- Follower growth rate: target ≥ 5% monthly
- **Consistency check**: Are there gaps in the posting schedule? The X algorithm penalizes inconsistency — flag any days with 0 posts and propose fixes.
- **Trending topics**: Are any current trends relevant to the user's niche? If so, note the urgency — AI trends live 4–8 days, act within 12–24 hours.
- **Goal tracking**: Is the user on track to hit their follower target? Calculate required daily growth vs actual.

### Step 3 — Strategy Output
Produce a structured weekly strategy using EXACTLY this markdown format:

---

## X Growth Strategy — Week of [date range]

### 📊 Your Numbers at a Glance
- Total posts analyzed: [N]
- Avg impressions per post: [N]
- Best post: [N] impressions
- New followers gained: [N]
- Engagement rate: [N]% ([strong / average / needs fixing] vs 2.5% benchmark)
- Follower growth rate: [N]% ([on track / below target] vs 5% monthly target)
- Goal progress: [current] / [target] followers — [on track / N days behind / N days ahead]

### 🔍 What's Working
[2–3 specific observations from the top posts. Be concrete — mention actual post patterns, not generic advice.]

### ⚠️ What to Fix
[2–3 specific problems identified. Be direct.]

### 📅 Weekly Plan

**Daily posting target:**
- Posts: [N] per day
- Replies: [N] per day (reply sessions)
- Threads: [N] per week
- Best posting times: [specific times, e.g., "9:00 AM, 1:00 PM, 6:00 PM"]

**Topics to focus on this week:**
1. [Topic 1] — [why it fits your niche and what angle to take]
2. [Topic 2] — [why it fits your niche and what angle to take]
3. [Topic 3] — [why it fits your niche and what angle to take]

**Content format mix:**
- [%] original insights / hot takes
- [%] educational threads
- [%] personal stories / case studies
- [%] curated commentary (replies to big accounts)
- [%] multimedia posts (if applicable)

### 💡 One Specific Experiment This Week
- **Hypothesis**: [what we're testing and why]
- **Test**: [specific action to take, e.g., "Post at 8 AM instead of 10 AM for 3 consecutive days"]
- **Success Metric**: [what to measure, e.g., "avg impressions per post"]
- **Decision Threshold**: [e.g., "If morning posts average > [N+20%], make it the default posting time"]

### 📚 Sources Used
[List the key articles/sources from your web searches that informed this strategy]

---

### Step 4 — Schedule Config Proposal
Based on your analysis, propose changes to the user's **recurring weekly schedule template** (not one-time slots).

Look at the Current Schedule Config section. Identify:
- Missing content types or time slots that research supports → propose adding
- Underperforming time slots based on data → propose removing
- Do NOT propose changes that are already in the config and working (see Past Decisions)
- Output empty array [] if the current config already matches your recommendations

Output a JSON block (can be empty array [] if no changes needed):

\`\`\`json:config-proposal
[
  {"action": "add", "section": "replies", "time": "08:00", "days": {"Mon": true, "Wed": true, "Fri": true}, "reason": "..."},
  {"action": "remove", "section": "posts", "time": "15:00", "days": {"Tue": true, "Thu": true}, "reason": "..."}
]
\`\`\`

Valid actions: "add", "remove".
Valid sections: "replies", "posts", "threads", "articles".
Time format: "HH:MM" in 24h (e.g. "09:00", "18:30").
Days: any subset of Mon, Tue, Wed, Thu, Fri, Sat, Sun.
Each change applies to ALL future weeks — think in terms of recurring patterns, not specific dates.

## Rules
- Be specific, not generic. Use actual numbers from the user's data.
- Ground every recommendation in either their actual data or a specific source you found.
- Do not recommend things that conflict with each other.
- Keep the total output under 1200 words — this is a weekly action plan, not an essay.
- All output in Russian.
- At the very end, add a short section **"📋 Что поможет улучшить следующий анализ"** — list 2–3 specific data points that are missing and would make the strategy more accurate. Skip this section if all key data is already provided.`;
}

export function buildStrategistUserMessage(
  summary: AnalyticsSummary | CsvSummary,
  weekStart: string,
  profile?: XProfile,
  followersHistory?: FollowersSnapshotItem[],
  trends?: TrendItem[],
  _scheduledSlots?: ScheduledSlot[],
  researchNotes?: { topic: string; summary: string }[],
  previousAnalysis?: string,
  goalData?: GoalTrackingData,
  scheduleConfig?: ScheduleConfig,
  pastDecisions?: PastDecisionItem[]
): string {
  // --- Profile section ---
  const hasProfile = profile && (profile.name || profile.username || profile.followers);
  const profileSection = hasProfile
    ? `## My Account Profile
${profile.name ? `- Name: ${profile.name}` : ""}
${profile.username ? `- Username: @${profile.username}` : ""}
${profile.bio ? `- Bio: ${profile.bio}` : ""}
${profile.followers ? `- Followers: ${profile.followers}` : ""}
${profile.following ? `- Following: ${profile.following}` : ""}`.trim()
    : "";

  // --- Stats section (handle both AnalyticsSummary and legacy CsvSummary) ---
  let statsSection: string;
  let topPostsSection: string;

  if ("totalReplies" in summary) {
    // AnalyticsSummary
    const s = summary as AnalyticsSummary;
    statsSection = `## My Stats
- Period: ${s.dateRange.from} to ${s.dateRange.to} (${s.periodDays} days)
- Total posts: ${s.totalPosts}
- Total replies: ${s.totalReplies}
- Avg impressions per post: ${s.avgPostImpressions}
- Avg impressions per reply: ${s.avgReplyImpressions}
- Max impressions (single post): ${s.maxPostImpressions}
- Total new followers gained: ${s.totalNewFollows}
- Total unfollows: ${s.totalUnfollows}
- Net follower growth: ${s.netFollowerGrowth}
- Avg engagement rate: ${s.avgEngagementRate}%
- Avg profile visits/day: ${s.avgProfileVisitsPerDay}`;

    topPostsSection =
      s.topPosts.length > 0
        ? `## My Top 5 Posts by Impressions
${s.topPosts
  .slice(0, 5)
  .map(
    (p, i) =>
      `${i + 1}. "${p.text.slice(0, 120)}" — ${p.impressions} impressions, ${p.engagements} engagements, ${p.likes} likes`
  )
  .join("\n")}`
        : "";
  } else {
    // Legacy CsvSummary
    const s = summary as CsvSummary;
    statsSection = `## My Stats
- Period: ${s.dateRange.from} to ${s.dateRange.to}
- Total posts: ${s.totalPosts}
- Avg impressions per post: ${s.avgImpressions}
- Max impressions (single post): ${s.maxImpressions}
- Total new followers gained: ${s.totalNewFollows}
- Avg engagement rate: ${s.avgEngagementRate}%`;

    topPostsSection =
      s.topPosts.length > 0
        ? `## My Top 5 Posts by Impressions
${s.topPosts
  .map(
    (p, i) =>
      `${i + 1}. "${p.text}" — ${p.impressions} impressions, ${p.engagements} engagements, ${p.likes} likes`
  )
  .join("\n")}`
        : "";
  }

  // --- Followers history section ---
  const followersSection =
    followersHistory && followersHistory.length > 0
      ? `## Followers Growth (last ${followersHistory.length} days)
${followersHistory
  .map(
    (s) =>
      `- ${s.date.toISOString().split("T")[0]}: ${s.followersCount} followers (${s.deltaFollowers >= 0 ? "+" : ""}${s.deltaFollowers})`
  )
  .join("\n")}`
      : "";

  // --- Goal tracking section ---
  const goalSection = goalData
    ? `## Goal Tracking
- Current followers: ${goalData.currentFollowers}
- Target: ${goalData.targetFollowers} by ${goalData.targetDate.toISOString().split("T")[0]}
- Rolling 30-day avg growth: +${goalData.dailyAvgGrowth}/day
- Projected reach date: ${goalData.projectedDate ? goalData.projectedDate.toISOString().split("T")[0] : "unknown (no positive growth)"}
- Deviation: ${goalData.deviationDays > 0 ? `${goalData.deviationDays} days ahead` : goalData.deviationDays < 0 ? `${Math.abs(goalData.deviationDays)} days behind` : "on track"}
- Status: ${goalData.onTrack ? "✅ On track" : "❌ Behind schedule"}`
    : "";

  // --- Trends section ---
  const trendsSection =
    trends && trends.length > 0
      ? `## Current Trends on X (personalized)
${trends
  .slice(0, 10)
  .map((t) => `- ${t.trendName}${t.category ? ` [${t.category}]` : ""} — ${t.postCount} posts`)
  .join("\n")}
Note: AI-niche trends typically live 4–8 days. If any trend is relevant to your niche, act within 12–24 hours.`
      : "";

  // --- Recent research section ---
  const researchSection =
    researchNotes && researchNotes.length > 0
      ? `## Recent Research Notes
${researchNotes
  .slice(0, 3)
  .map((n, i) => `${i + 1}. **${n.topic}**\n${n.summary.slice(0, 200)}...`)
  .join("\n\n")}`
      : "";

  // --- Previous strategy section ---
  const previousSection = previousAnalysis
    ? `## Previous Strategy (summary)
${previousAnalysis.slice(0, 500)}...`
    : "";

  // --- Current schedule config section ---
  const scheduleConfigSection = scheduleConfig
    ? (() => {
        const DAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
        function time24to12(t: string) {
          const [h, m] = t.split(":").map(Number);
          if (isNaN(h) || isNaN(m)) return t;
          const p = h >= 12 ? "PM" : "AM";
          const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
          return `${h12}:${m.toString().padStart(2, "0")} ${p}`;
        }
        function fmtSection(
          label: string,
          cs: { slots: { time: string; days: Record<string, boolean> }[] }
        ) {
          if (cs.slots.length === 0) return `- ${label}: (none)`;
          const parts = cs.slots.map((s) => {
            const activeDays = DAY_ORDER.filter((d) => s.days[d]).join("/");
            return `${activeDays} at ${time24to12(s.time)}`;
          });
          return `- ${label}: ${parts.join(", ")}`;
        }
        return `## Current Schedule Config
${fmtSection("replies", scheduleConfig.replies)}
${fmtSection("posts", scheduleConfig.posts)}
${fmtSection("threads", scheduleConfig.threads)}
${fmtSection("articles", scheduleConfig.articles)}`;
      })()
    : "## Current Schedule Config\nNo schedule configured yet.";

  // --- Past decisions section ---
  const pastDecisionsSection =
    pastDecisions && pastDecisions.length > 0
      ? `## Past Strategy Decisions (last 30 days)
${pastDecisions
  .map((d, i) => {
    const before = d.metricsAtDecision;
    return `${i + 1}. ${d.date} — Changes: ${d.changes
      .map((c) => {
        const days = Object.entries(c.days)
          .filter(([, v]) => v)
          .map(([k]) => k)
          .join("/");
        return `${c.action} ${c.section} slot ${days} at ${c.time}`;
      })
      .join("; ")}
   Reason: "${d.rationale.slice(0, 150)}"
   Metrics at decision: avg ${before.avgImpressions} impressions, +${before.newFollowersPerWeek} followers/week, ${before.engagementRate}% engagement`;
  })
  .join("\n\n")}`
      : "";

  const sections = [
    `Here is my X account analytics data for the week starting ${weekStart}.`,
    profileSection,
    statsSection,
    topPostsSection,
    followersSection,
    goalSection,
    trendsSection,
    scheduleConfigSection,
    researchSection,
    previousSection,
    pastDecisionsSection,
    "Please search the web for the latest X growth strategies, analyze my data, and produce my weekly strategy.",
  ].filter(Boolean);

  return sections.join("\n\n");
}
