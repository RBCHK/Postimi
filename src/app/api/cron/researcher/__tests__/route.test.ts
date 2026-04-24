/**
 * Contract test for the researcher cron.
 *
 * Contract:
 *   1. Bearer auth — 401 on missing/wrong token.
 *   2. Fails fast (throws → 500) if TAVILY_API_KEY is not configured:
 *      this cron cannot do anything useful without Tavily, so we want a
 *      loud failure, not silent no-op.
 *   3. Happy path — returns SUCCESS and saves a ResearchNote.
 *   4. Per-user errors isolated: one user throwing doesn't abort the
 *      others; Sentry captures the failure; overall status is PARTIAL.
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

// Tavily client — never hit the Tavily API.
const tavilySearchMock = vi.hoisted(() => vi.fn());
vi.mock("@tavily/core", () => ({
  tavily: () => ({ search: tavilySearchMock }),
}));

// ai-quota — reservations succeed by default; assertions on the flow
// exist for the per-user failure path.
const reserveQuotaMock = vi.hoisted(() => vi.fn());
const completeReservationMock = vi.hoisted(() => vi.fn());
const failReservationMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ai-quota", () => ({
  reserveQuota: reserveQuotaMock,
  completeReservation: completeReservationMock,
  failReservation: failReservationMock,
}));

// Research-note helpers — save is narrow enough to mock.
const saveResearchNoteMock = vi.hoisted(() => vi.fn());
const deleteResearchNoteMock = vi.hoisted(() => vi.fn());
const getAllResearchNotesMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/research", () => ({
  saveResearchNote: saveResearchNoteMock,
  deleteResearchNote: deleteResearchNoteMock,
  getAllResearchNotes: getAllResearchNotesMock,
}));

const PREFIX = `cron_rs_${randomSuffix()}_`;

beforeEach(() => {
  process.env.CRON_SECRET = CRON_SECRET;
  process.env.TAVILY_API_KEY = "test-tavily";
  vi.clearAllMocks();
  reserveQuotaMock.mockResolvedValue({ reservationId: "res-1" });
  completeReservationMock.mockResolvedValue(undefined);
  failReservationMock.mockResolvedValue(undefined);
  getAllResearchNotesMock.mockResolvedValue([]);
  saveResearchNoteMock.mockResolvedValue({ id: "note-1", topic: "t" });
  tavilySearchMock.mockResolvedValue({ results: [] });
  // Default AI behavior — safe output for all users. Tests override
  // selectively (by user) where failure is required. Include `steps`
  // and `finishReason` so the step-limit observability check inside
  // the route doesn't crash on absent fields.
  generateTextMock.mockResolvedValue({
    text: "# Topic: Default\n\nSafe",
    steps: [{}],
    finishReason: "stop",
    usage: { inputTokens: 10, outputTokens: 10 },
  });
});

afterEach(async () => {
  await cleanupByPrefix(PREFIX, { clerkId: true });
});

function authed() {
  return new NextRequest("https://app.postimi.com/api/cron/researcher", {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
}

describe("researcher cron — contract", () => {
  it("returns 401 when Bearer token is missing", async () => {
    const { GET } = await import("../route");
    const res = await GET(new NextRequest("https://app.postimi.com/api/cron/researcher"));
    expect(res.status).toBe(401);
    expect(reserveQuotaMock).not.toHaveBeenCalled();
  });

  it("returns 500 when TAVILY_API_KEY is not configured", async () => {
    delete process.env.TAVILY_API_KEY;
    const { GET } = await import("../route");
    const res = await GET(authed());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/TAVILY_API_KEY/);

    const Sentry = await import("@sentry/nextjs");
    expect(Sentry.captureException).toHaveBeenCalled();
  });

  it("persists a ResearchNote for the test user on happy path", async () => {
    const user = await createTestUser({ clerkId: `${PREFIX}ok_${randomSuffix()}` });

    const { GET } = await import("../route");
    const res = await GET(authed());
    expect(res.status).toBe(200);

    // Scoped assertion: saveResearchNote must have been called for OUR
    // user. Other users in the shared test DB are ignored.
    const callsForOurUser = saveResearchNoteMock.mock.calls.filter((c) => c[0] === user.id);
    expect(callsForOurUser).toHaveLength(1);
  });

  it("isolates per-user errors — Sentry captures, loop continues for others", async () => {
    const userA = await createTestUser({ clerkId: `${PREFIX}A_${randomSuffix()}` });
    const userB = await createTestUser({ clerkId: `${PREFIX}B_${randomSuffix()}` });

    // Scope the failure to userA by keying on reserveQuota's userId —
    // that's the first per-user call the route makes. We can't easily
    // key on generateText because it doesn't receive userId.
    reserveQuotaMock.mockImplementation(async ({ userId }: { userId: string }) => {
      if (userId === userA.id) throw new Error("reserve failed for A");
      return { reservationId: "res-ok" };
    });

    const { GET } = await import("../route");
    const res = await GET(authed());
    expect(res.status).toBe(200);
    const body = await res.json();

    const results = body.results as Array<{ userId: string; error?: string }>;
    const aResult = results.find((r) => r.userId === userA.id);
    const bResult = results.find((r) => r.userId === userB.id);

    expect(aResult?.error).toBeTruthy();
    expect(bResult?.error).toBeUndefined();

    const Sentry = await import("@sentry/nextjs");
    expect(Sentry.captureException).toHaveBeenCalled();
  });

  it("emits tavily-timeout warning and returns empty results when Tavily hangs", async () => {
    const user = await createTestUser({ clerkId: `${PREFIX}tmout_${randomSuffix()}` });

    // Simulate the already-timed-out state: `withTimeout` would
    // normally wait 15s on a hung Tavily search and then reject with
    // `TimeoutError`. Rather than burn 15s of real time inside this
    // test (or fight fake-timer + promise-microtask interleaving), we
    // short-circuit the Tavily client itself — it throws a real
    // `TimeoutError` instance (same class the route's catch branch
    // uses for `instanceof`), and the route must still emit
    // `tavily-timeout` and return [].
    const { TimeoutError } = await import("@/lib/with-timeout");
    tavilySearchMock.mockImplementation(async () => {
      throw new TimeoutError("tavily:researcher timed out after 15000ms", 15_000);
    });

    // Drive `generateText` to actually invoke the webSearch tool once
    // and observe its return value so we can assert on graceful
    // degradation (the note still gets saved).
    generateTextMock.mockImplementation(async (opts: unknown) => {
      const cast = opts as {
        tools?: { webSearch?: { execute?: (args: { query: string }) => Promise<unknown> } };
      };
      const toolResult = await cast.tools?.webSearch?.execute?.({ query: "q" });
      return {
        text: "# Topic: After timeout\n\nok",
        steps: [{ toolResult }],
        finishReason: "stop",
        usage: { inputTokens: 5, outputTokens: 5 },
        _toolResult: toolResult,
      };
    });

    const manualReq = new NextRequest("https://app.postimi.com/api/cron/researcher?manual=1", {
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    });

    const { GET } = await import("../route");
    const res = await GET(manualReq);
    expect(res.status).toBe(200);

    const Sentry = await import("@sentry/nextjs");
    const timeoutWarnings = (
      Sentry.captureMessage as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls.filter((c) => {
      const [msg, opts] = c as [string, { extra?: { userId?: string } } | undefined];
      return msg === "tavily-timeout" && opts?.extra?.userId === user.id;
    });
    expect(timeoutWarnings).toHaveLength(1);

    // The note is still saved — graceful degradation, not a hard fail.
    const savedForUs = saveResearchNoteMock.mock.calls.filter((c) => c[0] === user.id);
    expect(savedForUs).toHaveLength(1);
  });

  it("emits a Sentry warning when the tool loop hits the step limit", async () => {
    const user = await createTestUser({ clerkId: `${PREFIX}steps_${randomSuffix()}` });

    // Simulate the step cap firing: return steps.length === STEP_LIMIT (10).
    generateTextMock.mockResolvedValue({
      text: "# Topic: Truncated\n\npartial content",
      steps: Array.from({ length: 10 }, () => ({})),
      finishReason: "tool-calls",
      usage: { inputTokens: 50, outputTokens: 50 },
    });

    // CronJobConfig may be seeded enabled=false in the shared test DB;
    // `?manual=1` bypasses the toggle so we exercise the handler body.
    const manualReq = new NextRequest("https://app.postimi.com/api/cron/researcher?manual=1", {
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    });

    const { GET } = await import("../route");
    const res = await GET(manualReq);
    expect(res.status).toBe(200);

    const Sentry = await import("@sentry/nextjs");
    const stepLimitWarnings = (
      Sentry.captureMessage as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls.filter((c) => {
      const [msg, opts] = c as [string, { tags?: { userId?: string; area?: string } } | undefined];
      return (
        msg === "researcher-step-limit-hit" &&
        opts?.tags?.userId === user.id &&
        opts?.tags?.area === "researcher-step-limit"
      );
    });
    expect(stepLimitWarnings).toHaveLength(1);

    // Control flow preserved: note still saved with the truncated text.
    const savedForUs = saveResearchNoteMock.mock.calls.filter((c) => c[0] === user.id);
    expect(savedForUs).toHaveLength(1);
  });
});
