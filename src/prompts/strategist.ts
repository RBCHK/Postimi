import type {
  AnalyticsSummary,
  CsvSummary,
  FollowersSnapshotItem,
  PastDecisionItem,
  ScheduledSlot,
  TrendItem,
  XProfile,
} from "../lib/types";
import type { Platform, Language } from "@/generated/prisma";
import type { ScheduleConfig } from "../app/actions/schedule";
import type { BenchmarkRow } from "@/app/actions/benchmarks";
import { languageName } from "@/lib/i18n/language-names";

// ADR-008 Phase 6: Strategist is now platform-aware and language-aware.
//
// The system prompt used to hardcode "X Twitter growth strategist",
// the current year, benchmarks, and "All output in Russian". Those are
// all parameterized now:
//   - `platform` selects the platform-specific name + notes
//   - `language` selects the output language via `languageName()` —
//      which is a pure enum→name map, so there's no way user input
//      flows into the prompt
//   - year is computed at runtime from `new Date()`
//   - benchmarks are passed via the USER message (see cron route)
//     using `PlatformBenchmark` from DB, which admins curate

const PLATFORM_META: Record<
  Platform,
  {
    displayName: string;
    algoNotes: string;
    webSearchTopic: string;
    scheduleValidSections: string;
  }
> = {
  X: {
    displayName: "X (Twitter)",
    algoNotes:
      "The X algorithm favors original content, engagement within the first hour, and replies to larger accounts. Consistency matters — gaps get penalized. Threads are a distinct content type that index well.",
    webSearchTopic: "X Twitter growth algorithm best posting time engagement",
    scheduleValidSections: '"replies", "posts", "threads", "articles"',
  },
  LINKEDIN: {
    displayName: "LinkedIn",
    algoNotes:
      "LinkedIn rewards dwell time and early comments. Native documents (carousels) and long-form text posts outperform link shares. Posting Tue-Thu mornings in the author's timezone is standard advice. The feed is slower — a strong post can keep earning impressions for days.",
    webSearchTopic: "LinkedIn content strategy creator algorithm engagement",
    scheduleValidSections: '"posts", "articles"',
  },
  THREADS: {
    displayName: "Threads",
    algoNotes:
      "Threads rewards conversation — replies to your own post and to others drive reach. Shorter bursts, quick takes, and replies to trending topics work better than long essays. The feed mixes followed accounts with For You recommendations, so new accounts can reach a wide audience.",
    webSearchTopic: "Meta Threads growth strategy best posting time engagement",
    scheduleValidSections: '"posts", "replies"',
  },
};

export function getStrategistPrompt(platform: Platform, language: Language): string {
  const meta = PLATFORM_META[platform];
  const year = new Date().getFullYear();
  const outputLanguageName = languageName(language);

  return `You are an expert ${meta.displayName} growth strategist. Your job is to analyze account performance data and produce a concrete, actionable weekly content strategy.

You have access to a web search tool. Use it to find the latest research and best practices for growing ${meta.displayName} accounts in ${year}.

## Platform Notes
${meta.algoNotes}

## Your Process

### Step 0 — Review Past Decisions (skip if no Past Strategy Decisions provided)
If the user message contains a "## Past Strategy Decisions" section, evaluate each decision:
- Compare metrics before vs. now: impressions, followers/week, engagement rate
- Mark as EFFECTIVE if any key metric improved by >10%, INEFFECTIVE if metrics declined or unchanged
- Include your evaluation in the "📊 Your Numbers at a Glance" section under "**Past decisions review:**"
- Do NOT propose reversing effective decisions. Do NOT re-propose what already works.

### Step 1 — Research (use webSearch tool, 3–5 queries)
Always run these core queries (adapt the topic to the user's niche if obvious):
- "${meta.webSearchTopic} ${year}"

Then run 2–4 adaptive queries based on the user's data weaknesses. Pick from:
- Engagement rate below the AVG benchmark provided → "how to improve ${meta.displayName} engagement rate ${year}"
- New follows below weak threshold → "${meta.displayName} strategy to gain followers ${year}"
- Impressions are low → "${meta.displayName} impression boosting tactics ${year}"
- No clear pattern in top posts → "${meta.displayName} content mix strategy ${year}"

### Step 2 — Analysis
After searching, analyze the user's data alongside your research findings:
- What is working? (high-impression posts — what do they have in common?)
- What is underperforming? (low-impression posts — why?)
- What patterns emerge from the top 5 posts?
- How does posting frequency compare to recommended levels for ${meta.displayName}?
- Use the BENCHMARKS section in the user message (if provided) as the frame of reference — never invent numbers.
- **Consistency check**: Are there gaps in the posting schedule? Flag any days with 0 posts and propose fixes.

### Step 3 — Strategy Output
Produce a structured weekly strategy using EXACTLY this markdown format:

---

## ${meta.displayName} Growth Strategy — Week of [date range]

### 📊 Your Numbers at a Glance
- Total posts analyzed: [N]
- Avg impressions per post: [N]
- Best post: [N] impressions
- New followers gained: [N]
- Engagement rate: [N]% ([strong / average / weak / needs fixing] vs the benchmark in the user message)
- Follower growth rate: [N]% ([on track / below target] vs the benchmark in the user message)

### 🔍 What's Working
[2–3 specific observations from the top posts. Be concrete — mention actual post patterns, not generic advice.]

### ⚠️ What to Fix
[2–3 specific problems identified. Be direct.]

### 📅 Weekly Plan

**Daily posting target:**
- Posts: [N] per day
- Best posting times: [specific times]

**Topics to focus on this week:**
1. [Topic 1] — [why it fits your niche and what angle to take]
2. [Topic 2] — [why it fits your niche and what angle to take]
3. [Topic 3] — [why it fits your niche and what angle to take]

**Content format mix:**
[Platform-appropriate mix with percentages]

### 💡 One Specific Experiment This Week
- **Hypothesis**: [what we're testing and why]
- **Test**: [specific action to take]
- **Success Metric**: [what to measure]
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
  {"action": "add", "section": "posts", "time": "08:00", "days": {"Mon": true, "Wed": true, "Fri": true}, "reason": "..."},
  {"action": "remove", "section": "posts", "time": "15:00", "days": {"Tue": true, "Thu": true}, "reason": "..."}
]
\`\`\`

Valid actions: "add", "remove".
Valid sections for ${meta.displayName}: ${meta.scheduleValidSections}.
Time format: "HH:MM" in 24h (e.g. "09:00", "18:30").
Days: any subset of Mon, Tue, Wed, Thu, Fri, Sat, Sun.
Each change applies to ALL future weeks — think in terms of recurring patterns, not specific dates.

## Rules
- Be specific, not generic. Use actual numbers from the user's data and from the BENCHMARKS section.
- Ground every recommendation in either their actual data or a specific source you found.
- Do not recommend things that conflict with each other.
- Keep the total output under 1200 words — this is a weekly action plan, not an essay.
- All output in ${outputLanguageName}.
- At the very end, add a short section titled in ${outputLanguageName} along the lines of "What would improve the next analysis" — list 2–3 specific data points that are missing and would make the strategy more accurate. Skip this section if all key data is already provided.`;
}

// ─── User message builder ────────────────────────────────

function formatBenchmarksBlock(benchmarks: BenchmarkRow[]): string {
  if (benchmarks.length === 0) return "";
  const lines = benchmarks.map(
    (b) =>
      `- **${b.metric}**: strong ≥ ${b.thresholds.strong}, average ≥ ${b.thresholds.avg}, weak ≥ ${b.thresholds.weak} (below weak = needs urgent fix). Source: ${b.source}`
  );
  return `## Benchmarks (for this platform × your audience size)
${lines.join("\n")}`;
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
  scheduleConfig?: ScheduleConfig,
  pastDecisions?: PastDecisionItem[],
  platform: Platform = "X",
  benchmarks: BenchmarkRow[] = []
): string {
  const platformLabel = PLATFORM_META[platform].displayName;

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

  // --- Benchmarks section ---
  const benchmarksSection = formatBenchmarksBlock(benchmarks);

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

  // --- Trends section (X-only — other platforms don't expose trends) ---
  const trendsSection =
    platform === "X" && trends && trends.length > 0
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
    `Here is my ${platformLabel} account analytics data for the week starting ${weekStart}.`,
    profileSection,
    statsSection,
    benchmarksSection,
    topPostsSection,
    followersSection,
    trendsSection,
    scheduleConfigSection,
    researchSection,
    previousSection,
    pastDecisionsSection,
    `Please search the web for the latest ${platformLabel} growth strategies, analyze my data, and produce my weekly strategy.`,
  ].filter(Boolean);

  return sections.join("\n\n");
}
