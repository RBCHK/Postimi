/**
 * Contract test for the trend-snapshot cron.
 *
 * Contract:
 *   1. Bearer auth — 401 on missing/wrong token.
 *   2. Users without X credentials are skipped (not crashed).
 *   3. Per-user errors isolated; Sentry captures, loop continues.
 *   4. When `fetchPersonalizedTrends` returns trends, saveTrendSnapshots
 *      is called; cleanupOldTrends always runs.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { cleanupByPrefix, createTestUser, randomSuffix } from "@/test/real-prisma";

const CRON_SECRET = "test-cron-secret";

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
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

const getXApiTokenForUserMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/x-token", () => ({
  getXApiTokenForUser: getXApiTokenForUserMock,
}));

const fetchPersonalizedTrendsMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/x-api", () => ({
  fetchPersonalizedTrends: fetchPersonalizedTrendsMock,
}));

const saveTrendSnapshotsMock = vi.hoisted(() => vi.fn());
const cleanupOldTrendsMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/trends", () => ({
  saveTrendSnapshots: saveTrendSnapshotsMock,
  cleanupOldTrends: cleanupOldTrendsMock,
}));

const PREFIX = `cron_ts_${randomSuffix()}_`;

beforeEach(() => {
  process.env.CRON_SECRET = CRON_SECRET;
  vi.clearAllMocks();
  saveTrendSnapshotsMock.mockResolvedValue(0);
  cleanupOldTrendsMock.mockResolvedValue(0);
});

afterEach(async () => {
  await cleanupByPrefix(PREFIX, { clerkId: true });
});

function authed() {
  return new NextRequest("https://app.postimi.com/api/cron/trend-snapshot", {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
}

describe("trend-snapshot cron — contract", () => {
  it("returns 401 when Bearer token is missing", async () => {
    const { GET } = await import("../route");
    const res = await GET(new NextRequest("https://app.postimi.com/api/cron/trend-snapshot"));
    expect(res.status).toBe(401);
    expect(getXApiTokenForUserMock).not.toHaveBeenCalled();
  });

  it("skips users without X credentials", async () => {
    await createTestUser({ clerkId: `${PREFIX}nocreds_${randomSuffix()}` });
    getXApiTokenForUserMock.mockResolvedValue(null);

    const { GET } = await import("../route");
    const res = await GET(authed());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("SUCCESS");
    // No X API call made without credentials.
    expect(fetchPersonalizedTrendsMock).not.toHaveBeenCalled();
  });

  it("saves trends and runs cleanup for the test user when credentials exist", async () => {
    const user = await createTestUser({ clerkId: `${PREFIX}ok_${randomSuffix()}` });
    // Only return credentials for OUR user — other parallel tests
    // may have injected users; we don't want them to fetch trends.
    getXApiTokenForUserMock.mockImplementation(async (uid: string) => {
      if (uid === user.id) {
        return { accessToken: "t", xUserId: "x", xUsername: "u" };
      }
      return null;
    });
    fetchPersonalizedTrendsMock.mockResolvedValue([
      { trend: "test1", rank: 1 },
      { trend: "test2", rank: 2 },
    ]);
    saveTrendSnapshotsMock.mockResolvedValue(2);
    cleanupOldTrendsMock.mockResolvedValue(5);

    const { GET } = await import("../route");
    const res = await GET(authed());
    expect(res.status).toBe(200);

    // Scoped: both helpers must have been called exactly for OUR user.
    const saveCalls = saveTrendSnapshotsMock.mock.calls.filter((c) => c[0] === user.id);
    const cleanupCalls = cleanupOldTrendsMock.mock.calls.filter((c) => c[0] === user.id);
    expect(saveCalls).toHaveLength(1);
    expect(cleanupCalls).toHaveLength(1);
  });

  it("isolates per-user errors — Sentry captures, loop continues for others", async () => {
    const errUser = await createTestUser({ clerkId: `${PREFIX}err_${randomSuffix()}` });
    // Credentials returned for OUR user → fetchPersonalizedTrends gets
    // called and throws. Other users in the DB get null → skipped.
    getXApiTokenForUserMock.mockImplementation(async (uid: string) => {
      if (uid === errUser.id) {
        return { accessToken: "t", xUserId: "x", xUsername: "u" };
      }
      return null;
    });
    fetchPersonalizedTrendsMock.mockRejectedValue(new Error("X API down"));

    const { GET } = await import("../route");
    const res = await GET(authed());
    expect(res.status).toBe(200);
    const body = await res.json();

    const results = body.results as Array<{
      userId: string;
      error?: string;
      skipped?: boolean;
    }>;
    const ours = results.find((r) => r.userId === errUser.id);
    expect(ours?.error).toMatch(/X API down/);

    const Sentry = await import("@sentry/nextjs");
    expect(Sentry.captureException).toHaveBeenCalled();
  });
});
