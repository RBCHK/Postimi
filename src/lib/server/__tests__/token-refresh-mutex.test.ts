/**
 * Token-refresh mutex tests — real Postgres advisory lock.
 *
 * Why real DB: the whole point of `pg_try_advisory_xact_lock` is that
 * Postgres serializes it across connections. A Set-backed mock can
 * never prove that. A prior revision of this test used a fake lock; it
 * passed while actually testing JavaScript-level scheduling, not the
 * Postgres primitive we rely on.
 *
 * We still mock `fetch-with-retry` (no HTTP to X) and `@sentry/nextjs`
 * (no SaaS side-effects). Prisma hits `xreba_test` — the lock + the
 * token row persistence are the behaviour under test.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { encryptToken } from "@/lib/token-encryption";
import { cleanupByPrefix, createTestUser, randomSuffix } from "@/test/real-prisma";

// ─── Mocks (non-DB) ──────────────────────────────────────

const fetchWithRetryMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/fetch-with-retry", async () => {
  const actual = (await vi.importActual("@/lib/fetch-with-retry")) as Record<string, unknown>;
  return {
    ...actual,
    fetchWithRetry: fetchWithRetryMock,
  };
});

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

const PREFIX = `trefr_mtx_${randomSuffix()}_`;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.X_CLIENT_ID = "xid";
  process.env.X_CLIENT_SECRET = "xsec";
  // Require a valid 64-hex TOKEN_ENCRYPTION_KEY for real encrypt/decrypt.
  process.env.TOKEN_ENCRYPTION_KEY =
    process.env.TOKEN_ENCRYPTION_KEY ??
    "0000000000000000000000000000000000000000000000000000000000000000";
});

afterEach(async () => {
  await cleanupByPrefix(PREFIX, { clerkId: true });
});

function oauthSuccessResponse(overrides: { access_token?: string } = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      access_token: overrides.access_token ?? "new_access",
      refresh_token: "new_refresh",
      expires_in: 3600,
      scope: "tweet.read",
    }),
  } as unknown as Response;
}

/**
 * Seed an expired XApiToken for a user so the refresh path will fire.
 */
async function seedExpiredXToken(userId: string) {
  await prisma.xApiToken.create({
    data: {
      userId,
      xUserId: "x1",
      xUsername: "alice",
      accessToken: encryptToken("old_access"),
      refreshToken: encryptToken("old_refresh"),
      expiresAt: new Date(Date.now() - 60_000),
      scopes: "",
    },
  });
}

describe("withTokenRefreshLock — real Postgres advisory lock", () => {
  it("parallel refreshXApiToken calls invoke exchangeRefreshToken exactly once", async () => {
    const user = await createTestUser({
      clerkId: `${PREFIX}user_${randomSuffix()}`,
    });
    await seedExpiredXToken(user.id);

    // Single OAuth success response — if the mutex lets both callers
    // refresh, the second call will land against an empty queue and
    // return undefined, surfacing as a test failure.
    fetchWithRetryMock.mockResolvedValue(oauthSuccessResponse({ access_token: "new_access" }));

    const { getXApiTokenForUser } = await import("../x-token");
    const [a, b] = await Promise.all([getXApiTokenForUser(user.id), getXApiTokenForUser(user.id)]);

    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    // Exchange is called exactly once across both parallel callers —
    // the second caller sees the freshly-refreshed token in DB and
    // skips the network hop.
    expect(fetchWithRetryMock).toHaveBeenCalledTimes(1);
    // Exactly one of the returned access tokens is the freshly issued
    // one; the other is either the same value (from the second reader
    // hitting the refreshed row) or the pre-refresh token — but both
    // must be non-null.
    expect(a?.accessToken === "new_access" || b?.accessToken === "new_access").toBe(true);
  });

  it("different userIds do not contend on the same advisory key", async () => {
    const userA = await createTestUser({
      clerkId: `${PREFIX}userA_${randomSuffix()}`,
    });
    const userB = await createTestUser({
      clerkId: `${PREFIX}userB_${randomSuffix()}`,
    });
    await seedExpiredXToken(userA.id);
    await seedExpiredXToken(userB.id);

    fetchWithRetryMock.mockResolvedValue(oauthSuccessResponse());

    const { getXApiTokenForUser } = await import("../x-token");
    const [a, b] = await Promise.all([
      getXApiTokenForUser(userA.id),
      getXApiTokenForUser(userB.id),
    ]);

    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    // Two different users → two independent refreshes, no contention.
    expect(fetchWithRetryMock).toHaveBeenCalledTimes(2);
  });

  it("refresh persists the new token to DB (round-trip through encryption)", async () => {
    const user = await createTestUser({
      clerkId: `${PREFIX}user_persist_${randomSuffix()}`,
    });
    await seedExpiredXToken(user.id);

    fetchWithRetryMock.mockResolvedValue(oauthSuccessResponse({ access_token: "fresh_token_abc" }));

    const { getXApiTokenForUser } = await import("../x-token");
    const creds = await getXApiTokenForUser(user.id);

    expect(creds?.accessToken).toBe("fresh_token_abc");

    // Row in DB is encrypted; decrypting should yield the same plaintext.
    const row = await prisma.xApiToken.findUnique({ where: { userId: user.id } });
    expect(row).not.toBeNull();
    expect(row!.accessToken).not.toBe("fresh_token_abc"); // encrypted at rest
    const { decryptToken } = await import("@/lib/token-encryption");
    expect(decryptToken(row!.accessToken)).toBe("fresh_token_abc");
    // expiresAt moves into the future (within a reasonable window).
    expect(row!.expiresAt.getTime()).toBeGreaterThan(Date.now() + 60 * 60 * 1000 - 60_000);
  });

  it("when the lock is held externally, the caller gives up and reports to Sentry", async () => {
    // Acquire the same advisory lock in an outer transaction and keep
    // it open until the test is done. The token-refresh code will spin
    // for ~5 × 50ms and then bail.
    const user = await createTestUser({
      clerkId: `${PREFIX}user_blocked_${randomSuffix()}`,
    });
    await seedExpiredXToken(user.id);

    // We need the PLATFORM_KEY for "x" (=1) and a matching hash. Recreate
    // exactly what the module does so we grab the same lock.
    const { createHash } = await import("node:crypto");
    const key1 = 1; // PLATFORM_KEY["x"]
    const key2 = createHash("sha256").update(user.id).digest().readInt32BE(0);

    // Hold the lock inside a long-running transaction. The transaction
    // doesn't commit until we resolve `release`.
    let release!: () => void;
    const released = new Promise<void>((r) => {
      release = r;
    });
    const held = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_try_advisory_xact_lock(${key1}::int, ${key2}::int)`;
      await released;
    });

    // Give the transaction a tick to actually take the lock.
    await new Promise((r) => setTimeout(r, 20));

    try {
      const { withTokenRefreshLock } = await import("../token-refresh-lock");
      const workFn = vi.fn(async () => "unused");
      await expect(withTokenRefreshLock(user.id, "x", workFn)).rejects.toThrow(/failed to acquire/);
      expect(workFn).not.toHaveBeenCalled();

      const Sentry = await import("@sentry/nextjs");
      expect(Sentry.captureMessage).toHaveBeenCalledWith(
        expect.stringContaining("failed to acquire"),
        expect.objectContaining({
          tags: expect.objectContaining({ platform: "x", userId: user.id }),
        })
      );
    } finally {
      release();
      await held;
    }
  });
});
