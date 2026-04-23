import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/x-api-logger", () => ({
  logXApiCall: vi.fn(),
}));

// Swap fetch-with-timeout's default for a short window so the real
// AbortSignal.timeout fires within the test budget. This keeps the
// regression honest: it exercises the actual call path in x-api.ts
// (postTweet → xPost → fetchWithTimeout), not a synthetic one.
vi.mock("@/lib/fetch-with-timeout", async () => {
  const realFetch = global.fetch;
  return {
    fetchWithTimeout: (
      input: RequestInfo | URL,
      init: (RequestInit & { timeoutMs?: number }) | undefined = {}
    ) => {
      const { signal: callerSignal, timeoutMs: _ignored, ...rest } = init ?? {};
      void _ignored;
      const shortSignal = AbortSignal.timeout(50);
      const signal = callerSignal ? AbortSignal.any([callerSignal, shortSignal]) : shortSignal;
      return realFetch(input, { ...rest, signal });
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
    mockFetch.mockImplementationOnce((_url: unknown, init: RequestInit) => {
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
    expect((err as { name?: string }).name).toMatch(/TimeoutError|AbortError/);
    // Should fire well within the short 50ms shim window + overhead.
    expect(elapsed).toBeLessThan(2_000);
  });
});
