/**
 * Contract test for the researcher cron (post-2026-04 refactor).
 *
 * Two-phase contract:
 *   1. Bearer auth — 401 on missing/wrong token.
 *   2. Fails fast (throws → 500) if TAVILY_API_KEY is not configured.
 *   3. Phase A — runs once per platform (X / LINKEDIN / THREADS).
 *      AiUsage reserved under SYSTEM_USER. Per-platform try/catch
 *      isolates failures.
 *   4. Phase B — runs once per user with niche set. Users without
 *      niche are skipped (their per-user reservation never fires).
 *      Users with niche but no connected platforms get a typed skip.
 *   5. SECURITY: delete tools (Phase A `deleteOldGlobalNote`, Phase B
 *      `deleteOldUserNote`) accept ONLY `{ noteId, reason }` from the
 *      model — `platform` and `userId` are closure bindings in route.
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

// Capture every generateText call's full options so we can inspect the
// tool schemas the model would see.
const generateTextMock = vi.hoisted(() => vi.fn());
vi.mock("ai", async () => {
  const actual = (await vi.importActual("ai")) as Record<string, unknown>;
  return { ...actual, generateText: generateTextMock };
});
vi.mock("@ai-sdk/anthropic", () => ({
  anthropic: (model: string) => ({ _model: model }),
}));

const tavilySearchMock = vi.hoisted(() => vi.fn());
vi.mock("@tavily/core", () => ({
  tavily: () => ({ search: tavilySearchMock }),
}));

const reserveQuotaMock = vi.hoisted(() => vi.fn());
const completeReservationMock = vi.hoisted(() => vi.fn());
const failReservationMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ai-quota", () => ({
  reserveQuota: reserveQuotaMock,
  completeReservation: completeReservationMock,
  failReservation: failReservationMock,
}));

// Research-note helpers — mocked to keep tests free of DB writes.
// (Real-prisma research lib coverage lives in `src/lib/server/__tests__/research.test.ts`.)
const saveGlobalMock = vi.hoisted(() => vi.fn());
const saveUserMock = vi.hoisted(() => vi.fn());
const deleteGlobalMock = vi.hoisted(() => vi.fn());
const deleteUserMock = vi.hoisted(() => vi.fn());
const listAllGlobalMock = vi.hoisted(() => vi.fn());
const getUserNicheMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/research", () => ({
  saveGlobalResearchNote: saveGlobalMock,
  saveUserResearchNote: saveUserMock,
  deleteGlobalResearchNote: deleteGlobalMock,
  deleteUserResearchNote: deleteUserMock,
  listAllGlobalResearchNotes: listAllGlobalMock,
  getUserNicheResearchNotes: getUserNicheMock,
}));

const getConnectedPlatformsMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/platforms", () => ({
  getConnectedPlatforms: getConnectedPlatformsMock,
}));

const PREFIX = `cron_rs_${randomSuffix()}_`;

beforeEach(() => {
  process.env.CRON_SECRET = CRON_SECRET;
  process.env.TAVILY_API_KEY = "test-tavily";
  vi.clearAllMocks();
  reserveQuotaMock.mockResolvedValue({ reservationId: "res-1", model: "claude-sonnet-4-6" });
  completeReservationMock.mockResolvedValue(undefined);
  failReservationMock.mockResolvedValue(undefined);
  listAllGlobalMock.mockResolvedValue([]);
  getUserNicheMock.mockResolvedValue([]);
  saveGlobalMock.mockResolvedValue({ id: "g-1", topic: "g" });
  saveUserMock.mockResolvedValue({ id: "u-1", topic: "u" });
  getConnectedPlatformsMock.mockResolvedValue({ platforms: ["X", "LINKEDIN"], primary: "X" });
  tavilySearchMock.mockResolvedValue({ results: [] });
  generateTextMock.mockResolvedValue({
    text: "# Topic: Default\n\nSafe",
    steps: [{}],
    finishReason: "stop",
    usage: { inputTokens: 10, outputTokens: 10 },
  });
});

afterEach(async () => {
  // Drop test users (real DB — but NOT the SYSTEM_USER; ensureSystemUser
  // upserts a long-lived row that other tests/runs reuse).
  await cleanupByPrefix(PREFIX, { clerkId: true });
});

function authed() {
  return new NextRequest("https://app.postimi.com/api/cron/researcher?manual=1", {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
}

describe("researcher cron — auth & config", () => {
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
  });
});

describe("researcher cron — Phase A (global per-platform)", () => {
  it("invokes generateText once per platform (X, LINKEDIN, THREADS) with platform-anchored prompt", async () => {
    const { GET } = await import("../route");
    const res = await GET(authed());
    expect(res.status).toBe(200);

    // Three Phase A calls (no niche users in the test DB → Phase B
    // adds zero, but the test DB may contain leftover users from other
    // suites with niche set — so we check ≥ 3 calls and inspect the
    // first three's system prompts).
    expect(generateTextMock).toHaveBeenCalled();
    const calls = generateTextMock.mock.calls;
    const phaseAPrompts = calls.slice(0, 3).map((c) => (c[0] as { system: string }).system);
    expect(phaseAPrompts.some((p) => p.includes("X (Twitter)"))).toBe(true);
    expect(phaseAPrompts.some((p) => p.includes("LinkedIn"))).toBe(true);
    expect(phaseAPrompts.some((p) => p.includes("Threads"))).toBe(true);
  });

  it("saveGlobalResearchNote is called with the correct platform from the loop", async () => {
    const { GET } = await import("../route");
    await GET(authed());

    const platformsSeen = saveGlobalMock.mock.calls.map((c) => c[0]);
    expect(platformsSeen).toEqual(expect.arrayContaining(["X", "LINKEDIN", "THREADS"]));
  });

  it("Phase A deleteOldGlobalNote tool's inputSchema does NOT accept platform from the model", async () => {
    const { GET } = await import("../route");
    await GET(authed());

    // Inspect the first call's tools (Phase A — X iteration).
    const firstCall = generateTextMock.mock.calls[0]![0] as {
      tools: { deleteOldGlobalNote: { inputSchema: unknown } };
    };
    const schema = firstCall.tools.deleteOldGlobalNote.inputSchema;
    // Zod schema shape: a runtime parse must reject extra `platform` field
    // by silently dropping it (default Zod) — verify the schema's keys
    // are exactly { noteId, reason }.
    const parsed = (schema as { parse: (v: unknown) => Record<string, unknown> }).parse({
      noteId: "abc",
      reason: "test",
      platform: "LINKEDIN", // attacker would try to pass this
    });
    expect(Object.keys(parsed).sort()).toEqual(["noteId", "reason"]);
    expect(parsed).not.toHaveProperty("platform");
  });

  it("Phase A platform failure does NOT kill other platforms", async () => {
    // Throw on the first call (X), succeed on the rest.
    generateTextMock.mockReset();
    let callIdx = 0;
    generateTextMock.mockImplementation(async () => {
      callIdx++;
      if (callIdx === 1) throw new Error("X model failure");
      return {
        text: "# Topic: ok\n\nok",
        steps: [{}],
        finishReason: "stop",
        usage: { inputTokens: 10, outputTokens: 10 },
      };
    });

    const { GET } = await import("../route");
    const res = await GET(authed());
    expect(res.status).toBe(200);

    // Phase A still saved at least 2 (LINKEDIN + THREADS) despite X
    // failing.
    expect(saveGlobalMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("Phase A reserves quota under SYSTEM_USER, not a real user", async () => {
    const { GET } = await import("../route");
    await GET(authed());

    const phaseAReservations = reserveQuotaMock.mock.calls.slice(0, 3);
    // All three Phase A reservations should share the same userId
    // (SYSTEM_USER's row id, looked up at runtime).
    const uniqueUserIds = new Set(phaseAReservations.map((c) => c[0].userId));
    expect(uniqueUserIds.size).toBe(1);
    // Operation tag is "researcher"
    expect(phaseAReservations[0]![0].operation).toBe("researcher");
  });
});

describe("researcher cron — Phase B (per-user niche)", () => {
  it("processes only users with niche set", async () => {
    const userWithNiche = await createTestUser({ clerkId: `${PREFIX}n_${randomSuffix()}` });
    const { prisma } = await import("@/lib/prisma");
    await prisma.user.update({ where: { id: userWithNiche.id }, data: { niche: "AI tools" } });

    const userWithoutNiche = await createTestUser({
      clerkId: `${PREFIX}nn_${randomSuffix()}`,
    });

    const { GET } = await import("../route");
    await GET(authed());

    // saveUserResearchNote should be called for the niche user (and
    // possibly leftover niche users from other parallel tests — we
    // assert presence of OUR user, not a strict count).
    const userIdsCalled = saveUserMock.mock.calls.map((c) => c[0]);
    expect(userIdsCalled).toContain(userWithNiche.id);
    expect(userIdsCalled).not.toContain(userWithoutNiche.id);
  });

  it("Phase B skips users with niche but no connected platforms", async () => {
    const user = await createTestUser({ clerkId: `${PREFIX}np_${randomSuffix()}` });
    const { prisma } = await import("@/lib/prisma");
    await prisma.user.update({ where: { id: user.id }, data: { niche: "ai" } });

    // Override only for this user
    getConnectedPlatformsMock.mockImplementation(async (userId: string) => {
      if (userId === user.id) return { platforms: [], primary: null };
      return { platforms: ["X"], primary: "X" };
    });

    const { GET } = await import("../route");
    const res = await GET(authed());
    const body = await res.json();
    const nicheResults = body.niche as Array<{ userId: string; skipReason?: string }>;
    const ours = nicheResults.find((r) => r.userId === user.id);
    expect(ours?.skipReason).toBe("no-platforms");

    const userIdsCalled = saveUserMock.mock.calls.map((c) => c[0]);
    expect(userIdsCalled).not.toContain(user.id);
  });

  it("Phase B deleteOldUserNote tool's inputSchema does NOT accept userId from the model", async () => {
    const user = await createTestUser({ clerkId: `${PREFIX}sec_${randomSuffix()}` });
    const { prisma } = await import("@/lib/prisma");
    await prisma.user.update({ where: { id: user.id }, data: { niche: "ai" } });

    const { GET } = await import("../route");
    await GET(authed());

    // Find the generateText call where the system prompt mentions the
    // niche — that's the Phase B call for our user.
    const phaseBCall = generateTextMock.mock.calls.find((c) =>
      ((c[0] as { system: string }).system ?? "").includes("niche-content researcher")
    );
    expect(phaseBCall).toBeTruthy();
    const tools = (phaseBCall![0] as { tools: { deleteOldUserNote: { inputSchema: unknown } } })
      .tools;
    const parsed = (
      tools.deleteOldUserNote.inputSchema as { parse: (v: unknown) => Record<string, unknown> }
    ).parse({
      noteId: "abc",
      reason: "test",
      userId: "attacker-user-id", // attacker would try to pass this
    });
    expect(Object.keys(parsed).sort()).toEqual(["noteId", "reason"]);
    expect(parsed).not.toHaveProperty("userId");
  });

  it("isolates per-user errors — a user failure doesn't kill other users or Phase A", async () => {
    const userA = await createTestUser({ clerkId: `${PREFIX}eA_${randomSuffix()}` });
    const userB = await createTestUser({ clerkId: `${PREFIX}eB_${randomSuffix()}` });
    const { prisma } = await import("@/lib/prisma");
    await prisma.user.update({ where: { id: userA.id }, data: { niche: "ai" } });
    await prisma.user.update({ where: { id: userB.id }, data: { niche: "fitness" } });

    // Make Phase B reservation fail for userA only — userB still works.
    reserveQuotaMock.mockImplementation(async (args: { userId: string }) => {
      if (args.userId === userA.id) throw new Error("reserve failed for A");
      return { reservationId: `res-${args.userId}`, model: "claude-sonnet-4-6" };
    });

    const { GET } = await import("../route");
    const res = await GET(authed());
    expect(res.status).toBe(200);
    const body = await res.json();
    const nicheResults = body.niche as Array<{ userId: string; error?: string }>;

    expect(nicheResults.find((r) => r.userId === userA.id)?.error).toBeTruthy();
    expect(nicheResults.find((r) => r.userId === userB.id)?.error).toBeUndefined();

    // Phase A still ran (saveGlobalMock called for ≥3 platforms).
    expect(saveGlobalMock.mock.calls.length).toBeGreaterThanOrEqual(3);
  });
});
