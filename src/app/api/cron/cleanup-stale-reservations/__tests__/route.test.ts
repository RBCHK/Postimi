/**
 * Contract test for the cleanup-stale-reservations cron.
 *
 * Locks in the invariants every cron must hold:
 *   1. Bearer-token auth gate — a missing/wrong token returns 401 and
 *      does NOT call sweepStaleReservations or touch retention.
 *   2. Happy path returns `{ ok: true, status: "SUCCESS", swept, retention }`.
 *   3. A sweepStaleReservations failure doesn't crash the handler; it
 *      returns 500 with a structured error body.
 *   4. Retention cleanup deletes rows older than each table's window and
 *      continues even if one table's delete fails.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const CRON_SECRET = "test-cron-secret";

const sentryMock = { captureException: vi.fn() };
vi.mock("@sentry/nextjs", () => sentryMock);

// `next/server`'s `after()` is only legal inside a real request scope.
// In unit tests we stub it to invoke the callback synchronously; the
// actual cron-run logging runs against the real DB instead of being
// skipped so we still exercise that path.
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

const sweepStaleReservationsMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ai-quota", () => ({
  sweepStaleReservations: sweepStaleReservationsMock,
}));

// Prisma mock: retention cleanup calls deleteMany on three tables plus
// the CronJobConfig lookup inside withCronLogging.
const prismaMock = {
  cronJobConfig: {
    findUnique: vi.fn().mockResolvedValue(null),
  },
  cronJobRun: {
    create: vi.fn().mockResolvedValue({}),
    deleteMany: vi.fn(),
  },
  xApiCallLog: {
    deleteMany: vi.fn(),
  },
  aiUsage: {
    deleteMany: vi.fn(),
  },
};
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

beforeEach(() => {
  process.env.CRON_SECRET = CRON_SECRET;
  vi.clearAllMocks();
  sweepStaleReservationsMock.mockReset();
  sweepStaleReservationsMock.mockResolvedValue(0);
  prismaMock.cronJobConfig.findUnique.mockResolvedValue(null);
  prismaMock.cronJobRun.create.mockResolvedValue({});
  prismaMock.cronJobRun.deleteMany.mockResolvedValue({ count: 0 });
  prismaMock.xApiCallLog.deleteMany.mockResolvedValue({ count: 0 });
  prismaMock.aiUsage.deleteMany.mockResolvedValue({ count: 0 });
});

function authed() {
  return new NextRequest("https://app.postimi.com/api/cron/cleanup-stale-reservations", {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
}

function unauthed() {
  return new NextRequest("https://app.postimi.com/api/cron/cleanup-stale-reservations");
}

describe("cleanup-stale-reservations cron — contract", () => {
  it("returns 401 when Bearer token is missing", async () => {
    const { GET } = await import("../route");
    const res = await GET(unauthed());
    expect(res.status).toBe(401);
    // Auth failed → sweep must not have been called.
    expect(sweepStaleReservationsMock).not.toHaveBeenCalled();
    expect(prismaMock.xApiCallLog.deleteMany).not.toHaveBeenCalled();
    expect(prismaMock.aiUsage.deleteMany).not.toHaveBeenCalled();
    expect(prismaMock.cronJobRun.deleteMany).not.toHaveBeenCalled();
  });

  it("returns 401 when Bearer token is wrong", async () => {
    const { GET } = await import("../route");
    const req = new NextRequest("https://app.postimi.com/api/cron/cleanup-stale-reservations", {
      headers: { authorization: "Bearer wrong-secret" },
    });
    const res = await GET(req);
    expect(res.status).toBe(401);
    expect(sweepStaleReservationsMock).not.toHaveBeenCalled();
  });

  it("returns SUCCESS shape when sweep runs cleanly", async () => {
    sweepStaleReservationsMock.mockResolvedValueOnce(3);
    prismaMock.xApiCallLog.deleteMany.mockResolvedValueOnce({ count: 12 });
    prismaMock.aiUsage.deleteMany.mockResolvedValueOnce({ count: 4 });
    prismaMock.cronJobRun.deleteMany.mockResolvedValueOnce({ count: 7 });

    const { GET } = await import("../route");
    const res = await GET(authed());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      ok: true,
      status: "SUCCESS",
      swept: 3,
      retention: { xApiCallLog: 12, aiUsage: 4, cronJobRun: 7 },
    });
  });

  it("returns 500 with structured error when sweep throws", async () => {
    sweepStaleReservationsMock.mockRejectedValueOnce(new Error("db unavailable"));
    const { GET } = await import("../route");
    const res = await GET(authed());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false });
    expect(body.error).toContain("db unavailable");

    // Sentry got the exception.
    expect(sentryMock.captureException).toHaveBeenCalled();
  });
});

describe("cleanup-stale-reservations cron — retention", () => {
  it("deletes XApiCallLog rows older than 90 days", async () => {
    const { GET } = await import("../route");
    await GET(authed());

    expect(prismaMock.xApiCallLog.deleteMany).toHaveBeenCalledTimes(1);
    const args = prismaMock.xApiCallLog.deleteMany.mock.calls[0]![0];
    const cutoff = (args.where as { calledAt: { lt: Date } }).calledAt.lt;
    expect(cutoff).toBeInstanceOf(Date);
    const ageDays = (Date.now() - cutoff.getTime()) / (24 * 60 * 60 * 1000);
    expect(ageDays).toBeGreaterThan(89.99);
    expect(ageDays).toBeLessThan(90.01);
  });

  it("deletes terminal AiUsage rows older than 180 days (not RESERVED)", async () => {
    const { GET } = await import("../route");
    await GET(authed());

    expect(prismaMock.aiUsage.deleteMany).toHaveBeenCalledTimes(1);
    const args = prismaMock.aiUsage.deleteMany.mock.calls[0]![0];
    const where = args.where as { createdAt: { lt: Date }; status: { in: string[] } };
    const ageDays = (Date.now() - where.createdAt.lt.getTime()) / (24 * 60 * 60 * 1000);
    expect(ageDays).toBeGreaterThan(179.99);
    expect(ageDays).toBeLessThan(180.01);
    // RESERVED is explicitly excluded — sweepStaleReservations handles it.
    expect(where.status.in).toEqual(["COMPLETED", "ABORTED", "FAILED"]);
    expect(where.status.in).not.toContain("RESERVED");
  });

  it("deletes CronJobRun rows older than 30 days", async () => {
    const { GET } = await import("../route");
    await GET(authed());

    expect(prismaMock.cronJobRun.deleteMany).toHaveBeenCalledTimes(1);
    const args = prismaMock.cronJobRun.deleteMany.mock.calls[0]![0];
    const cutoff = (args.where as { startedAt: { lt: Date } }).startedAt.lt;
    const ageDays = (Date.now() - cutoff.getTime()) / (24 * 60 * 60 * 1000);
    expect(ageDays).toBeGreaterThan(29.99);
    expect(ageDays).toBeLessThan(30.01);
  });

  it("one table's failure does not abort the other tables' deletes", async () => {
    prismaMock.xApiCallLog.deleteMany.mockRejectedValueOnce(new Error("lock timeout"));
    prismaMock.aiUsage.deleteMany.mockResolvedValueOnce({ count: 5 });
    prismaMock.cronJobRun.deleteMany.mockResolvedValueOnce({ count: 2 });

    const { GET } = await import("../route");
    const res = await GET(authed());
    expect(res.status).toBe(200);
    const body = await res.json();

    // Failure captured to Sentry with a table tag.
    expect(sentryMock.captureException).toHaveBeenCalled();
    const sentryArgs = sentryMock.captureException.mock.calls[0]![1];
    expect(sentryArgs.tags).toMatchObject({ job: "retention", table: "XApiCallLog" });

    // Other tables continued and their counts appear in the response.
    expect(body.retention.aiUsage).toBe(5);
    expect(body.retention.cronJobRun).toBe(2);
    expect(body.retention.xApiCallLog).toMatchObject({ error: expect.stringContaining("lock") });
  });

  it("returns per-table counts in the response body", async () => {
    prismaMock.xApiCallLog.deleteMany.mockResolvedValueOnce({ count: 100 });
    prismaMock.aiUsage.deleteMany.mockResolvedValueOnce({ count: 50 });
    prismaMock.cronJobRun.deleteMany.mockResolvedValueOnce({ count: 25 });

    const { GET } = await import("../route");
    const res = await GET(authed());
    const body = await res.json();
    expect(body.retention).toEqual({ xApiCallLog: 100, aiUsage: 50, cronJobRun: 25 });
  });
});
