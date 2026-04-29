/**
 * Contract test for the daily-insight cron (post-2026-04 refactor).
 *
 * Contract:
 *   1. Bearer auth — 401 on missing/wrong token.
 *   2. Happy path — calls generateObject with the structured cards
 *      schema, persists a DailyInsight whose `insights` is the new
 *      DailyInsightCards object.
 *   3. NoObjectGeneratedError → fallback save with clamped headline,
 *      Sentry warning, reservation completed (so the user isn't billed
 *      for nothing).
 *   4. Per-user errors isolated.
 *   5. QuotaExceededError soft-skip without Sentry exception.
 *   6. Per-platform context: connected={X, THREADS} → both sections
 *      appear; connected={} → degenerate prompt without crash.
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

// AI SDK — mock generateObject (post-refactor, was generateText).
// Keep NoObjectGeneratedError real so route's `instanceof` works.
const generateObjectMock = vi.hoisted(() => vi.fn());
vi.mock("ai", async () => {
  const actual = (await vi.importActual("ai")) as Record<string, unknown>;
  return { ...actual, generateObject: generateObjectMock };
});
vi.mock("@ai-sdk/anthropic", () => ({
  anthropic: (model: string) => ({ _model: model }),
}));

const reserveQuotaMock = vi.hoisted(() => vi.fn());
const completeReservationMock = vi.hoisted(() => vi.fn());
const failReservationMock = vi.hoisted(() => vi.fn());
const sweepStaleReservationsMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ai-quota", async () => {
  const actual = (await vi.importActual("@/lib/ai-quota")) as Record<string, unknown>;
  return {
    ...actual,
    reserveQuota: reserveQuotaMock,
    completeReservation: completeReservationMock,
    failReservation: failReservationMock,
    sweepStaleReservations: sweepStaleReservationsMock,
  };
});

const saveDailyInsightMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/daily-insight", () => ({
  saveDailyInsight: saveDailyInsightMock,
}));

const getLatestTrendsMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/trends", () => ({
  getLatestTrends: getLatestTrendsMock,
}));

const getLatestFollowersSnapshotMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/followers", () => ({
  getLatestFollowersSnapshot: getLatestFollowersSnapshotMock,
}));

const getRecentResearchNotesMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/research", () => ({
  getRecentResearchNotes: getRecentResearchNotesMock,
}));

const getConnectedPlatformsMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/platforms", () => ({
  getConnectedPlatforms: getConnectedPlatformsMock,
}));

const getOutputLanguageMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/user-settings", () => ({
  getOutputLanguage: getOutputLanguageMock,
}));

const PREFIX = `cron_di_${randomSuffix()}_`;

const SAFE_CARDS = {
  headline: "Сегодня держим ритм.",
  tactical: [],
  opportunity: null,
  warning: null,
  encouragement: null,
};

beforeEach(() => {
  process.env.CRON_SECRET = CRON_SECRET;
  vi.clearAllMocks();
  reserveQuotaMock.mockResolvedValue({ reservationId: "res-1", model: "claude-sonnet-4-6" });
  completeReservationMock.mockResolvedValue(undefined);
  failReservationMock.mockResolvedValue(undefined);
  sweepStaleReservationsMock.mockResolvedValue(0);
  getLatestTrendsMock.mockResolvedValue([]);
  getLatestFollowersSnapshotMock.mockResolvedValue(null);
  getRecentResearchNotesMock.mockResolvedValue([]);
  getConnectedPlatformsMock.mockResolvedValue({ platforms: ["X"], primary: "X" });
  getOutputLanguageMock.mockResolvedValue("RU");
  saveDailyInsightMock.mockResolvedValue({ id: "insight-1" });
  generateObjectMock.mockResolvedValue({
    object: SAFE_CARDS,
    usage: { inputTokens: 100, outputTokens: 50 },
  });
});

afterEach(async () => {
  await cleanupByPrefix(PREFIX, { clerkId: true });
});

function authed() {
  return new NextRequest("https://app.postimi.com/api/cron/daily-insight?manual=1", {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
}

describe("daily-insight cron — auth + sweep", () => {
  it("returns 401 when Bearer token is missing", async () => {
    const { GET } = await import("../route");
    const res = await GET(new NextRequest("https://app.postimi.com/api/cron/daily-insight"));
    expect(res.status).toBe(401);
    expect(sweepStaleReservationsMock).not.toHaveBeenCalled();
    expect(reserveQuotaMock).not.toHaveBeenCalled();
  });

  it("runs sweep + persists insight on happy path", async () => {
    const user = await createTestUser({ clerkId: `${PREFIX}ok_${randomSuffix()}` });

    const { GET } = await import("../route");
    const res = await GET(authed());
    expect(res.status).toBe(200);

    expect(sweepStaleReservationsMock).toHaveBeenCalledTimes(1);
    const callsForOurUser = saveDailyInsightMock.mock.calls.filter((c) => c[0] === user.id);
    expect(callsForOurUser).toHaveLength(1);
    // Saved with new card-object shape, not legacy string[]
    const savedArgs = callsForOurUser[0]![1];
    expect(savedArgs.insights).toMatchObject({
      headline: expect.any(String),
      tactical: expect.any(Array),
    });
    expect(Array.isArray(savedArgs.insights)).toBe(false);
  });
});

describe("daily-insight cron — Sonnet 4.6 + structured output", () => {
  it("invokes generateObject with the Sonnet 4.6 model and the cards schema", async () => {
    await createTestUser({ clerkId: `${PREFIX}m_${randomSuffix()}` });
    const { GET } = await import("../route");
    await GET(authed());

    expect(generateObjectMock).toHaveBeenCalled();
    const callArgs = generateObjectMock.mock.calls[0]![0];
    expect((callArgs.model as { _model: string })._model).toBe("claude-sonnet-4-6");
    // Schema is the Zod object exported from prompts/daily-insight.
    expect(callArgs.schema).toBeDefined();
    // Critical regression guard: prompt must include the user's
    // configured output language. A future change that drops
    // getOutputLanguage would otherwise silently default to English.
    expect(getOutputLanguageMock).toHaveBeenCalled();
    expect(callArgs.system).toMatch(/Output language/i);
  });

  it("OPERATION_ESTIMATES.daily_insight is sized for Sonnet, not Haiku", async () => {
    // Regression guard: a future "free credits" tweak must not silently
    // lower the estimate back below Sonnet's per-call cost — that would
    // let real usage exceed the reservation and overshoot user quota.
    const { OPERATION_ESTIMATES } = await import("@/lib/ai-quota");
    expect(OPERATION_ESTIMATES.daily_insight!.model).toBe("claude-sonnet-4-6");
    expect(OPERATION_ESTIMATES.daily_insight!.estimatedCostUsd).toBeGreaterThanOrEqual(0.2);
  });
});

describe("daily-insight cron — per-platform context", () => {
  it("builds context for every connected platform", async () => {
    await createTestUser({ clerkId: `${PREFIX}mp_${randomSuffix()}` });
    getConnectedPlatformsMock.mockResolvedValue({
      platforms: ["X", "THREADS"],
      primary: "X",
    });

    const { GET } = await import("../route");
    await GET(authed());

    expect(generateObjectMock).toHaveBeenCalled();
    const userMessage = generateObjectMock.mock.calls[0]![0].prompt as string;
    // Both platform headers appear once each.
    expect(userMessage).toContain("X (Twitter)");
    expect(userMessage).toContain("Threads");
    // LinkedIn was NOT connected for this user — must not appear.
    expect(userMessage).not.toContain("LinkedIn");
  });

  it("handles user with no connected platforms (degenerate but no crash)", async () => {
    await createTestUser({ clerkId: `${PREFIX}none_${randomSuffix()}` });
    getConnectedPlatformsMock.mockResolvedValue({ platforms: [], primary: null });

    const { GET } = await import("../route");
    const res = await GET(authed());
    expect(res.status).toBe(200);
    expect(generateObjectMock).toHaveBeenCalled();
  });
});

describe("daily-insight cron — fallback path", () => {
  it("on NoObjectGeneratedError saves a clamped fallback and emits Sentry warning", async () => {
    const user = await createTestUser({ clerkId: `${PREFIX}nog_${randomSuffix()}` });

    // Build a real NoObjectGeneratedError instance so the route's
    // `instanceof` branch fires. The exact constructor varies across AI
    // SDK versions; we minimally need .text and .usage.
    const { NoObjectGeneratedError } = await import("ai");
    const overflowText = "x".repeat(2000);
    // The constructor signature for NoObjectGeneratedError carries
    // verbose LanguageModel types we don't need in a unit test — cast
    // to a minimal shape that the route's `instanceof` + property
    // reads (`err.text`, `err.usage`) will accept.
    const err = new NoObjectGeneratedError({
      cause: new Error("schema validation failed"),
      text: overflowText,
      response: { id: "x", timestamp: new Date(), modelId: "claude-sonnet-4-6" },
      usage: {
        inputTokens: 50,
        outputTokens: 200,
        totalTokens: 250,
        inputTokenDetails: undefined,
        outputTokenDetails: undefined,
      },
      finishReason: "stop",
    } as unknown as ConstructorParameters<typeof NoObjectGeneratedError>[0]);

    let currentUserId: string | null = null;
    reserveQuotaMock.mockImplementation(async ({ userId }: { userId: string }) => {
      currentUserId = userId;
      return { reservationId: `res-${userId}`, model: "claude-sonnet-4-6" };
    });
    generateObjectMock.mockImplementation(async () => {
      if (currentUserId === user.id) throw err;
      return { object: SAFE_CARDS, usage: { inputTokens: 10, outputTokens: 10 } };
    });

    const { GET } = await import("../route");
    const res = await GET(authed());
    expect(res.status).toBe(200);

    const callsForOurUser = saveDailyInsightMock.mock.calls.filter((c) => c[0] === user.id);
    expect(callsForOurUser).toHaveLength(1);
    const saved = callsForOurUser[0]![1];

    // Headline clamped to 500 chars (DoS defense).
    expect(saved.insights.headline.length).toBeLessThanOrEqual(500);
    // Other card slots all empty / null on fallback.
    expect(saved.insights.tactical).toEqual([]);
    expect(saved.insights.opportunity).toBeNull();
    expect(saved.insights.warning).toBeNull();
    expect(saved.insights.encouragement).toBeNull();

    // Sentry warning fired (not exception — fallback is not a crash).
    const Sentry = await import("@sentry/nextjs");
    const warningCalls = (Sentry.captureMessage as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => c[0] === "daily-insight schema-fit failed"
    );
    expect(warningCalls.length).toBeGreaterThanOrEqual(1);
    // Reservation completed (token usage charged) — user isn't billed
    // again on retry.
    const completeForOurUser = completeReservationMock.mock.calls.filter(
      (c) => (c[0] as { reservationId: string }).reservationId === `res-${user.id}`
    );
    expect(completeForOurUser).toHaveLength(1);
  });
});

describe("daily-insight cron — error isolation", () => {
  it("isolates per-user generic errors — Sentry captures and loop continues", async () => {
    const userA = await createTestUser({ clerkId: `${PREFIX}A_${randomSuffix()}` });
    const userB = await createTestUser({ clerkId: `${PREFIX}B_${randomSuffix()}` });

    let currentUserId: string | null = null;
    reserveQuotaMock.mockImplementation(async ({ userId }: { userId: string }) => {
      currentUserId = userId;
      return { reservationId: `res-${userId}`, model: "claude-sonnet-4-6" };
    });
    generateObjectMock.mockImplementation(async () => {
      if (currentUserId === userA.id) throw new Error("anthropic 500 for A");
      return { object: SAFE_CARDS, usage: { inputTokens: 10, outputTokens: 10 } };
    });

    const { GET } = await import("../route");
    const res = await GET(authed());
    expect(res.status).toBe(200);
    const body = await res.json();

    const results = body.results as Array<{ userId: string; error?: string }>;
    expect(results.find((r) => r.userId === userA.id)?.error).toBeTruthy();
    expect(results.find((r) => r.userId === userB.id)?.error).toBeUndefined();

    const Sentry = await import("@sentry/nextjs");
    expect(Sentry.captureException).toHaveBeenCalled();
    expect(failReservationMock).toHaveBeenCalled();
  });

  it("treats QuotaExceededError as soft skip — no Sentry exception for that user", async () => {
    const quotaUser = await createTestUser({ clerkId: `${PREFIX}q_${randomSuffix()}` });

    const { QuotaExceededError } = await import("@/lib/errors");
    reserveQuotaMock.mockImplementation(async ({ userId }: { userId: string }) => {
      if (userId === quotaUser.id) throw new QuotaExceededError(100, 50);
      return { reservationId: "res-other", model: "claude-sonnet-4-6" };
    });

    const { GET } = await import("../route");
    const res = await GET(authed());
    expect(res.status).toBe(200);
    const body = await res.json();

    const ours = (body.results as Array<{ userId: string; error?: string }>).find(
      (r) => r.userId === quotaUser.id
    );
    expect(ours?.error).toBe("QuotaExceededError");

    const Sentry = await import("@sentry/nextjs");
    const quotaCalls = (Sentry.captureException as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => (c[0] as Error | undefined)?.name === "QuotaExceededError"
    );
    expect(quotaCalls).toHaveLength(0);
  });
});
