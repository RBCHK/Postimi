import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// Mock `after()` to a pass-through — Vercel's `after` callback wrapper is not
// available in the unit-test runtime, and we only care that the handler's
// response body is correct here. DB logging side-effects are covered by a
// separate integration test.
vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");
  return { ...actual, after: (fn: () => void | Promise<void>) => fn() };
});

const prismaMock = vi.hoisted(() => ({
  cronJobConfig: { findUnique: vi.fn() },
  cronJobRun: { create: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;

beforeEach(() => {
  vi.resetAllMocks();
  process.env.CRON_SECRET = "test-secret";
  prismaMock.cronJobRun.create.mockResolvedValue({});
});

afterEach(() => {
  process.env.CRON_SECRET = ORIGINAL_CRON_SECRET;
});

function req(url: string): NextRequest {
  return new NextRequest(url, { headers: { authorization: "Bearer test-secret" } });
}

describe("withCronLogging — enabled toggle", () => {
  it("returns 401 when Authorization header is missing or wrong", async () => {
    const { withCronLogging } = await import("../cron-helpers");
    const handler = vi.fn();
    const wrapped = withCronLogging("x-import", handler);
    const unauthed = new NextRequest("https://ex.com/api/cron/x-import");
    const res = await wrapped(unauthed);
    expect(res.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it("skips execution when CronJobConfig.enabled=false and manual flag is absent", async () => {
    prismaMock.cronJobConfig.findUnique.mockResolvedValue({ enabled: false });
    const handler = vi.fn();
    const { withCronLogging } = await import("../cron-helpers");
    const wrapped = withCronLogging("x-import", handler);
    const res = await wrapped(req("https://ex.com/api/cron/x-import"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false, skipped: true, reason: "Job disabled" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("bypasses the disabled toggle when ?manual=1 is present (admin Run now)", async () => {
    // The toggle controls Vercel scheduled runs, not explicit admin actions.
    // Admin ▷ Run now on a disabled cron must still execute — otherwise the
    // admin sees a misleading "skipped" response on a button they deliberately
    // clicked.
    prismaMock.cronJobConfig.findUnique.mockResolvedValue({ enabled: false });
    const handler = vi.fn().mockResolvedValue({ status: "SUCCESS", data: {} });
    const { withCronLogging } = await import("../cron-helpers");
    const wrapped = withCronLogging("x-import", handler);
    const res = await wrapped(req("https://ex.com/api/cron/x-import?manual=1"));
    expect(handler).toHaveBeenCalledTimes(1);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.status).toBe("SUCCESS");
  });

  it("treats manual=0 or any non-'1' value as a normal scheduled run", async () => {
    prismaMock.cronJobConfig.findUnique.mockResolvedValue({ enabled: false });
    const handler = vi.fn();
    const { withCronLogging } = await import("../cron-helpers");
    const wrapped = withCronLogging("x-import", handler);
    const res = await wrapped(req("https://ex.com/api/cron/x-import?manual=0"));
    const body = await res.json();
    expect(body.skipped).toBe(true);
    expect(handler).not.toHaveBeenCalled();
  });

  it("runs normally when CronJobConfig row is missing (missing = enabled)", async () => {
    prismaMock.cronJobConfig.findUnique.mockResolvedValue(null);
    const handler = vi.fn().mockResolvedValue({ status: "SUCCESS", data: { imported: 7 } });
    const { withCronLogging } = await import("../cron-helpers");
    const wrapped = withCronLogging("x-import", handler);
    const res = await wrapped(req("https://ex.com/api/cron/x-import"));
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.imported).toBe(7);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
