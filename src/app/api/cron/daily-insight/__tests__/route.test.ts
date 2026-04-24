/**
 * Contract test for the daily-insight cron.
 *
 * Contract:
 *   1. Bearer auth — 401 on missing/wrong token.
 *   2. Happy path — returns SUCCESS and persists a DailyInsight for the user.
 *   3. Per-user errors isolated: one user's AI call throwing doesn't abort
 *      the loop or crash the handler; the error is captured to Sentry and
 *      the overall status becomes PARTIAL.
 *   4. Quota errors (QuotaExceeded / SubscriptionRequired / RateLimit) are
 *      treated as soft skips — captured as error in results but not sent
 *      to Sentry as exceptions.
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

// Mock the AI SDK — we must never hit Anthropic from tests.
const generateTextMock = vi.hoisted(() => vi.fn());
vi.mock("ai", async () => {
  const actual = (await vi.importActual("ai")) as Record<string, unknown>;
  return { ...actual, generateText: generateTextMock };
});
vi.mock("@ai-sdk/anthropic", () => ({
  anthropic: (model: string) => ({ _model: model }),
}));

// Mock ai-quota so we don't need its tables wired up. Reserve succeeds by
// default; complete/fail are recorded for assertions where relevant.
const reserveQuotaMock = vi.hoisted(() => vi.fn());
const completeReservationMock = vi.hoisted(() => vi.fn());
const failReservationMock = vi.hoisted(() => vi.fn());
const sweepStaleReservationsMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ai-quota", () => ({
  reserveQuota: reserveQuotaMock,
  completeReservation: completeReservationMock,
  failReservation: failReservationMock,
  sweepStaleReservations: sweepStaleReservationsMock,
}));

// Don't actually write a DailyInsight row — the save helper is mocked so
// the contract test stays narrow. (The save helper has its own tests.)
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

const PREFIX = `cron_di_${randomSuffix()}_`;

beforeEach(() => {
  process.env.CRON_SECRET = CRON_SECRET;
  vi.clearAllMocks();
  reserveQuotaMock.mockResolvedValue({ reservationId: "res-1" });
  completeReservationMock.mockResolvedValue(undefined);
  failReservationMock.mockResolvedValue(undefined);
  sweepStaleReservationsMock.mockResolvedValue(0);
  getLatestTrendsMock.mockResolvedValue([]);
  getLatestFollowersSnapshotMock.mockResolvedValue(null);
  saveDailyInsightMock.mockResolvedValue({ id: "insight-1" });
  // Default generateText behavior — safe JSON. Tests override with
  // mockImplementationOnce where specific behavior is required. This
  // keeps us robust against parallel test users other tests create.
  generateTextMock.mockResolvedValue({
    text: JSON.stringify(["a", "b", "c", "d", "e"]),
    usage: { inputTokens: 10, outputTokens: 10 },
  });
});

afterEach(async () => {
  await cleanupByPrefix(PREFIX, { clerkId: true });
});

function authed() {
  return new NextRequest("https://app.postimi.com/api/cron/daily-insight", {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
}

describe("daily-insight cron — contract", () => {
  it("returns 401 when Bearer token is missing", async () => {
    const { GET } = await import("../route");
    const res = await GET(new NextRequest("https://app.postimi.com/api/cron/daily-insight"));
    expect(res.status).toBe(401);
    // Auth gate fires before sweep / user iteration.
    expect(sweepStaleReservationsMock).not.toHaveBeenCalled();
    expect(reserveQuotaMock).not.toHaveBeenCalled();
  });

  it("runs sweep + persists insight for the test user on happy path", async () => {
    const user = await createTestUser({ clerkId: `${PREFIX}ok_${randomSuffix()}` });

    const { GET } = await import("../route");
    const res = await GET(authed());
    expect(res.status).toBe(200);

    // Sweep runs once per cron invocation, regardless of user count.
    expect(sweepStaleReservationsMock).toHaveBeenCalledTimes(1);

    // Scoped assertion: saveDailyInsight must have been called for OUR
    // test user. Other users in the shared test DB are irrelevant — we
    // only own the one we created.
    const callsForOurUser = saveDailyInsightMock.mock.calls.filter((c) => c[0] === user.id);
    expect(callsForOurUser).toHaveLength(1);
  });

  it("isolates per-user errors — Sentry captures and loop continues", async () => {
    // Two users owned by this test. Drive userA's AI call to throw while
    // userB succeeds. Route must capture A's exception, release A's
    // reservation, and still process B.
    const userA = await createTestUser({ clerkId: `${PREFIX}A_${randomSuffix()}` });
    const userB = await createTestUser({ clerkId: `${PREFIX}B_${randomSuffix()}` });

    // Control generateText per userId via reserveQuota's return shape:
    // the route calls reserveQuota first, then generateText. We stash the
    // userId so our generateText mock can branch on it.
    let currentUserId: string | null = null;
    reserveQuotaMock.mockImplementation(async ({ userId }: { userId: string }) => {
      currentUserId = userId;
      return { reservationId: `res-${userId}` };
    });
    generateTextMock.mockImplementation(async () => {
      if (currentUserId === userA.id) {
        throw new Error("anthropic 500 for A");
      }
      return {
        text: JSON.stringify(["a", "b", "c", "d", "e"]),
        usage: { inputTokens: 10, outputTokens: 10 },
      };
    });

    const { GET } = await import("../route");
    const res = await GET(authed());
    expect(res.status).toBe(200);
    const body = await res.json();

    const results = body.results as Array<{ userId: string; error?: string }>;
    const aResult = results.find((r) => r.userId === userA.id);
    const bResult = results.find((r) => r.userId === userB.id);

    // userA errored; userB succeeded. Loop did not abort.
    expect(aResult?.error).toBeTruthy();
    expect(bResult?.error).toBeUndefined();

    // Sentry captured userA's exception.
    const Sentry = await import("@sentry/nextjs");
    expect(Sentry.captureException).toHaveBeenCalled();

    // Failed reservation was released for the erroring user.
    expect(failReservationMock).toHaveBeenCalled();
  });

  it("one rejected subquery does not skip the user — allSettled + Sentry per subtask", async () => {
    // Regression guard for the Promise.all -> allSettled refactor.
    // If getLatestTrends throws for a user, the user's insight must
    // still be computed (with empty trends) and persisted. The subtask
    // failure is captured to Sentry with the subtask tag so we can
    // detect recurring sub-failures in ops.
    const user = await createTestUser({ clerkId: `${PREFIX}sub_${randomSuffix()}` });

    getLatestTrendsMock.mockImplementation(async (uid: string) => {
      if (uid === user.id) throw new Error("trends service down");
      return [];
    });

    const { GET } = await import("../route");
    const res = await GET(authed());
    expect(res.status).toBe(200);
    const body = await res.json();

    const results = body.results as Array<{ userId: string; insightId?: string; error?: string }>;
    const ours = results.find((r) => r.userId === user.id);

    // User was NOT skipped — insight persisted despite subquery failure.
    expect(ours).toBeDefined();
    expect(ours?.error).toBeUndefined();
    const callsForOurUser = saveDailyInsightMock.mock.calls.filter((c) => c[0] === user.id);
    expect(callsForOurUser).toHaveLength(1);

    // Subquery failure reached Sentry with the subtask tag.
    const Sentry = await import("@sentry/nextjs");
    const calls = (Sentry.captureException as ReturnType<typeof vi.fn>).mock.calls;
    const subtaskCall = calls.find((c) => {
      const ctx = c[1] as { tags?: { area?: string; userId?: string; subtask?: string } };
      return (
        ctx?.tags?.area === "daily-insight" &&
        ctx?.tags?.userId === user.id &&
        ctx?.tags?.subtask === "getLatestTrends"
      );
    });
    expect(subtaskCall).toBeDefined();

    // Reservation completed normally — not failed, since the user succeeded.
    expect(completeReservationMock).toHaveBeenCalled();
  });

  it("treats QuotaExceededError as soft skip — no Sentry exception for that user", async () => {
    const quotaUser = await createTestUser({ clerkId: `${PREFIX}q_${randomSuffix()}` });

    const { QuotaExceededError } = await import("@/lib/errors");
    // Only throw for this user — other parallel test users still succeed.
    reserveQuotaMock.mockImplementation(async ({ userId }: { userId: string }) => {
      if (userId === quotaUser.id) throw new QuotaExceededError(100, 50);
      return { reservationId: "res-other" };
    });

    const { GET } = await import("../route");
    const res = await GET(authed());
    expect(res.status).toBe(200);
    const body = await res.json();

    const results = body.results as Array<{ userId: string; error?: string }>;
    const ours = results.find((r) => r.userId === quotaUser.id);
    expect(ours?.error).toBe("QuotaExceededError");

    // QuotaExceededError is an expected user state; the route must NOT
    // file it as a Sentry exception (that's reserved for unexpected errors).
    const Sentry = await import("@sentry/nextjs");
    const exceptionCalls = (Sentry.captureException as ReturnType<typeof vi.fn>).mock.calls;
    // If other users' AI calls failed they'd appear in captureException —
    // but since generateText has a safe default, they succeed. We assert
    // no Sentry call references a QuotaExceededError (the only signal
    // tied to our user here).
    const quotaCalls = exceptionCalls.filter((c) => {
      const err = c[0] as Error | undefined;
      return err?.name === "QuotaExceededError";
    });
    expect(quotaCalls).toHaveLength(0);
  });
});
