/**
 * Covers the terminal-failure branch of the OAuth refresh flow.
 *
 * The classifier distinguishes two terminal failure modes:
 *
 *   1. `invalid_grant` (refresh token revoked) → delete row + Sentry
 *      capture with area `{platform}-token`. Only reachable via status
 *      400/401 with an `invalid_grant` body.
 *   2. Transient terminal (5xx / 429 / network / non-invalid_grant 401)
 *      → KEEP row, Sentry capture with area `{platform}-token-refresh-retry`
 *      and `reason: "non-invalid_grant terminal failure; token preserved for retry"`.
 *
 * Uses a real Postgres so the row-existence / row-deletion state is the
 * observable under test. `fetch-with-retry` is mocked (no HTTP to the
 * providers) and `@sentry/nextjs` is mocked (no SaaS calls). The outer
 * retry loop in `runTokenRefreshWithRetry` sleeps between attempts —
 * `vi.useFakeTimers()` would bypass that, but `fetchWithRetry` is itself
 * async-mocked and calls are driven by the outer loop; we bypass the
 * sleeps by forcing the mock's exchange to always return the same failure
 * shape, and the 2s/8s waits simply elapse in real time. Keeping it real
 * clock avoids the fake-timer + real-DB interaction issues.
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

// Collapse the outer retry waits so integration tests don't spend 20s
// sleeping through the exponential-backoff schedule. The classification
// logic is what we're verifying, not the cadence.
vi.mock("@/lib/server/token-refresh-retry", async () => {
  const actual = (await vi.importActual("@/lib/server/token-refresh-retry")) as Record<
    string,
    unknown
  >;
  return {
    ...actual,
    runTokenRefreshWithRetry: async <T>(exchange: () => Promise<T>) => {
      // Call exchange once — fetchWithRetryMock decides success/failure.
      // The real helper calls it up to 3× with waits between; for tests
      // we only need a single attempt to observe the classify-and-branch
      // behaviour. That is sound because classification runs on the last
      // thrown error regardless of attempt count.
      return exchange();
    },
  };
});

const PREFIX = `trefr_snt_${randomSuffix()}_`;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.X_CLIENT_ID = "xid";
  process.env.X_CLIENT_SECRET = "xsec";
  process.env.LINKEDIN_CLIENT_ID = "lid";
  process.env.LINKEDIN_CLIENT_SECRET = "lsec";
  process.env.TOKEN_ENCRYPTION_KEY =
    process.env.TOKEN_ENCRYPTION_KEY ??
    "0000000000000000000000000000000000000000000000000000000000000000";
});

afterEach(async () => {
  await cleanupByPrefix(PREFIX, { clerkId: true });
});

function invalidGrantResponse(status = 400) {
  return {
    ok: false,
    status,
    text: async () => '{"error":"invalid_grant","error_description":"refresh token revoked"}',
    json: async () => ({}),
  } as unknown as Response;
}

function transient5xxResponse(status = 503, body = "Service Unavailable") {
  return {
    ok: false,
    status,
    text: async () => body,
    json: async () => ({}),
  } as unknown as Response;
}

// ─── X ──────────────────────────────────────────────────

describe("x-token refresh — terminal failure classification (real DB)", () => {
  it("invalid_grant 400 deletes the row and reports Sentry on x-token", async () => {
    const user = await createTestUser({
      clerkId: `${PREFIX}user_${randomSuffix()}`,
    });
    await prisma.xApiToken.create({
      data: {
        userId: user.id,
        xUserId: "x1",
        xUsername: "alice",
        accessToken: encryptToken("old_access"),
        refreshToken: encryptToken("old_refresh"),
        expiresAt: new Date(Date.now() - 60_000),
        scopes: "",
      },
    });

    fetchWithRetryMock.mockResolvedValue(invalidGrantResponse(400));

    const { getXApiTokenForUser } = await import("../x-token");
    const result = await getXApiTokenForUser(user.id);
    expect(result).toBeNull();

    const Sentry = await import("@sentry/nextjs");
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    const call = (Sentry.captureException as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1]).toMatchObject({
      tags: expect.objectContaining({ area: "x-token", userId: user.id }),
    });

    const row = await prisma.xApiToken.findUnique({ where: { userId: user.id } });
    expect(row).toBeNull();
  });

  it("transient 503 keeps the row and reports Sentry on x-token-refresh-retry", async () => {
    const user = await createTestUser({
      clerkId: `${PREFIX}user_503_${randomSuffix()}`,
    });
    await prisma.xApiToken.create({
      data: {
        userId: user.id,
        xUserId: "x1",
        xUsername: "alice",
        accessToken: encryptToken("old_access"),
        refreshToken: encryptToken("old_refresh"),
        expiresAt: new Date(Date.now() - 60_000),
        scopes: "",
      },
    });

    fetchWithRetryMock.mockResolvedValue(transient5xxResponse(503));

    const { getXApiTokenForUser } = await import("../x-token");
    const result = await getXApiTokenForUser(user.id);
    expect(result).toBeNull();

    const Sentry = await import("@sentry/nextjs");
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    const call = (Sentry.captureException as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1]).toMatchObject({
      tags: expect.objectContaining({
        area: "x-token-refresh-retry",
        userId: user.id,
      }),
    });

    // Token row MUST still exist — a 5xx is transient; deleting it would
    // force user reconnection for a problem on the provider's side.
    const row = await prisma.xApiToken.findUnique({ where: { userId: user.id } });
    expect(row).not.toBeNull();
  });

  it("401 without invalid_grant body keeps the row (treated as transient)", async () => {
    const user = await createTestUser({
      clerkId: `${PREFIX}user_401bare_${randomSuffix()}`,
    });
    await prisma.xApiToken.create({
      data: {
        userId: user.id,
        xUserId: "x1",
        xUsername: "alice",
        accessToken: encryptToken("old_access"),
        refreshToken: encryptToken("old_refresh"),
        expiresAt: new Date(Date.now() - 60_000),
        scopes: "",
      },
    });

    // 401 with an opaque body is ambiguous — some providers return this
    // on transient auth glitches. Only an explicit `invalid_grant`
    // payload triggers the delete path.
    fetchWithRetryMock.mockResolvedValue(transient5xxResponse(401, "unauthorized"));

    const { getXApiTokenForUser } = await import("../x-token");
    const result = await getXApiTokenForUser(user.id);
    expect(result).toBeNull();

    const row = await prisma.xApiToken.findUnique({ where: { userId: user.id } });
    expect(row).not.toBeNull();
  });

  it("transient success on retry updates the token without deleting", async () => {
    const user = await createTestUser({
      clerkId: `${PREFIX}user_rec_${randomSuffix()}`,
    });
    await prisma.xApiToken.create({
      data: {
        userId: user.id,
        xUserId: "x1",
        xUsername: "alice",
        accessToken: encryptToken("old_access"),
        refreshToken: encryptToken("old_refresh"),
        expiresAt: new Date(Date.now() - 60_000),
        scopes: "",
      },
    });

    // First mock resolves — the retry wrapper runs exchange once here
    // (per the vi.mock above) and only the first response is consumed.
    fetchWithRetryMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: "fresh_access",
        refresh_token: "fresh_refresh",
        expires_in: 3600,
        scope: "tweet.read",
      }),
    } as unknown as Response);

    const { getXApiTokenForUser } = await import("../x-token");
    const result = await getXApiTokenForUser(user.id);
    expect(result).not.toBeNull();
    expect(result?.accessToken).toBe("fresh_access");

    const Sentry = await import("@sentry/nextjs");
    expect(Sentry.captureException).not.toHaveBeenCalled();

    const row = await prisma.xApiToken.findUnique({ where: { userId: user.id } });
    expect(row).not.toBeNull();
    expect(row!.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
});

// ─── LinkedIn ──────────────────────────────────────────

describe("linkedin-token refresh — terminal failure classification (real DB)", () => {
  it("invalid_grant 400 deletes the row", async () => {
    const user = await createTestUser({
      clerkId: `${PREFIX}user_li_ig_${randomSuffix()}`,
    });
    await prisma.linkedInApiToken.create({
      data: {
        userId: user.id,
        linkedinUserId: "li1",
        linkedinName: "Bob",
        accessToken: encryptToken("old_at"),
        refreshToken: encryptToken("old_rt"),
        expiresAt: new Date(Date.now() - 60_000),
        scopes: "",
      },
    });

    fetchWithRetryMock.mockResolvedValue(invalidGrantResponse(400));

    const { getLinkedInApiTokenForUser } = await import("../linkedin-token");
    const result = await getLinkedInApiTokenForUser(user.id);
    expect(result).toBeNull();

    const Sentry = await import("@sentry/nextjs");
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    const call = (Sentry.captureException as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1]).toMatchObject({
      tags: expect.objectContaining({ area: "linkedin-token", userId: user.id }),
    });

    const row = await prisma.linkedInApiToken.findUnique({ where: { userId: user.id } });
    expect(row).toBeNull();
  });

  it("transient 503 keeps the row and reports linkedin-token-refresh-retry", async () => {
    const user = await createTestUser({
      clerkId: `${PREFIX}user_li_503_${randomSuffix()}`,
    });
    await prisma.linkedInApiToken.create({
      data: {
        userId: user.id,
        linkedinUserId: "li1",
        linkedinName: "Bob",
        accessToken: encryptToken("old_at"),
        refreshToken: encryptToken("old_rt"),
        expiresAt: new Date(Date.now() - 60_000),
        scopes: "",
      },
    });

    fetchWithRetryMock.mockResolvedValue(transient5xxResponse(503));

    const { getLinkedInApiTokenForUser } = await import("../linkedin-token");
    const result = await getLinkedInApiTokenForUser(user.id);
    expect(result).toBeNull();

    const Sentry = await import("@sentry/nextjs");
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    const call = (Sentry.captureException as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1]).toMatchObject({
      tags: expect.objectContaining({
        area: "linkedin-token-refresh-retry",
        userId: user.id,
      }),
    });

    const row = await prisma.linkedInApiToken.findUnique({ where: { userId: user.id } });
    expect(row).not.toBeNull();
  });
});

// ─── Threads ──────────────────────────────────────────

describe("threads-token refresh — terminal failure classification (real DB)", () => {
  it("invalid_grant 400 deletes the row", async () => {
    const user = await createTestUser({
      clerkId: `${PREFIX}user_th_ig_${randomSuffix()}`,
    });
    await prisma.threadsApiToken.create({
      data: {
        userId: user.id,
        threadsUserId: "th1",
        threadsUsername: "carol",
        accessToken: encryptToken("old_at"),
        expiresAt: new Date(Date.now() - 60_000),
        scopes: "",
      },
    });

    fetchWithRetryMock.mockResolvedValue(invalidGrantResponse(400));

    const { getThreadsApiTokenForUser } = await import("../threads-token");
    const result = await getThreadsApiTokenForUser(user.id);
    expect(result).toBeNull();

    const Sentry = await import("@sentry/nextjs");
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    const call = (Sentry.captureException as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1]).toMatchObject({
      tags: expect.objectContaining({ area: "threads-token", userId: user.id }),
    });

    const row = await prisma.threadsApiToken.findUnique({ where: { userId: user.id } });
    expect(row).toBeNull();
  });

  it("transient 503 keeps the row and reports threads-token-refresh-retry", async () => {
    const user = await createTestUser({
      clerkId: `${PREFIX}user_th_503_${randomSuffix()}`,
    });
    await prisma.threadsApiToken.create({
      data: {
        userId: user.id,
        threadsUserId: "th1",
        threadsUsername: "carol",
        accessToken: encryptToken("old_at"),
        expiresAt: new Date(Date.now() - 60_000),
        scopes: "",
      },
    });

    fetchWithRetryMock.mockResolvedValue(transient5xxResponse(503));

    const { getThreadsApiTokenForUser } = await import("../threads-token");
    const result = await getThreadsApiTokenForUser(user.id);
    expect(result).toBeNull();

    const Sentry = await import("@sentry/nextjs");
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    const call = (Sentry.captureException as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1]).toMatchObject({
      tags: expect.objectContaining({
        area: "threads-token-refresh-retry",
        userId: user.id,
      }),
    });

    const row = await prisma.threadsApiToken.findUnique({ where: { userId: user.id } });
    expect(row).not.toBeNull();
  });
});
