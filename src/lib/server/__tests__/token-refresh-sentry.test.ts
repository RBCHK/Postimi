/**
 * Verifies that a terminal failure in the OAuth refresh flow (both
 * attempts fail) reports to Sentry before the token row is deleted.
 * Without this, a silent delete would mean a user is disconnected from
 * X/LinkedIn/Threads with no operator signal and no recovery path.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ───────────────────────────────────────────────

const prismaMock = vi.hoisted(() => ({
  xApiToken: {
    findUnique: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  linkedInApiToken: {
    findUnique: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  threadsApiToken: {
    findUnique: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

vi.mock("@/lib/token-encryption", () => ({
  encryptToken: (v: string) => `enc:${v}`,
  decryptToken: (v: string) => v.replace(/^enc:/, ""),
}));

const fetchWithTimeoutMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/fetch-with-timeout", () => ({
  fetchWithTimeout: fetchWithTimeoutMock,
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

beforeEach(() => {
  vi.resetAllMocks();
  process.env.X_CLIENT_ID = "xid";
  process.env.X_CLIENT_SECRET = "xsec";
  process.env.LINKEDIN_CLIENT_ID = "lid";
  process.env.LINKEDIN_CLIENT_SECRET = "lsec";
});

// Returns a Response-like stub `fetchWithTimeout` call into the module.
function badResponse(status = 401, body = "refresh_denied") {
  return {
    ok: false,
    status,
    text: async () => body,
    json: async () => ({}),
  } as unknown as Response;
}

describe("x-token refresh — Sentry on terminal failure", () => {
  it("captures exception to Sentry when both attempts fail, then deletes token", async () => {
    // Token is already expired so refresh path is taken
    const expiredToken = {
      userId: "user-1",
      accessToken: "enc:at",
      refreshToken: "enc:rt",
      xUserId: "x1",
      xUsername: "alice",
      expiresAt: new Date(Date.now() - 60_000),
      updatedAt: new Date(2020, 0, 1),
      scopes: "",
    };
    prismaMock.xApiToken.findUnique.mockResolvedValue(expiredToken);
    prismaMock.xApiToken.delete.mockResolvedValue(undefined);

    // Both refresh attempts fail
    fetchWithTimeoutMock.mockResolvedValue(badResponse(401, "invalid_refresh"));

    const { getXApiTokenForUser } = await import("../x-token");
    const result = await getXApiTokenForUser("user-1");
    expect(result).toBeNull();

    const Sentry = await import("@sentry/nextjs");
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    // Tag includes the area + userId so Sentry can filter/triage
    const call = (Sentry.captureException as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1]).toMatchObject({
      tags: expect.objectContaining({ area: "x-token", userId: "user-1" }),
    });

    expect(prismaMock.xApiToken.delete).toHaveBeenCalledWith({ where: { userId: "user-1" } });
  });

  it("does NOT call Sentry when first attempt fails but retry succeeds", async () => {
    const expiredToken = {
      userId: "user-1",
      accessToken: "enc:at",
      refreshToken: "enc:rt",
      xUserId: "x1",
      xUsername: "alice",
      expiresAt: new Date(Date.now() - 60_000),
      updatedAt: new Date(2020, 0, 1),
      scopes: "",
    };
    prismaMock.xApiToken.findUnique.mockResolvedValue(expiredToken);
    prismaMock.xApiToken.update.mockResolvedValue(undefined);

    fetchWithTimeoutMock
      .mockResolvedValueOnce(badResponse(429, "rate-limited"))
      .mockResolvedValueOnce({
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
    const result = await getXApiTokenForUser("user-1");
    expect(result).not.toBeNull();

    const Sentry = await import("@sentry/nextjs");
    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(prismaMock.xApiToken.delete).not.toHaveBeenCalled();
  });
});

describe("linkedin-token refresh — Sentry on terminal failure", () => {
  it("captures exception to Sentry when both attempts fail", async () => {
    const expiredToken = {
      userId: "user-2",
      accessToken: "enc:at",
      refreshToken: "enc:rt",
      linkedinUserId: "li1",
      linkedinName: "Bob",
      expiresAt: new Date(Date.now() - 60_000),
      updatedAt: new Date(2020, 0, 1),
      scopes: "",
    };
    prismaMock.linkedInApiToken.findUnique.mockResolvedValue(expiredToken);
    prismaMock.linkedInApiToken.delete.mockResolvedValue(undefined);

    fetchWithTimeoutMock.mockResolvedValue(badResponse(401, "invalid_refresh"));

    const { getLinkedInApiTokenForUser } = await import("../linkedin-token");
    const result = await getLinkedInApiTokenForUser("user-2");
    expect(result).toBeNull();

    const Sentry = await import("@sentry/nextjs");
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    const call = (Sentry.captureException as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1]).toMatchObject({
      tags: expect.objectContaining({ area: "linkedin-token", userId: "user-2" }),
    });
  });
});

describe("threads-token refresh — Sentry on terminal failure", () => {
  it("captures exception to Sentry when both attempts fail", async () => {
    const expiredToken = {
      userId: "user-3",
      accessToken: "enc:at",
      threadsUserId: "th1",
      threadsUsername: "carol",
      expiresAt: new Date(Date.now() - 60_000),
      updatedAt: new Date(2020, 0, 1),
      scopes: "",
      grantedScopes: [],
    };
    prismaMock.threadsApiToken.findUnique.mockResolvedValue(expiredToken);
    prismaMock.threadsApiToken.delete.mockResolvedValue(undefined);

    fetchWithTimeoutMock.mockResolvedValue(badResponse(401, "invalid_refresh"));

    const { getThreadsApiTokenForUser } = await import("../threads-token");
    const result = await getThreadsApiTokenForUser("user-3");
    expect(result).toBeNull();

    const Sentry = await import("@sentry/nextjs");
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    const call = (Sentry.captureException as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1]).toMatchObject({
      tags: expect.objectContaining({ area: "threads-token", userId: "user-3" }),
    });
  });
});
