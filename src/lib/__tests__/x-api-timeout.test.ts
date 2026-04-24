import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/x-api-logger", () => ({
  logXApiCall: vi.fn(),
}));

// Swap fetch-with-timeout's default for a short window so the real
// AbortSignal.timeout fires within the test budget. This keeps the
// regression honest: it exercises the actual call path in x-api.ts
// (postTweet → xPost → fetchWithRetry → fetchWithTimeout), not a
// synthetic one. We deliberately call `globalThis.fetch` at invocation
// time (not at factory-import time) so `vi.stubGlobal("fetch", ...)`
// below wins — otherwise the shim would capture the native fetch before
// the stub is installed and hit the real X API.
vi.mock("@/lib/fetch-with-timeout", () => {
  return {
    fetchWithTimeout: (
      input: RequestInfo | URL,
      init: (RequestInit & { timeoutMs?: number }) | undefined = {}
    ) => {
      const { signal: callerSignal, timeoutMs: _ignored, ...rest } = init ?? {};
      void _ignored;
      const shortSignal = AbortSignal.timeout(50);
      const signal = callerSignal ? AbortSignal.any([callerSignal, shortSignal]) : shortSignal;
      return (globalThis.fetch as typeof fetch)(input, { ...rest, signal });
    },
  };
});

import { postTweet } from "../x-api";
import type { XApiCredentials } from "../x-api";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const credentials: XApiCredentials = {
  accessToken: "test-token",
  xUserId: "123",
  xUsername: "testuser",
};

beforeEach(() => {
  mockFetch.mockReset();
});

describe("x-api timeout integration", () => {
  it("aborts postTweet when the upstream hangs past the timeout", async () => {
    // Hang-until-aborted: honors the AbortSignal that fetchWithTimeout
    // composes and hands down. If postTweet forgot to route through
    // fetchWithTimeout (e.g. a future PR reintroduces raw `fetch`), no
    // signal would arrive and this test would hang until vitest kills
    // the test at its 5s default — which we treat as failure.
    //
    // Every attempt hangs: with the retry layer in place, a transient
    // abort is retried up to the fetch-with-retry default (3). Using
    // `mockImplementation` (not `Once`) means each retry also hangs
    // until the 50ms shim fires, and the terminal error is the
    // `RetryableApiError` from fetch-with-retry carrying a network
    // failure (no status).
    mockFetch.mockImplementation((_url: unknown, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          const reason =
            (init.signal as AbortSignal).reason ?? new DOMException("Aborted", "AbortError");
          reject(reason);
        });
      });
    });

    const started = Date.now();
    const err = await postTweet(credentials, "hello world").catch((e: unknown) => e);
    const elapsed = Date.now() - started;

    expect(err).toBeInstanceOf(Error);
    // After fetch-with-retry exhausts its attempts on abort-style
    // failures, it throws a RetryableApiError with status 0 (network
    // failure). The previous assertion on `TimeoutError|AbortError`
    // only held when x-api called fetchWithTimeout directly.
    const name = (err as { name?: string }).name ?? "";
    const message = (err as { message?: string }).message ?? "";
    expect(name === "RetryableApiError" || /TimeoutError|AbortError/.test(name)).toBe(true);
    expect(message).toMatch(/gave up|Aborted|timed out|The operation was aborted/);
    // Should fire within the retry budget: 3 × 50ms shim + up to 2
    // backoff waits (500ms + 1000ms base, with up to ±25% jitter).
    // Allow a generous upper bound to stay stable on loaded CI.
    expect(elapsed).toBeLessThan(4_000);
  });
});
