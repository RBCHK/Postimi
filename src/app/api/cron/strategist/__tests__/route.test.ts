/**
 * Contract test for the strategist cron.
 *
 * Strategist is the most complex cron (~420 LOC, per-platform loop, two
 * analytics paths). This test intentionally stays at the contract level
 * — we do NOT exhaustively cover every branch of buildPlatformContext /
 * proposal parsing. Those have their own tests in the helper modules.
 *
 * Contract:
 *   1. Bearer auth — 401 on missing/wrong token.
 *   2. Fails fast with 500 when TAVILY_API_KEY is missing — strategist
 *      cannot run without Tavily, silent no-op would hide the misconfig.
 *   3. Users with no connected platforms are skipped without calling
 *      reserveQuota (no quota burn on a user we can't help).
 *   4. Per-platform errors isolated: a throw on one platform doesn't
 *      abort other platforms or other users; Sentry captures; overall
 *      status is PARTIAL.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { cleanupByPrefix, createTestUser, randomSuffix } from "@/test/real-prisma";

const CRON_SECRET = "test-cron-secret";

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));
vi.mock("next/server", async () => {
  const actual = (await vi.importActual("next/server")) as Record<string, unknown>;
  return {
    ...actual,
    after: (cb: () => Promise<void> | void) => {
      void Promise.resolve()
        .then(cb)
        .catch(() => {});
    },
  };
});

// AI SDK — never hit Anthropic.
const generateTextMock = vi.hoisted(() => vi.fn());
vi.mock("ai", async () => {
  const actual = (await vi.importActual("ai")) as Record<string, unknown>;
  return { ...actual, generateText: generateTextMock };
});
vi.mock("@ai-sdk/anthropic", () => ({
  anthropic: (model: string) => ({ _model: model }),
}));

// Tavily client — never hit the real API.
const tavilySearchMock = vi.hoisted(() => vi.fn());
vi.mock("@tavily/core", () => ({
  tavily: () => ({ search: tavilySearchMock }),
}));

// ai-quota — reservations succeed by default.
const reserveQuotaMock = vi.hoisted(() => vi.fn());
const completeReservationMock = vi.hoisted(() => vi.fn());
const failReservationMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ai-quota", () => ({
  reserveQuota: reserveQuotaMock,
  completeReservation: completeReservationMock,
  failReservation: failReservationMock,
}));

// Platform / context helpers — mock at the boundary rather than
// inflating test fixtures with Social* rows. Contract-level test.
const getConnectedPlatformsMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/platforms", () => ({
  getConnectedPlatforms: getConnectedPlatformsMock,
}));

const getOutputLanguageMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/user-settings", () => ({
  getOutputLanguage: getOutputLanguageMock,
}));

const getRecentResearchNotesMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/research", () => ({
  getRecentResearchNotes: getRecentResearchNotesMock,
}));

const getScheduleConfigMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/schedule", () => ({
  getScheduleConfig: getScheduleConfigMock,
}));

const getAnalyticsSummaryMock = vi.hoisted(() => vi.fn());
const getAnalyticsDateRangeMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/analytics", () => ({
  getAnalyticsSummary: getAnalyticsSummaryMock,
  getAnalyticsDateRange: getAnalyticsDateRangeMock,
}));

const getSocialAnalyticsSummaryMock = vi.hoisted(() => vi.fn());
const getSocialAnalyticsDateRangeMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/social-analytics", () => ({
  getSocialAnalyticsSummary: getSocialAnalyticsSummaryMock,
  getSocialAnalyticsDateRange: getSocialAnalyticsDateRangeMock,
}));

const getFollowersHistoryMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/followers", () => ({
  getFollowersHistory: getFollowersHistoryMock,
}));

const getLatestTrendsMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/trends", () => ({
  getLatestTrends: getLatestTrendsMock,
}));

const saveAnalysisMock = vi.hoisted(() => vi.fn());
const getAnalysesMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/strategist", () => ({
  saveAnalysis: saveAnalysisMock,
  getAnalyses: getAnalysesMock,
}));

const savePlanProposalMock = vi.hoisted(() => vi.fn());
const getAcceptedProposalsMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/plan-proposal", () => ({
  savePlanProposal: savePlanProposalMock,
  getAcceptedProposals: getAcceptedProposalsMock,
}));

const getBenchmarksMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/benchmarks", () => ({
  getBenchmarks: getBenchmarksMock,
}));

const getXApiTokenForUserMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/x-token", () => ({
  getXApiTokenForUser: getXApiTokenForUserMock,
}));

const fetchUserDataMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/x-api", () => ({
  fetchUserData: fetchUserDataMock,
}));

const PREFIX = `cron_st_${randomSuffix()}_`;

beforeEach(() => {
  process.env.CRON_SECRET = CRON_SECRET;
  process.env.TAVILY_API_KEY = "test-tavily";
  vi.clearAllMocks();
  reserveQuotaMock.mockResolvedValue({ reservationId: "res-1" });
  completeReservationMock.mockResolvedValue(undefined);
  failReservationMock.mockResolvedValue(undefined);
  getOutputLanguageMock.mockResolvedValue("en-US");
  getRecentResearchNotesMock.mockResolvedValue([]);
  getScheduleConfigMock.mockResolvedValue(null);
  getAnalysesMock.mockResolvedValue([]);
  getAcceptedProposalsMock.mockResolvedValue([]);
  getBenchmarksMock.mockResolvedValue([]);
  getAnalyticsDateRangeMock.mockResolvedValue({
    from: new Date("2026-03-01"),
    to: new Date("2026-04-01"),
  });
  getAnalyticsSummaryMock.mockResolvedValue({
    totalPosts: 10,
    totalReplies: 5,
    dateRange: { from: "2026-03-01", to: "2026-04-01" },
    periodDays: 31,
    avgPostImpressions: 500,
    maxPostImpressions: 2000,
    totalNewFollows: 20,
    avgEngagementRate: 3,
    topPosts: [],
  });
  getFollowersHistoryMock.mockResolvedValue([]);
  getLatestTrendsMock.mockResolvedValue([]);
  getXApiTokenForUserMock.mockResolvedValue(null);
  saveAnalysisMock.mockResolvedValue({ id: "analysis-1" });
  tavilySearchMock.mockResolvedValue({ results: [] });
  generateTextMock.mockResolvedValue({
    text: "## Strategy\n\nDo things.",
    usage: { inputTokens: 100, outputTokens: 50 },
  });
});

afterEach(async () => {
  await cleanupByPrefix(PREFIX, { clerkId: true });
});

function authed() {
  return new NextRequest("https://app.postimi.com/api/cron/strategist", {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
}

describe("strategist cron — contract", () => {
  it("returns 401 when Bearer token is missing", async () => {
    const { GET } = await import("../route");
    const res = await GET(new NextRequest("https://app.postimi.com/api/cron/strategist"));
    expect(res.status).toBe(401);
    expect(getConnectedPlatformsMock).not.toHaveBeenCalled();
  });

  it("returns 500 when TAVILY_API_KEY is not configured", async () => {
    delete process.env.TAVILY_API_KEY;
    const { GET } = await import("../route");
    const res = await GET(authed());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/TAVILY_API_KEY/);
  });

  it("skips users with no connected platforms (no quota burn)", async () => {
    const user = await createTestUser({ clerkId: `${PREFIX}empty_${randomSuffix()}` });
    // Default: no platforms for any user. Keeps us isolated from other
    // parallel test users.
    getConnectedPlatformsMock.mockResolvedValue({ platforms: [], primary: null });

    const { GET } = await import("../route");
    const res = await GET(authed());
    expect(res.status).toBe(200);

    // No reserveQuota or saveAnalysis for OUR user. (Other parallel
    // users also get no platforms since the mock returns empty for all.)
    const reserveForUs = reserveQuotaMock.mock.calls.filter(
      (c) => (c[0] as { userId: string }).userId === user.id
    );
    const saveForUs = saveAnalysisMock.mock.calls.filter((c) => c[0] === user.id);
    expect(reserveForUs).toHaveLength(0);
    expect(saveForUs).toHaveLength(0);
  });

  it("isolates per-platform errors — Sentry captures, loop continues for other platforms", async () => {
    const user = await createTestUser({ clerkId: `${PREFIX}err_${randomSuffix()}` });
    // Only OUR user has two platforms — other parallel test users get
    // no platforms and are skipped. This keeps the generateText mock
    // counter deterministic.
    getConnectedPlatformsMock.mockImplementation(async (uid: string) => {
      if (uid === user.id) return { platforms: ["X", "LINKEDIN"], primary: "X" };
      return { platforms: [], primary: null };
    });

    // LinkedIn path reads from getSocialAnalytics* — provide a stub.
    getSocialAnalyticsDateRangeMock.mockResolvedValue({
      from: new Date("2026-03-01"),
      to: new Date("2026-04-01"),
    });
    getSocialAnalyticsSummaryMock.mockResolvedValue({
      totalPosts: 5,
      dateRange: { from: "2026-03-01", to: "2026-04-01" },
      avgPostImpressions: 100,
      maxPostImpressions: 300,
      totalNewFollows: 3,
      avgEngagementRate: 1,
      topPosts: [],
      followersSeries: [],
      latestFollowers: 0,
    });

    // First generateText call (X) throws; second (LINKEDIN) succeeds.
    let callNum = 0;
    generateTextMock.mockImplementation(async () => {
      callNum += 1;
      if (callNum === 1) throw new Error("AI exploded on X");
      return {
        text: "## Strategy\n\nDo things.",
        usage: { inputTokens: 10, outputTokens: 10 },
      };
    });

    const { GET } = await import("../route");
    const res = await GET(authed());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("PARTIAL");

    const results = body.results as Array<{
      userId: string;
      platform?: string;
      error?: string;
    }>;
    const ours = results.filter((r) => r.userId === user.id);
    expect(ours).toHaveLength(2);
    expect(ours.filter((r) => r.error).length).toBe(1);
    expect(ours.filter((r) => !r.error).length).toBe(1);

    const Sentry = await import("@sentry/nextjs");
    expect(Sentry.captureException).toHaveBeenCalled();

    // Failed reservation released.
    expect(failReservationMock).toHaveBeenCalled();
  });
});
