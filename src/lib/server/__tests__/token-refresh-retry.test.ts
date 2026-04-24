/**
 * Unit tests for the pure classification + retry-loop helpers.
 *
 * The DB-side consequences (delete vs keep row) are covered by
 * `token-refresh-sentry.test.ts` against a real Postgres. This file
 * focuses on the logic boundaries of the helper in isolation — no
 * network, no DB.
 */
import { describe, it, expect, vi } from "vitest";
import { classifyRefreshError, runTokenRefreshWithRetry } from "../token-refresh-retry";

// Fake timers so we don't wait 10+ seconds for the retry loop. `vi.advanceTimersByTime`
// drains scheduled setTimeouts deterministically.
describe("classifyRefreshError", () => {
  it("returns invalidGrant=true for 400 + invalid_grant body", () => {
    const err = new Error('X token refresh failed 400: {"error":"invalid_grant"}');
    const c = classifyRefreshError(err);
    expect(c.invalidGrant).toBe(true);
    expect(c.status).toBe(400);
    expect(c.body).toMatch(/invalid_grant/);
  });

  it("returns invalidGrant=true for 401 + invalid_grant body (LinkedIn variant)", () => {
    // LinkedIn sometimes uses 401 with an invalid_grant payload for revoked
    // tokens. Classifier must match that too.
    const err = new Error(
      'LinkedIn token refresh failed 401: {"error":"invalid_grant","error_description":"The token is revoked"}'
    );
    expect(classifyRefreshError(err).invalidGrant).toBe(true);
  });

  it("returns invalidGrant=false for 503 even if body coincidentally contains invalid_grant", () => {
    // A 5xx body that *looks* like an invalid_grant text (e.g. a leaked
    // log line) must not trigger the delete path. Only 400/401 is eligible.
    const err = new Error(
      "X token refresh failed 503: stack trace mentions invalid_grant somewhere"
    );
    expect(classifyRefreshError(err).invalidGrant).toBe(false);
  });

  it("returns invalidGrant=false for 429 / 500 / 502 / 504 regardless of body", () => {
    for (const status of [429, 500, 502, 504]) {
      const err = new Error(`X token refresh failed ${status}: whatever`);
      expect(classifyRefreshError(err).invalidGrant).toBe(false);
    }
  });

  it("returns invalidGrant=false when body lacks invalid_grant", () => {
    const err = new Error('X token refresh failed 400: {"error":"unauthorized_client"}');
    expect(classifyRefreshError(err).invalidGrant).toBe(false);
  });

  it("returns all-null classification for non-Error objects", () => {
    const c = classifyRefreshError("plain string");
    expect(c).toEqual({ invalidGrant: false, status: null, body: null });
  });

  it("returns all-null classification when message doesn't carry status", () => {
    const err = new Error("network offline");
    const c = classifyRefreshError(err);
    expect(c.status).toBeNull();
    expect(c.body).toBeNull();
    expect(c.invalidGrant).toBe(false);
  });
});

describe("runTokenRefreshWithRetry", () => {
  it("returns immediately on first success without scheduling any waits", async () => {
    const exchange = vi.fn().mockResolvedValueOnce({ access_token: "ok" });
    const out = await runTokenRefreshWithRetry(exchange);
    expect(out).toEqual({ access_token: "ok" });
    expect(exchange).toHaveBeenCalledTimes(1);
  });

  it("bails immediately on invalid_grant without retrying", async () => {
    vi.useFakeTimers();
    try {
      const exchange = vi
        .fn()
        .mockRejectedValue(new Error('X token refresh failed 400: {"error":"invalid_grant"}'));
      const promise = runTokenRefreshWithRetry(exchange);
      // The helper does NOT call setTimeout on invalid_grant — the rejection
      // should land without us having to advance the clock.
      await expect(promise).rejects.toThrow(/invalid_grant/);
      expect(exchange).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries up to 3 attempts on transient failure, then throws last error", async () => {
    vi.useFakeTimers();
    // Pin Math.random so jitter is deterministic. Without this the test
    // advances fake time by 12s but real waits can reach ~12.5s when
    // Math.random is high — an intermittent hang and timeout.
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      const exchange = vi
        .fn()
        .mockRejectedValue(new Error("X token refresh failed 503: Service Unavailable"));
      const promise = runTokenRefreshWithRetry(exchange);
      // Attach a catch now so Node doesn't report the rejection before we
      // drain the timers.
      const settled = promise.catch((e) => e);
      // With jitter pinned to 0, waits are exactly 2s + 8s = 10s.
      await vi.advanceTimersByTimeAsync(10_000);
      const err = await settled;
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toMatch(/503/);
      expect(exchange).toHaveBeenCalledTimes(3);
    } finally {
      randomSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("succeeds on second attempt — no further calls after a recovery", async () => {
    vi.useFakeTimers();
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      const exchange = vi
        .fn()
        .mockRejectedValueOnce(new Error("X token refresh failed 502: bad gateway"))
        .mockResolvedValueOnce({ access_token: "recovered" });

      const promise = runTokenRefreshWithRetry(exchange);
      // With jitter pinned to 0, first retry wait is exactly 2s.
      await vi.advanceTimersByTimeAsync(2_000);
      const out = await promise;
      expect(out).toEqual({ access_token: "recovered" });
      expect(exchange).toHaveBeenCalledTimes(2);
    } finally {
      randomSpy.mockRestore();
      vi.useRealTimers();
    }
  });
});
