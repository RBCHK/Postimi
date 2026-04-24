/**
 * fetchWithRetry behaviour.
 *
 * We stub the global `fetch` to control response sequences and use
 * fake timers to assert scheduled backoff durations without actually
 * sleeping. Because `fetchWithRetry` composes `fetchWithTimeout` under
 * the hood, we exercise the real wrapper — not a mock — so retry and
 * timeout interact the way they will in production.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchWithRetry, RetryableApiError } from "../fetch-with-retry";

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function responseOk(): Response {
  return new Response("ok", { status: 200 });
}

function responseStatus(status: number, body = "err", headers?: Record<string, string>): Response {
  return new Response(body, { status, headers });
}

beforeEach(() => {
  mockFetch.mockReset();
  // Make jitter deterministic: 0 variance.
  vi.spyOn(Math, "random").mockReturnValue(0.5);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("fetchWithRetry", () => {
  it("returns on the first try when response is 200", async () => {
    mockFetch.mockResolvedValueOnce(responseOk());

    const res = await fetchWithRetry("https://example.test/ok");
    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("retries transient 500 and succeeds on the third attempt", async () => {
    vi.useFakeTimers();
    mockFetch
      .mockResolvedValueOnce(responseStatus(500))
      .mockResolvedValueOnce(responseStatus(500))
      .mockResolvedValueOnce(responseOk());

    const pending = fetchWithRetry("https://example.test/retry", { retryContext: "test:500" });
    await vi.runAllTimersAsync();
    const res = await pending;

    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("throws RetryableApiError after maxAttempts on persistent 500", async () => {
    vi.useFakeTimers();
    // Give each attempt a fresh Response — `res.text()` is a one-shot
    // read, so reusing a single instance would leave `lastBody` empty
    // after the first attempt consumes it.
    mockFetch
      .mockResolvedValueOnce(responseStatus(500, "boom"))
      .mockResolvedValueOnce(responseStatus(500, "boom"))
      .mockResolvedValueOnce(responseStatus(500, "boom"));

    const pending = fetchWithRetry("https://example.test/dead", { retryContext: "test:dead" });
    const settled = pending.catch((e) => e);
    await vi.runAllTimersAsync();
    const err = await settled;

    expect(err).toBeInstanceOf(RetryableApiError);
    expect((err as RetryableApiError).status).toBe(500);
    expect((err as RetryableApiError).attempts).toBe(3);
    expect((err as RetryableApiError).body).toBe("boom");
    expect(mockFetch).toHaveBeenCalledTimes(3);

    const Sentry = await import("@sentry/nextjs");
    expect(Sentry.captureException).toHaveBeenCalled();
    const call = (Sentry.captureException as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1]).toMatchObject({
      tags: expect.objectContaining({ context: "test:dead", lastStatus: "500" }),
    });
  });

  it("honours Retry-After header on 429 (seconds form) and waits at least that long", async () => {
    vi.useFakeTimers();
    // First 429 with Retry-After: 2 → we should wait ≥ 2000ms before retry.
    mockFetch
      .mockResolvedValueOnce(responseStatus(429, "slow down", { "Retry-After": "2" }))
      .mockResolvedValueOnce(responseOk());

    const pending = fetchWithRetry("https://example.test/throttle");
    // Advance 1.5s — should NOT have retried yet (still waiting on Retry-After).
    await vi.advanceTimersByTimeAsync(1_500);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Advance past the 2s mark → retry fires.
    await vi.advanceTimersByTimeAsync(1_000);
    const res = await pending;
    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("caps Retry-After at 60s so a misbehaving server cannot stall the caller", async () => {
    vi.useFakeTimers();
    // Server asks for 120s; we must cap at 60s.
    mockFetch
      .mockResolvedValueOnce(responseStatus(429, "backoff", { "Retry-After": "120" }))
      .mockResolvedValueOnce(responseOk());

    const pending = fetchWithRetry("https://example.test/cap");
    // Advance to just under the cap — retry should NOT have fired yet.
    await vi.advanceTimersByTimeAsync(59_000);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    // Advance past 60s cap — retry fires.
    await vi.advanceTimersByTimeAsync(1_500);
    const res = await pending;
    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry on 400 (client error)", async () => {
    mockFetch.mockResolvedValueOnce(responseStatus(400, "bad request"));

    const res = await fetchWithRetry("https://example.test/bad");
    expect(res.status).toBe(400);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("retries on network errors (TypeError from fetch)", async () => {
    vi.useFakeTimers();
    const netErr = new TypeError("fetch failed");
    mockFetch
      .mockRejectedValueOnce(netErr)
      .mockRejectedValueOnce(netErr)
      .mockResolvedValueOnce(responseOk());

    const pending = fetchWithRetry("https://example.test/network", {
      retryContext: "test:network",
    });
    await vi.runAllTimersAsync();
    const res = await pending;

    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("aborts immediately when the caller's signal fires — no retries", async () => {
    // Caller signal is already aborted when we enter.
    const ac = new AbortController();
    ac.abort(new Error("caller cancelled"));

    await expect(
      fetchWithRetry("https://example.test/cancel", { signal: ac.signal })
    ).rejects.toThrow("caller cancelled");
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
