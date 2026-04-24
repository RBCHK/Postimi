/**
 * Verifies that a terminal failure in the OAuth refresh flow reports to
 * Sentry before the token row is deleted. Without this, a silent delete
 * would mean a user is disconnected from X/LinkedIn/Threads with no
 * operator signal and no recovery path.
 *
 * Uses a real Postgres: the token row's existence/deletion is the
 * observable behaviour, and mocked Prisma would just regurgitate
 * whatever we programmed. `fetch-with-retry` is mocked (no HTTP to
 * X/LinkedIn/Meta) and `@sentry/nextjs` is mocked (no SaaS calls).
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

function badResponse(status = 401, body = "refresh_denied") {
  return {
    ok: false,
    status,
    text: async () => body,
    json: async () => ({}),
  } as unknown as Response;
}

describe("x-token refresh — Sentry on terminal failure (real DB)", () => {
  it("captures exception to Sentry when both attempts fail, then deletes token", async () => {
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

    fetchWithRetryMock.mockResolvedValue(badResponse(401, "invalid_refresh"));

    const { getXApiTokenForUser } = await import("../x-token");
    const result = await getXApiTokenForUser(user.id);
    expect(result).toBeNull();

    // Sentry got the failure
    const Sentry = await import("@sentry/nextjs");
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    const call = (Sentry.captureException as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1]).toMatchObject({
      tags: expect.objectContaining({ area: "x-token", userId: user.id }),
    });

    // Token row actually removed from DB (not just mock invocation).
    const row = await prisma.xApiToken.findUnique({ where: { userId: user.id } });
    expect(row).toBeNull();
  });

  it("does NOT call Sentry nor delete when refresh succeeds", async () => {
    const user = await createTestUser({
      clerkId: `${PREFIX}user_ok_${randomSuffix()}`,
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

    fetchWithRetryMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: "new_access",
        refresh_token: "new_refresh",
        expires_in: 3600,
        scope: "tweet.read",
      }),
    } as unknown as Response);

    const { getXApiTokenForUser } = await import("../x-token");
    const result = await getXApiTokenForUser(user.id);
    expect(result).not.toBeNull();

    const Sentry = await import("@sentry/nextjs");
    expect(Sentry.captureException).not.toHaveBeenCalled();

    // Token row still exists and got updated (new expiresAt)
    const row = await prisma.xApiToken.findUnique({ where: { userId: user.id } });
    expect(row).not.toBeNull();
    expect(row!.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
});

describe("linkedin-token refresh — Sentry on terminal failure (real DB)", () => {
  it("captures exception to Sentry when refresh fails", async () => {
    const user = await createTestUser({
      clerkId: `${PREFIX}user_li_${randomSuffix()}`,
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

    fetchWithRetryMock.mockResolvedValue(badResponse(401, "invalid_refresh"));

    const { getLinkedInApiTokenForUser } = await import("../linkedin-token");
    const result = await getLinkedInApiTokenForUser(user.id);
    expect(result).toBeNull();

    const Sentry = await import("@sentry/nextjs");
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    const call = (Sentry.captureException as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1]).toMatchObject({
      tags: expect.objectContaining({ area: "linkedin-token", userId: user.id }),
    });

    // Token row actually deleted
    const row = await prisma.linkedInApiToken.findUnique({ where: { userId: user.id } });
    expect(row).toBeNull();
  });
});

describe("threads-token refresh — Sentry on terminal failure (real DB)", () => {
  it("captures exception to Sentry when refresh fails", async () => {
    const user = await createTestUser({
      clerkId: `${PREFIX}user_th_${randomSuffix()}`,
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

    fetchWithRetryMock.mockResolvedValue(badResponse(401, "invalid_refresh"));

    const { getThreadsApiTokenForUser } = await import("../threads-token");
    const result = await getThreadsApiTokenForUser(user.id);
    expect(result).toBeNull();

    const Sentry = await import("@sentry/nextjs");
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    const call = (Sentry.captureException as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1]).toMatchObject({
      tags: expect.objectContaining({ area: "threads-token", userId: user.id }),
    });

    // Token row actually deleted
    const row = await prisma.threadsApiToken.findUnique({ where: { userId: user.id } });
    expect(row).toBeNull();
  });
});
