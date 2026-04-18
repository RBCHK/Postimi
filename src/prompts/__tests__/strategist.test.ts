import { describe, it, expect } from "vitest";
import { getStrategistPrompt, buildStrategistUserMessage } from "../strategist";
import type { AnalyticsSummary, ContentCsvRow } from "../../lib/types";
import type { BenchmarkRow } from "@/app/actions/benchmarks";

function makeTopPost(text: string, impressions: number): ContentCsvRow {
  return {
    postId: `id-${impressions}`,
    date: "2026-01-01",
    text,
    postLink: "",
    postType: "Post",
    impressions,
    likes: Math.round(impressions * 0.01),
    engagements: Math.round(impressions * 0.02),
    bookmarks: 0,
    shares: 0,
    newFollowers: 0,
    replies: 0,
    reposts: 0,
    profileVisits: 0,
    detailExpands: 0,
    urlClicks: 0,
  };
}

describe("getStrategistPrompt — platform parameterization", () => {
  it("renders X-specific header and platform notes", () => {
    const p = getStrategistPrompt("X", "EN");
    expect(p).toContain("X (Twitter) growth strategist");
    expect(p).toContain("X algorithm");
    expect(p).toContain("All output in English");
    expect(p).toContain("X (Twitter) Growth Strategy");
    expect(p).toContain('"replies", "posts", "threads", "articles"');
  });

  it("renders LinkedIn-specific header and platform notes", () => {
    const p = getStrategistPrompt("LINKEDIN", "EN");
    expect(p).toContain("LinkedIn growth strategist");
    expect(p).toContain("LinkedIn rewards dwell time");
    expect(p).toContain("LinkedIn Growth Strategy");
    expect(p).toContain('"posts", "articles"');
    expect(p).not.toContain("X (Twitter)");
    expect(p).not.toContain("X algorithm");
  });

  it("renders Threads-specific header and platform notes", () => {
    const p = getStrategistPrompt("THREADS", "EN");
    expect(p).toContain("Threads growth strategist");
    expect(p).toContain("Threads rewards conversation");
    expect(p).toContain("Threads Growth Strategy");
    expect(p).toContain('"posts", "replies"');
    // Guard: the X-only "threads" schedule section selector must not
    // leak into the Threads prompt (which references the platform name
    // but has its own `"posts", "replies"` schedule sections).
    expect(p).not.toContain('"replies", "posts", "threads", "articles"');
  });

  it("LinkedIn and Threads prompts do NOT contain X-specific schedule sections", () => {
    const linkedin = getStrategistPrompt("LINKEDIN", "EN");
    const threads = getStrategistPrompt("THREADS", "EN");
    expect(linkedin).not.toContain('"replies", "posts", "threads", "articles"');
    expect(threads).not.toContain('"replies", "posts", "threads", "articles"');
  });

  it("uses current year (not a hardcoded 2026)", () => {
    const p = getStrategistPrompt("X", "EN");
    const year = new Date().getFullYear();
    expect(p).toContain(String(year));
    // The only remaining year reference in the system prompt is the
    // runtime year, so assert no other specific hardcoded year
    // appears that could indicate regression.
    const otherYears = ["2023", "2024", "2025"].filter((y) => y !== String(year));
    for (const y of otherYears) {
      expect(p).not.toContain(y);
    }
  });
});

describe("getStrategistPrompt — language parameterization", () => {
  it("injects language name for every supported language", () => {
    expect(getStrategistPrompt("X", "EN")).toContain("All output in English");
    expect(getStrategistPrompt("X", "RU")).toContain("All output in Russian");
    expect(getStrategistPrompt("X", "UK")).toContain("All output in Ukrainian");
    expect(getStrategistPrompt("X", "ES")).toContain("All output in Spanish");
    expect(getStrategistPrompt("X", "DE")).toContain("All output in German");
    expect(getStrategistPrompt("X", "FR")).toContain("All output in French");
  });

  it("does not contain a hardcoded 'Russian' default (regression)", () => {
    const en = getStrategistPrompt("X", "EN");
    expect(en).not.toContain("All output in Russian");
  });
});

describe("getStrategistPrompt — no hardcoded benchmarks", () => {
  it("prompt does not contain specific engagement-rate thresholds", () => {
    // Old prompt had "> 2.5% = strong, 1–2.5% = average, < 1%". Those
    // thresholds now live in PlatformBenchmark, not the system prompt.
    const p = getStrategistPrompt("X", "EN");
    expect(p).not.toContain("> 2.5%");
    expect(p).not.toContain("2.5% benchmark");
    expect(p).not.toContain("5% monthly target");
    // The prompt should direct the agent to the BENCHMARKS section in
    // the user message:
    expect(p.toLowerCase()).toContain("benchmark");
  });
});

describe("buildStrategistUserMessage — benchmarks + platform", () => {
  const baseSummary: AnalyticsSummary = {
    dateRange: { from: "2026-01-01", to: "2026-01-07" },
    periodDays: 7,
    totalPosts: 10,
    totalReplies: 5,
    avgPostImpressions: 500,
    avgReplyImpressions: 200,
    maxPostImpressions: 1500,
    totalNewFollows: 10,
    totalUnfollows: 2,
    netFollowerGrowth: 8,
    avgEngagementRate: 1.5,
    avgProfileVisitsPerDay: 50,
    topPosts: [makeTopPost("sample post", 1500)],
    topReplies: [],
    dailyStats: [],
    postsByDay: [],
  };

  const benchmarks: BenchmarkRow[] = [
    {
      platform: "X",
      audienceSize: "NANO",
      metric: "engagement_rate",
      thresholds: { strong: 2.5, avg: 1.0, weak: 0.3 },
      source: "Rival IQ 2025",
      sourceUrl: "https://rivaliq.com",
    },
  ];

  it("includes BENCHMARKS section when provided", () => {
    const msg = buildStrategistUserMessage(
      baseSummary,
      "2026-01-01",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      "X",
      benchmarks
    );
    expect(msg).toContain("## Benchmarks");
    expect(msg).toContain("engagement_rate");
    expect(msg).toContain("strong ≥ 2.5");
    expect(msg).toContain("Rival IQ 2025");
  });

  it("omits benchmarks section when array is empty", () => {
    const msg = buildStrategistUserMessage(
      baseSummary,
      "2026-01-01",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      "X",
      []
    );
    expect(msg).not.toContain("## Benchmarks");
  });

  it("includes platform name in opening line", () => {
    const msgX = buildStrategistUserMessage(
      baseSummary,
      "2026-01-01",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      "X"
    );
    const msgLI = buildStrategistUserMessage(
      baseSummary,
      "2026-01-01",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      "LINKEDIN"
    );
    expect(msgX).toContain("X (Twitter) account");
    expect(msgLI).toContain("LinkedIn account");
  });

  it("does not include X trends section for LinkedIn/Threads", () => {
    const trends = [{ trendName: "#AI", postCount: 10000 }];
    const msgLI = buildStrategistUserMessage(
      baseSummary,
      "2026-01-01",
      undefined,
      undefined,
      trends,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      "LINKEDIN"
    );
    const msgT = buildStrategistUserMessage(
      baseSummary,
      "2026-01-01",
      undefined,
      undefined,
      trends,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      "THREADS"
    );
    expect(msgLI).not.toContain("Current Trends");
    expect(msgT).not.toContain("Current Trends");
    // But X keeps its trends:
    const msgX = buildStrategistUserMessage(
      baseSummary,
      "2026-01-01",
      undefined,
      undefined,
      trends,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      "X"
    );
    expect(msgX).toContain("Current Trends on X");
  });

  it("defaults to X platform + no benchmarks when not specified (legacy callers)", () => {
    const msg = buildStrategistUserMessage(baseSummary, "2026-01-01");
    expect(msg).toContain("X (Twitter) account");
    expect(msg).not.toContain("## Benchmarks");
  });
});

describe("getStrategistPrompt — no user input reaches prompt", () => {
  // The `language` parameter goes through `languageName()` which is a
  // pure Language→string map. There's no code path that interpolates
  // a user-supplied string directly. This test documents that.
  it("only accepts Language enum values (type-level protection)", () => {
    // This test is a compile-time guard — if someone changes the
    // signature to accept `string`, tsc will fail on our callers.
    const langs = ["EN", "RU", "UK", "ES", "DE", "FR"] as const;
    for (const l of langs) {
      const p = getStrategistPrompt("X", l);
      expect(p).toMatch(/All output in [A-Za-z]+\.$/m);
    }
  });
});
