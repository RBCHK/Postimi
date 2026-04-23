import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchWithTimeout } from "../fetch-with-timeout";

// The wrapper delegates to the real global `fetch`, so we stub it out
// per test. We also hand-roll a "hang until aborted" fetch so we can
// assert real AbortSignal propagation rather than mocking around it.
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("fetchWithTimeout", () => {
  it("resolves normal responses without modification", async () => {
    const body = new Response("ok", { status: 200 });
    mockFetch.mockResolvedValueOnce(body);

    const res = await fetchWithTimeout("https://example.test/ok");

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
    expect(mockFetch).toHaveBeenCalledTimes(1);
    // The wrapper always attaches a signal — even without a caller signal.
    const init = mockFetch.mock.calls[0]![1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("rejects with an AbortError when the upstream hangs past timeoutMs", async () => {
    // Pass the caller's signal through to a fetch that only settles when
    // aborted. This mirrors what Node's real fetch does on abort.
    mockFetch.mockImplementationOnce((_url: unknown, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          const reason =
            (init.signal as AbortSignal).reason ?? new DOMException("Aborted", "AbortError");
          reject(reason);
        });
      });
    });

    vi.useFakeTimers();
    const pending = fetchWithTimeout("https://example.test/hang", { timeoutMs: 50 });
    // A safety catch so the unhandled-rejection listener doesn't fire
    // while we advance timers — we'll still assert the rejection below.
    const settled = pending.catch((e) => e);
    await vi.advanceTimersByTimeAsync(75);
    const err = await settled;
    expect(err).toBeInstanceOf(Error);
    // AbortSignal.timeout rejects with a TimeoutError DOMException.
    expect((err as { name?: string }).name).toMatch(/TimeoutError|AbortError/);
  });

  it("aborts when the caller's signal fires before the timeout", async () => {
    mockFetch.mockImplementationOnce((_url: unknown, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          const reason =
            (init.signal as AbortSignal).reason ?? new DOMException("Aborted", "AbortError");
          reject(reason);
        });
      });
    });

    const ac = new AbortController();
    const pending = fetchWithTimeout("https://example.test/hang", {
      timeoutMs: 10_000,
      signal: ac.signal,
    });
    const settled = pending.catch((e) => e);
    // Give the microtask a tick so the listener is attached, then abort.
    await Promise.resolve();
    ac.abort(new Error("caller cancelled"));
    const err = await settled;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("caller cancelled");
  });

  it("propagates method, headers, and body to the underlying fetch", async () => {
    mockFetch.mockResolvedValueOnce(new Response("{}", { status: 201 }));

    await fetchWithTimeout("https://example.test/post", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Trace": "abc" },
      body: JSON.stringify({ hello: "world" }),
    });

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://example.test/post");
    expect(init.method).toBe("POST");
    expect(init.body).toBe('{"hello":"world"}');
    expect(init.headers).toMatchObject({ "X-Trace": "abc" });
  });
});
