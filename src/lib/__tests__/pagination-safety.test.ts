/**
 * Pagination safety tests.
 *
 * Verifies that the paginated listers in x-api and threads-api:
 *   1. Stop after `maxPages` instead of looping forever.
 *   2. Detect a "stuck" cursor — the API returning the same token/URL
 *      twice in a row — and break out.
 *
 * Both conditions emit a Sentry warning so ops can notice a
 * misbehaving upstream in prod.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/x-api-logger", () => ({
  logXApiCall: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

// Bypass retry logic — we want to count raw pagination calls.
vi.mock("@/lib/fetch-with-retry", async () => {
  const actual = (await vi.importActual("@/lib/fetch-with-retry")) as Record<string, unknown>;
  return {
    ...actual,
    fetchWithRetry: (...args: unknown[]) =>
      (global.fetch as typeof fetch)(...(args as Parameters<typeof fetch>)),
  };
});
// threads-api still imports fetchWithTimeout for the container-wait poll;
// stub it the same way.
vi.mock("@/lib/fetch-with-timeout", async () => {
  return {
    fetchWithTimeout: (...args: unknown[]) =>
      (global.fetch as typeof fetch)(...(args as Parameters<typeof fetch>)),
  };
});

import { fetchUserTweetsPaginated, type XApiCredentials } from "../x-api";
import { fetchThreadsPosts, type ThreadsApiCredentials } from "../threads-api";

const xCreds: XApiCredentials = {
  accessToken: "test-token",
  xUserId: "123",
  xUsername: "alice",
};

const threadsCreds: ThreadsApiCredentials = {
  accessToken: "test-token",
  threadsUserId: "threads-abc",
  threadsUsername: "bob",
};

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

function responseJson(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as unknown as Response;
}

describe("fetchUserTweetsPaginated — safety caps", () => {
  it("stops at the configured maxPages and reports to Sentry", async () => {
    // Every response returns a next_token → would loop forever without a cap.
    mockFetch.mockImplementation(async () =>
      responseJson({
        data: [
          {
            id: "t",
            text: "x",
            created_at: "2026-04-01T00:00:00Z",
            public_metrics: { like_count: 0, reply_count: 0, retweet_count: 0, bookmark_count: 0 },
          },
        ],
        meta: { next_token: `tok-${Math.random()}` },
      })
    );

    const tweets = await fetchUserTweetsPaginated(xCreds, { maxPages: 3 });
    expect(tweets.length).toBe(3);
    expect(mockFetch).toHaveBeenCalledTimes(3);

    const Sentry = await import("@sentry/nextjs");
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      "x-api: max pagination pages reached",
      expect.objectContaining({ level: "warning" })
    );
  });

  it("detects a stuck cursor (same next_token two pages in a row) and breaks", async () => {
    mockFetch
      .mockResolvedValueOnce(
        responseJson({
          data: [
            {
              id: "t1",
              text: "x",
              created_at: "2026-04-01T00:00:00Z",
              public_metrics: {
                like_count: 0,
                reply_count: 0,
                retweet_count: 0,
                bookmark_count: 0,
              },
            },
          ],
          meta: { next_token: "tok-A" },
        })
      )
      .mockResolvedValueOnce(
        responseJson({
          data: [
            {
              id: "t2",
              text: "x",
              created_at: "2026-04-01T00:00:00Z",
              public_metrics: {
                like_count: 0,
                reply_count: 0,
                retweet_count: 0,
                bookmark_count: 0,
              },
            },
          ],
          meta: { next_token: "tok-A" }, // same token → stuck
        })
      );

    const tweets = await fetchUserTweetsPaginated(xCreds, { maxPages: 50 });
    expect(tweets).toHaveLength(2);
    expect(mockFetch).toHaveBeenCalledTimes(2);

    const Sentry = await import("@sentry/nextjs");
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      "x-api: stuck pagination cursor",
      expect.objectContaining({ level: "warning" })
    );
  });

  it("exits cleanly when next_token is absent (normal case)", async () => {
    mockFetch.mockResolvedValueOnce(
      responseJson({
        data: [
          {
            id: "t1",
            text: "x",
            created_at: "2026-04-01T00:00:00Z",
            public_metrics: { like_count: 0, reply_count: 0, retweet_count: 0, bookmark_count: 0 },
          },
        ],
        meta: {},
      })
    );
    const tweets = await fetchUserTweetsPaginated(xCreds);
    expect(tweets).toHaveLength(1);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe("fetchThreadsPosts — safety caps", () => {
  it("stops at the configured maxPages", async () => {
    // Every page returns paging.next with a fresh unique ID → would
    // loop without a cap. With dedup on IDs the per-page content is
    // always new, so only the hard page cap fires.
    let idCounter = 0;
    mockFetch.mockImplementation(async () =>
      responseJson({
        data: [
          {
            id: `th-${++idCounter}`,
            text: "x",
            media_type: "TEXT_POST",
            timestamp: "2026-04-01T00:00:00+0000",
          },
        ],
        paging: { next: `https://graph.threads.net/v1.0/next-${idCounter}` },
      })
    );

    const posts = await fetchThreadsPosts(threadsCreds, { limit: 1000, maxPages: 4 });
    expect(posts.length).toBe(4);
    expect(mockFetch).toHaveBeenCalledTimes(4);

    const Sentry = await import("@sentry/nextjs");
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      "threads-pagination-cap-hit",
      expect.objectContaining({ level: "warning" })
    );
  });

  it("dedupes duplicate IDs across pages and does not double-count", async () => {
    // Meta hands back two different `paging.next` URLs but the
    // second page contains only IDs already seen on the first page.
    // The paginator must (a) not double-count, (b) break rather than
    // fetch page three.
    mockFetch
      .mockResolvedValueOnce(
        responseJson({
          data: [
            {
              id: "th-1",
              text: "x",
              media_type: "TEXT_POST",
              timestamp: "2026-04-01T00:00:00+0000",
            },
            {
              id: "th-2",
              text: "y",
              media_type: "TEXT_POST",
              timestamp: "2026-04-02T00:00:00+0000",
            },
          ],
          paging: { next: "https://graph.threads.net/v1.0/page?cursor=B" },
        })
      )
      .mockResolvedValueOnce(
        responseJson({
          data: [
            // Duplicates of page 1.
            {
              id: "th-1",
              text: "x",
              media_type: "TEXT_POST",
              timestamp: "2026-04-01T00:00:00+0000",
            },
            {
              id: "th-2",
              text: "y",
              media_type: "TEXT_POST",
              timestamp: "2026-04-02T00:00:00+0000",
            },
          ],
          paging: { next: "https://graph.threads.net/v1.0/page?cursor=C" },
        })
      );

    const posts = await fetchThreadsPosts(threadsCreds, { limit: 100 });
    expect(posts.map((p) => p.id)).toEqual(["th-1", "th-2"]);
    // Two pages fetched — the third is short-circuited by the dedup guard.
    expect(mockFetch).toHaveBeenCalledTimes(2);

    const Sentry = await import("@sentry/nextjs");
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      "threads-api: stuck pagination cursor",
      expect.objectContaining({ level: "warning" })
    );
  });
});
