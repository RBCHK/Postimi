/**
 * Token-refresh mutex tests.
 *
 * Verifies that `withTokenRefreshLock` serializes parallel refresh
 * attempts: `exchangeRefreshToken` is called exactly once per lock
 * window, the second caller re-reads the refreshed token from DB, and
 * a stuck lock eventually gives up with a Sentry-reported error.
 *
 * We use a mocked Prisma that implements `$transaction` + `$queryRaw`
 * deterministically — the codebase's existing test suite uses mocked
 * Prisma throughout (see `token-refresh-sentry.test.ts`,
 * `idempotency.test.ts`); spinning up a real Postgres just for this
 * one file would diverge from that convention. The mock models
 * `pg_try_advisory_xact_lock` by treating the "lock held" state as a
 * per-key promise that resolves when the holder's transaction ends.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ───────────────────────────────────────────────

const mutexState = vi.hoisted(() => ({
  heldKeys: new Set<string>(),
}));

const prismaMock = vi.hoisted(() => {
  return {
    xApiToken: {
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    $transaction: vi.fn(),
  };
});

// Model advisory-lock semantics: the transaction either acquires the
// key or the lock is already held and the callback is invoked with
// acquired=false. We simulate BY KEY so parallel calls with different
// userIds don't interfere.
function installTransactionMock() {
  prismaMock.$transaction.mockImplementation(
    async <T>(cb: (tx: { $queryRaw: (...args: unknown[]) => Promise<unknown> }) => Promise<T>) => {
      let currentKey = "";
      let acquired = false;
      const tx = {
        $queryRaw: async (...args: unknown[]) => {
          // Call shape from the mutex code:
          //   tx.$queryRaw`SELECT pg_try_advisory_xact_lock(${k1}::int, ${k2}::int)`
          // So args = [templateStrings, key1, key2].
          const key1 = Number(args[1]);
          const key2 = Number(args[2]);
          currentKey = `${key1}:${key2}`;
          if (mutexState.heldKeys.has(currentKey)) {
            return [{ acquired: false }];
          }
          mutexState.heldKeys.add(currentKey);
          acquired = true;
          return [{ acquired: true }];
        },
      };
      try {
        return await cb(tx);
      } finally {
        // Transaction end: release the lock.
        if (acquired) mutexState.heldKeys.delete(currentKey);
      }
    }
  );
}

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

vi.mock("@/lib/token-encryption", () => ({
  encryptToken: (v: string) => `enc:${v}`,
  decryptToken: (v: string) => v.replace(/^enc:/, ""),
}));

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

beforeEach(() => {
  vi.resetAllMocks();
  mutexState.heldKeys.clear();
  installTransactionMock();
  process.env.X_CLIENT_ID = "xid";
  process.env.X_CLIENT_SECRET = "xsec";
});

function successResponse(overrides: { access_token?: string } = {}) {
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

describe("withTokenRefreshLock — mutex semantics", () => {
  it("parallel refreshXApiToken calls invoke exchangeRefreshToken exactly once", async () => {
    const now = Date.now();
    const initialExpired = {
      userId: "user-1",
      accessToken: "enc:old_access",
      refreshToken: "enc:rt",
      xUserId: "x1",
      xUsername: "alice",
      expiresAt: new Date(now - 60_000),
      updatedAt: new Date(2020, 0, 1),
      scopes: "",
    };
    // After the first refresh lands, the row looks refreshed to any
    // second read: `updatedAt` differs from `expectedUpdatedAt` and
    // `expiresAt` is well in the future.
    const afterRefresh = {
      ...initialExpired,
      accessToken: "enc:new_access",
      expiresAt: new Date(now + 3600_000),
      updatedAt: new Date(2026, 0, 1),
    };

    let updated = false;
    prismaMock.xApiToken.findUnique.mockImplementation(async () =>
      updated ? afterRefresh : initialExpired
    );
    prismaMock.xApiToken.update.mockImplementation(async () => {
      updated = true;
      return afterRefresh;
    });

    fetchWithRetryMock.mockResolvedValue(successResponse());

    const { getXApiTokenForUser } = await import("../x-token");
    const [a, b] = await Promise.all([
      getXApiTokenForUser("user-1"),
      getXApiTokenForUser("user-1"),
    ]);

    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    // Exchange is called exactly once across both parallel callers.
    expect(fetchWithRetryMock).toHaveBeenCalledTimes(1);
    // The second caller returned the freshly-refreshed access token,
    // NOT the stale one.
    expect(a?.accessToken === "new_access" || b?.accessToken === "new_access").toBe(true);
  });

  it("when the lock is held and never released, gives up and reports to Sentry", async () => {
    // Pre-seed a held lock for user-2 on platform "x". withTokenRefreshLock
    // will retry up to 5 × 50ms and then bail with a Sentry message.
    prismaMock.$transaction.mockImplementation(async (_cb) => {
      // Simulate always-blocked lock: the transaction callback sees
      // acquired=false every time. The helper treats that as a retry
      // signal, waits, and tries again.
      const tx = { $queryRaw: async () => [{ acquired: false }] };
      // Actually invoke the callback so it has a chance to throw
      // LockNotAcquiredError internally.
      return (_cb as (t: typeof tx) => Promise<unknown>)(tx);
    });

    const { withTokenRefreshLock } = await import("../token-refresh-lock");
    const workFn = vi.fn(async () => "unused");

    await expect(withTokenRefreshLock("user-2", "x", workFn)).rejects.toThrow(/failed to acquire/);
    expect(workFn).not.toHaveBeenCalled();

    const Sentry = await import("@sentry/nextjs");
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining("failed to acquire"),
      expect.objectContaining({
        tags: expect.objectContaining({ platform: "x", userId: "user-2" }),
      })
    );
  });

  it("different userIds do not contend on the same advisory key", async () => {
    const now = Date.now();
    const baseExpired = {
      accessToken: "enc:at",
      refreshToken: "enc:rt",
      xUserId: "x1",
      xUsername: "alice",
      expiresAt: new Date(now - 60_000),
      updatedAt: new Date(2020, 0, 1),
      scopes: "",
    };
    prismaMock.xApiToken.findUnique.mockImplementation(
      async ({ where: { userId } }: { where: { userId: string } }) => ({
        ...baseExpired,
        userId,
      })
    );
    prismaMock.xApiToken.update.mockResolvedValue(undefined);
    fetchWithRetryMock.mockResolvedValue(successResponse());

    const { getXApiTokenForUser } = await import("../x-token");
    const [a, b] = await Promise.all([
      getXApiTokenForUser("user-A"),
      getXApiTokenForUser("user-B"),
    ]);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    // Two different users → two independent refreshes.
    expect(fetchWithRetryMock).toHaveBeenCalledTimes(2);
  });
});
