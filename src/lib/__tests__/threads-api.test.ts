import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  fetchThreadsPosts,
  fetchThreadInsights,
  fetchThreadsUserInsights,
  ThreadsAuthError,
  ThreadsScopeError,
  type ThreadsApiCredentials,
} from "../threads-api";

// ADR-008 Phase 2 contract test.
//
// These tests lock the shape of the Threads Graph API responses we rely
// on. If Meta changes the field names (e.g. `views` → `impressions`),
// these tests should fail first and loudly — before a silent cron
// regression writes zeros into `SocialPost`.

const creds: ThreadsApiCredentials = {
  accessToken: "test-token",
  threadsUserId: "threads-abc",
  threadsUsername: "testuser",
};

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

function response(body: unknown, init: { status?: number; text?: string } = {}) {
  const status = init.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => init.text ?? JSON.stringify(body),
    json: async () => body,
  };
}

describe("fetchThreadsPosts", () => {
  it("returns normalised posts with mediaType fallback for unknown values", async () => {
    mockFetch.mockResolvedValueOnce(
      response({
        data: [
          {
            id: "t1",
            text: "hello",
            media_type: "TEXT_POST",
            permalink: "https://threads.net/@u/post/t1",
            timestamp: "2026-04-10T12:00:00+0000",
          },
          {
            id: "t2",
            text: "image post",
            media_type: "IMAGE",
            permalink: "https://threads.net/@u/post/t2",
            timestamp: "2026-04-11T12:00:00+0000",
          },
          {
            id: "t3",
            text: "new surface",
            media_type: "FUTURE_KIND",
            permalink: null,
            timestamp: "2026-04-12T12:00:00+0000",
            reply_to: { id: "t1" },
          },
        ],
      })
    );

    const posts = await fetchThreadsPosts(creds);
    expect(posts).toHaveLength(3);
    expect(posts[0]!.mediaType).toBe("TEXT_POST");
    expect(posts[1]!.mediaType).toBe("IMAGE");
    // Unknown type buckets into TEXT_POST so analytics doesn't reject it.
    expect(posts[2]!.mediaType).toBe("TEXT_POST");
    expect(posts[2]!.replyToId).toBe("t1");
  });

  it("retries on 429 with backoff and succeeds on the final attempt", async () => {
    vi.useFakeTimers();
    mockFetch.mockResolvedValueOnce(response({}, { status: 429 }));
    mockFetch.mockResolvedValueOnce(response({}, { status: 429 }));
    mockFetch.mockResolvedValueOnce(response({ data: [] }));

    const pending = fetchThreadsPosts(creds);
    // Drain the backoff timers.
    await vi.runAllTimersAsync();
    const posts = await pending;
    vi.useRealTimers();

    expect(posts).toEqual([]);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("throws ThreadsAuthError on 401", async () => {
    mockFetch.mockResolvedValueOnce(response({}, { status: 401, text: "invalid_token" }));
    await expect(fetchThreadsPosts(creds)).rejects.toBeInstanceOf(ThreadsAuthError);
  });

  it("follows paging.next until limit is reached", async () => {
    mockFetch.mockResolvedValueOnce(
      response({
        data: [
          { id: "a", timestamp: "2026-04-01T00:00:00+0000", media_type: "TEXT_POST" },
          { id: "b", timestamp: "2026-04-02T00:00:00+0000", media_type: "TEXT_POST" },
        ],
        paging: { next: "https://graph.threads.net/v1.0/next-page" },
      })
    );
    mockFetch.mockResolvedValueOnce(
      response({
        data: [{ id: "c", timestamp: "2026-04-03T00:00:00+0000", media_type: "TEXT_POST" }],
      })
    );

    const posts = await fetchThreadsPosts(creds, { limit: 3 });
    expect(posts.map((p) => p.id)).toEqual(["a", "b", "c"]);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

describe("fetchThreadInsights", () => {
  it("pivots Meta's metric-array response into a flat object", async () => {
    mockFetch.mockResolvedValueOnce(
      response({
        data: [
          { name: "views", values: [{ value: 1200 }] },
          { name: "likes", values: [{ value: 50 }] },
          { name: "replies", values: [{ value: 7 }] },
          { name: "reposts", values: [{ value: 3 }] },
          { name: "quotes", values: [{ value: 2 }] },
          { name: "shares", values: [{ value: 4 }] },
        ],
      })
    );

    const insights = await fetchThreadInsights(creds, "t-1");
    expect(insights).toEqual({
      views: 1200,
      likes: 50,
      replies: 7,
      reposts: 3,
      quotes: 2,
      shares: 4,
    });
  });

  it("throws ThreadsScopeError when 403 includes scope language", async () => {
    mockFetch.mockResolvedValueOnce(
      response({}, { status: 403, text: '{"error":{"message":"scope not granted"}}' })
    );
    await expect(fetchThreadInsights(creds, "t-1")).rejects.toBeInstanceOf(ThreadsScopeError);
  });

  it("throws ThreadsScopeError when Meta returns 500 with error code 10", async () => {
    // Observed in prod (Sentry issue 7422796902): Meta returns HTTP 500
    // with `code:10` when the app lacks permission. We must classify it
    // as a scope denial, not a generic error.
    mockFetch.mockResolvedValueOnce(
      response(
        {},
        {
          status: 500,
          text: '{"error":{"message":"Application does not have permission for this action","type":"THApiException","code":10,"fbtrace_id":"A_teeOpMVJNeoabpK5OZLGL"}}',
        }
      )
    );
    await expect(fetchThreadInsights(creds, "t-1")).rejects.toBeInstanceOf(ThreadsScopeError);
  });

  it("throws ThreadsAuthError when 401 has no scope hint", async () => {
    mockFetch.mockResolvedValueOnce(response({}, { status: 401, text: "session expired" }));
    await expect(fetchThreadInsights(creds, "t-1")).rejects.toBeInstanceOf(ThreadsAuthError);
  });
});

describe("fetchThreadsUserInsights", () => {
  it("pivots per-metric time series into per-day rows sorted chronologically", async () => {
    mockFetch.mockResolvedValueOnce(
      response({
        data: [
          {
            name: "views",
            values: [
              { value: 100, end_time: "2026-04-10T00:00:00+0000" },
              { value: 150, end_time: "2026-04-11T00:00:00+0000" },
            ],
          },
          {
            name: "followers_count",
            values: [
              { value: 1000, end_time: "2026-04-10T00:00:00+0000" },
              { value: 1010, end_time: "2026-04-11T00:00:00+0000" },
            ],
          },
        ],
      })
    );

    const rows = await fetchThreadsUserInsights(creds, {
      since: new Date("2026-04-10T00:00:00Z"),
      until: new Date("2026-04-11T23:59:59Z"),
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]!.followersCount).toBe(1000);
    expect(rows[0]!.views).toBe(100);
    expect(rows[1]!.followersCount).toBe(1010);
    expect(rows[0]!.date.getTime()).toBeLessThan(rows[1]!.date.getTime());
  });

  it("throws ThreadsScopeError when Meta returns 500 with error code 10", async () => {
    // Same Sentry-observed shape as fetchThreadInsights — account-level
    // insights also require threads_manage_insights, and Meta signals
    // denial the same way.
    mockFetch.mockResolvedValueOnce(
      response(
        {},
        {
          status: 500,
          text: '{"error":{"message":"Application does not have permission for this action","type":"THApiException","code":10,"fbtrace_id":"A_teeOpMVJNeoabpK5OZLGL"}}',
        }
      )
    );
    await expect(
      fetchThreadsUserInsights(creds, {
        since: new Date("2026-04-10T00:00:00Z"),
        until: new Date("2026-04-11T23:59:59Z"),
      })
    ).rejects.toBeInstanceOf(ThreadsScopeError);
  });

  it("throws ThreadsScopeError on 403 with scope language", async () => {
    mockFetch.mockResolvedValueOnce(
      response({}, { status: 403, text: '{"error":{"message":"scope not granted"}}' })
    );
    await expect(
      fetchThreadsUserInsights(creds, {
        since: new Date("2026-04-10T00:00:00Z"),
        until: new Date("2026-04-11T23:59:59Z"),
      })
    ).rejects.toBeInstanceOf(ThreadsScopeError);
  });

  it("throws ThreadsAuthError when 401 has no scope hint", async () => {
    mockFetch.mockResolvedValueOnce(response({}, { status: 401, text: "session expired" }));
    await expect(
      fetchThreadsUserInsights(creds, {
        since: new Date("2026-04-10T00:00:00Z"),
        until: new Date("2026-04-11T23:59:59Z"),
      })
    ).rejects.toBeInstanceOf(ThreadsAuthError);
  });
});
