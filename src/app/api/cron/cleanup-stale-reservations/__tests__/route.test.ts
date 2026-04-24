/**
 * Contract test for the cleanup-stale-reservations cron.
 *
 * Locks in the three invariants every cron must hold:
 *   1. Bearer-token auth gate — a missing/wrong token returns 401 and
 *      does NOT call sweepStaleReservations.
 *   2. Happy path returns `{ ok: true, status: "SUCCESS", swept }`.
 *   3. A sweepStaleReservations failure doesn't crash the handler; it
 *      returns 500 with a structured error body.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const CRON_SECRET = "test-cron-secret";

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

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

beforeEach(() => {
  process.env.CRON_SECRET = CRON_SECRET;
  vi.clearAllMocks();
  sweepStaleReservationsMock.mockReset();
  sweepStaleReservationsMock.mockResolvedValue(0);
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
    const { GET } = await import("../route");
    const res = await GET(authed());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, status: "SUCCESS", swept: 3 });
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
    const Sentry = await import("@sentry/nextjs");
    expect(Sentry.captureException).toHaveBeenCalled();
  });
});
