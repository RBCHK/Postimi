/**
 * Contract test for the followers-snapshot cron.
 *
 * Contract:
 *   1. Bearer auth — 401 on missing/wrong token.
 *   2. Happy path — returns SUCCESS with per-user results.
 *   3. Users without X credentials are silently skipped, not crashed.
 *   4. Per-user errors are isolated: one user throwing doesn't abort
 *      the loop for others.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
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

const fetchUserDataMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/x-api", () => ({
  fetchUserData: fetchUserDataMock,
}));

const saveFollowersSnapshotMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/followers", () => ({
  saveFollowersSnapshot: saveFollowersSnapshotMock,
}));

const PREFIX = `cron_fs_${randomSuffix()}_`;

beforeEach(() => {
  process.env.CRON_SECRET = CRON_SECRET;
  vi.clearAllMocks();
});

afterEach(async () => {
  await cleanupByPrefix(PREFIX, { clerkId: true });
});

function authed() {
  return new NextRequest("https://app.postimi.com/api/cron/followers-snapshot", {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
}

describe("followers-snapshot cron — contract", () => {
  it("returns 401 when Bearer token is missing", async () => {
    const { GET } = await import("../route");
    const res = await GET(new NextRequest("https://app.postimi.com/api/cron/followers-snapshot"));
    expect(res.status).toBe(401);
    // Auth gate hit before any user iteration.
    expect(getXApiTokenForUserMock).not.toHaveBeenCalled();
  });

  it("skips users without X credentials and returns SUCCESS", async () => {
    // Seed one user to iterate over. getXApiTokenForUser returns null
    // for this user — the cron should classify them as `skipped: true`.
    await createTestUser({ clerkId: `${PREFIX}user_${randomSuffix()}` });
    getXApiTokenForUserMock.mockResolvedValue(null);

    const { GET } = await import("../route");
    const res = await GET(authed());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("SUCCESS");

    // X API must NOT have been called without credentials.
    expect(fetchUserDataMock).not.toHaveBeenCalled();
    expect(saveFollowersSnapshotMock).not.toHaveBeenCalled();
  });

  it("isolates per-user errors: one user's throw doesn't abort others", async () => {
    // Two users. userA throws; userB succeeds. Keyed by userId so we're
    // robust against other parallel tests that might inject users into
    // the shared test DB.
    const userA = await createTestUser({ clerkId: `${PREFIX}A_${randomSuffix()}` });
    const userB = await createTestUser({ clerkId: `${PREFIX}B_${randomSuffix()}` });

    // Only our two users return credentials — everyone else is skipped.
    getXApiTokenForUserMock.mockImplementation(async (uid: string) => {
      if (uid === userA.id || uid === userB.id) {
        return { accessToken: "t", xUserId: "x", xUsername: "u" };
      }
      return null;
    });

    // fetchUserData receives credentials (not userId). Route calls
    // getXApiTokenForUser(userId) → fetchUserData(credentials) in order,
    // so we key the failure to the Nth call: we know only our 2 users
    // get past the null gate. The first observed call in the loop is
    // for whichever user comes first in Prisma ordering; we fail the
    // FIRST credentialed call and succeed the rest.
    let credentialedCallNum = 0;
    fetchUserDataMock.mockImplementation(async () => {
      credentialedCallNum += 1;
      if (credentialedCallNum === 1) throw new Error("X API down");
      return { followersCount: 500, followingCount: 100 };
    });
    saveFollowersSnapshotMock.mockResolvedValue({
      followersCount: 500,
      deltaFollowers: 0,
    });

    const { GET } = await import("../route");
    const res = await GET(authed());
    expect(res.status).toBe(200);
    const body = await res.json();

    const results = body.results as Array<{
      userId: string;
      error?: string;
      followers?: number;
      skipped?: boolean;
    }>;
    // Filter to only our test users — ignore any other users in the DB.
    const ours = results.filter((r) => r.userId === userA.id || r.userId === userB.id);
    expect(ours).toHaveLength(2);
    // Of our two users: exactly one errored, exactly one got followers.
    expect(ours.filter((r) => r.error).length).toBe(1);
    expect(ours.filter((r) => r.followers === 500).length).toBe(1);

    // Sentry captured the failing user's error.
    const Sentry = await import("@sentry/nextjs");
    expect(Sentry.captureException).toHaveBeenCalled();

    // Sanity check: both our users exist in DB.
    const testUsers = await prisma.user.findMany({
      where: { clerkId: { startsWith: PREFIX } },
    });
    expect(testUsers.map((u) => u.id).sort()).toEqual([userA.id, userB.id].sort());
  });
});
