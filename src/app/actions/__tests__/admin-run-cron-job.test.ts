import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const prismaMock = vi.hoisted(() => ({
  cronJobConfig: { findMany: vi.fn(), update: vi.fn() },
  cronJobRun: { findMany: vi.fn() },
  xApiCallLog: { aggregate: vi.fn(), findMany: vi.fn() },
}));

const requireAdminMock = vi.hoisted(() => vi.fn<() => Promise<string>>());

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/auth", () => ({ requireAdmin: requireAdminMock }));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;
const ORIGINAL_APP_URL = process.env.NEXT_PUBLIC_APP_URL;

beforeEach(() => {
  vi.resetAllMocks();
  requireAdminMock.mockResolvedValue("admin-user-id");
  process.env.CRON_SECRET = "test-secret";
  process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";
});

afterEach(() => {
  process.env.CRON_SECRET = ORIGINAL_CRON_SECRET;
  process.env.NEXT_PUBLIC_APP_URL = ORIGINAL_APP_URL;
});

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

describe("runCronJob", () => {
  it("requires admin (wrapper throws if not admin)", async () => {
    requireAdminMock.mockRejectedValueOnce(new Error("Not admin"));
    const { runCronJob } = await import("../admin");
    await expect(runCronJob("x-import")).rejects.toThrow("Not admin");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("attaches Authorization: Bearer ${CRON_SECRET} and ?manual=1", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, status: "SUCCESS" }));
    const { runCronJob } = await import("../admin");
    const result = await runCronJob("x-import");
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    // `?manual=1` signals withCronLogging to bypass the enabled toggle for
    // admin-triggered runs. Without it, a paused cron returns "Job disabled"
    // and the UI shows "unknown error".
    expect(url).toBe("https://app.example.com/api/cron/x-import?manual=1");
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: "Bearer test-secret",
    });
  });

  it("rejects unknown job names (path whitelist)", async () => {
    const { runCronJob } = await import("../admin");
    // Would be a path traversal vector if not whitelisted.
    const result = await runCronJob("../secret");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Unknown job");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("resolves the path against NEXT_PUBLIC_APP_URL so it works on Vercel", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://prod.example.com";
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
    const { runCronJob } = await import("../admin");
    await runCronJob("social-import");
    expect(fetchMock.mock.calls[0]![0]).toBe(
      "https://prod.example.com/api/cron/social-import?manual=1"
    );
  });

  it("surfaces skipped reason instead of falling through to 'unknown error'", async () => {
    // With manual=1, withCronLogging should NOT skip — but this tests the
    // defense-in-depth path for any future skip conditions the runtime adds.
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ok: false, skipped: true, reason: "Job disabled" }, 200)
    );
    const { runCronJob } = await import("../admin");
    const result = await runCronJob("x-import");
    expect(result.ok).toBe(false);
    expect("skipped" in result && result.skipped).toBe(true);
    expect("reason" in result && result.reason).toBe("Job disabled");
  });

  it("returns ok:false when the cron route returns non-2xx", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "Unauthorized" }, 401));
    const { runCronJob } = await import("../admin");
    const result = await runCronJob("x-import");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Unauthorized");
  });

  it("surfaces ok:false from the cron response even when HTTP 200", async () => {
    // withCronLogging returns HTTP 200 with ok:false on handler failure.
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: false, error: "boom" }, 200));
    const { runCronJob } = await import("../admin");
    const result = await runCronJob("x-import");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("boom");
  });

  it("returns error when CRON_SECRET is missing (fails loud, not silent 500)", async () => {
    delete process.env.CRON_SECRET;
    const { runCronJob } = await import("../admin");
    const result = await runCronJob("x-import");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("CRON_SECRET");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("catches fetch errors and returns them as ok:false", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const { runCronJob } = await import("../admin");
    const result = await runCronJob("x-import");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("ECONNREFUSED");
  });

  it("allows all 7 known jobs (keeps whitelist in sync with UI map)", async () => {
    const jobs = [
      "followers-snapshot",
      "trend-snapshot",
      "daily-insight",
      "x-import",
      "social-import",
      "researcher",
      "strategist",
    ];
    const { runCronJob } = await import("../admin");
    for (const job of jobs) {
      fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
      const result = await runCronJob(job);
      expect(result.ok, `job ${job} should be allowed`).toBe(true);
    }
  });
});
