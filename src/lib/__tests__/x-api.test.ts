import { describe, it, expect, vi, beforeEach } from "vitest";

// x-api.ts imports x-api-logger, which imports @/lib/prisma. We do NOT
// want to bring up a Postgres adapter in a contract test — the logger
// is fire-and-forget and orthogonal to the HTTP shapes we care about.
// Stub it to a no-op before loading x-api.
vi.mock("@/lib/x-api-logger", () => ({
  logXApiCall: vi.fn(),
}));

import {
  postTweet,
  uploadMediaToX,
  fetchUserData,
  fetchTweetMetrics,
  fetchCurrentUser,
  XApiAuthError,
  type XApiCredentials,
} from "../x-api";

// Contract tests for src/lib/x-api.ts.
//
// These lock the shape of X (Twitter) Graph v2 responses we depend on.
// If X renames a field (e.g. `impression_count` → `view_count`), these
// tests fail loudly — BEFORE a silent cron regression writes zeros into
// `SocialPost.impressions` or a post to `/tweets` mis-parses the new id.
//
// Mirrors the pattern in src/lib/__tests__/threads-api.test.ts.

const creds: XApiCredentials = {
  accessToken: "test-token",
  xUserId: "x-user-abc",
  xUsername: "testuser",
};

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

type MockInit = { status?: number; text?: string; headers?: Record<string, string> };

function response(body: unknown, init: MockInit = {}) {
  const status = init.status ?? 200;
  const headers = new Map(Object.entries(init.headers ?? {}));
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 || status === 201 ? "OK" : "Error",
    text: async () => init.text ?? JSON.stringify(body),
    json: async () => body,
    headers: {
      get: (name: string) => headers.get(name.toLowerCase()) ?? headers.get(name) ?? null,
    },
  };
}

describe("postTweet", () => {
  it("returns the tweet id and a canonical x.com URL", async () => {
    mockFetch.mockResolvedValueOnce(
      response({ data: { id: "1234567890", text: "hello world" } }, { status: 201 })
    );

    const result = await postTweet(creds, "hello world");
    expect(result.tweetId).toBe("1234567890");
    expect(result.tweetUrl).toBe("https://x.com/testuser/status/1234567890");
  });

  it("attaches media_ids to the request body when provided", async () => {
    mockFetch.mockResolvedValueOnce(
      response({ data: { id: "t-with-media", text: "with media" } }, { status: 201 })
    );

    await postTweet(creds, "with media", { mediaIds: ["media-1", "media-2"] });

    const call = mockFetch.mock.calls[0]!;
    const init = call[1] as { body?: string };
    const parsed = JSON.parse(init.body ?? "{}");
    expect(parsed).toEqual({
      text: "with media",
      media: { media_ids: ["media-1", "media-2"] },
    });
  });

  it("throws XApiAuthError on 401 so the caller can mark the token stale", async () => {
    mockFetch.mockResolvedValueOnce(
      response({}, { status: 401, text: '{"title":"Unauthorized"}' })
    );
    await expect(postTweet(creds, "hello")).rejects.toBeInstanceOf(XApiAuthError);
  });
});

describe("uploadMediaToX", () => {
  it("runs INIT → APPEND → FINALIZE and returns the media_id_string", async () => {
    // Small buffer (< 1MB CHUNK_SIZE) so we get exactly 1 APPEND call.
    const buf = Buffer.from(new Uint8Array(16));

    mockFetch
      .mockResolvedValueOnce(response({ media_id_string: "media-xyz" })) // INIT
      .mockResolvedValueOnce(response({})) // APPEND
      .mockResolvedValueOnce(response({ media_id: "media-xyz" })); // FINALIZE

    const mediaId = await uploadMediaToX(creds, buf, "image/png");
    expect(mediaId).toBe("media-xyz");
    expect(mockFetch).toHaveBeenCalledTimes(3);

    // INIT body locks the media_type + total_bytes contract.
    const initInit = mockFetch.mock.calls[0]![1] as { body?: string };
    const initBody = JSON.parse(initInit.body ?? "{}");
    expect(initBody).toEqual({ command: "INIT", total_bytes: 16, media_type: "image/png" });

    // FINALIZE body locks the command + media_id contract.
    const finalizeInit = mockFetch.mock.calls[2]![1] as { body?: string };
    const finalizeBody = JSON.parse(finalizeInit.body ?? "{}");
    expect(finalizeBody).toEqual({ command: "FINALIZE", media_id: "media-xyz" });
  });

  it("throws when INIT fails so we never attempt APPEND on a broken id", async () => {
    const buf = Buffer.from(new Uint8Array(16));
    // 400 is non-retryable, so fetchWithRetry returns the first response
    // directly and x-api surfaces the INIT-failed message immediately.
    mockFetch.mockResolvedValueOnce(response({}, { status: 400, text: "bad media_type" }));

    await expect(uploadMediaToX(creds, buf, "image/png")).rejects.toThrow(/INIT failed/);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe("fetchUserData", () => {
  it("pulls followers_count + following_count out of public_metrics", async () => {
    mockFetch.mockResolvedValueOnce(
      response({
        data: {
          public_metrics: {
            followers_count: 1234,
            following_count: 56,
            tweet_count: 999, // extra field — must be ignored
          },
        },
      })
    );

    const userData = await fetchUserData(creds);
    expect(userData).toEqual({ followersCount: 1234, followingCount: 56 });
  });
});

describe("fetchCurrentUser", () => {
  it("extracts id and username from /users/me", async () => {
    mockFetch.mockResolvedValueOnce(
      response({ data: { id: "11111", username: "newuser", extra_field: "ignored" } })
    );

    const user = await fetchCurrentUser(creds);
    expect(user).toEqual({ id: "11111", username: "newuser" });
  });
});

describe("fetchTweetMetrics", () => {
  it("returns the raw tweet with public + non_public + organic metrics intact", async () => {
    // Contract: our XTweetRawResponse has to match the field names X
    // actually sends. If any of these rename upstream, this test
    // fails before analytics rollups silently zero out.
    mockFetch.mockResolvedValueOnce(
      response({
        data: {
          id: "99",
          text: "metric-rich tweet",
          created_at: "2026-04-01T12:00:00.000Z",
          public_metrics: {
            like_count: 10,
            reply_count: 2,
            retweet_count: 1,
            bookmark_count: 3,
            quote_count: 4,
            impression_count: 100,
          },
          non_public_metrics: {
            impression_count: 120,
            engagements: 9,
            url_clicks: 5,
            user_profile_clicks: 7,
          },
          organic_metrics: {
            user_profile_clicks: 8,
          },
        },
      })
    );

    const raw = await fetchTweetMetrics(creds, "99");
    expect(raw).not.toBeNull();
    expect(raw!.id).toBe("99");
    expect(raw!.public_metrics.like_count).toBe(10);
    expect(raw!.public_metrics.impression_count).toBe(100);
    expect(raw!.non_public_metrics?.engagements).toBe(9);
    expect(raw!.non_public_metrics?.url_clicks).toBe(5);
    expect(raw!.organic_metrics?.user_profile_clicks).toBe(8);
  });

  it("returns null when X replies with no data (deleted tweet)", async () => {
    mockFetch.mockResolvedValueOnce(response({}));
    const raw = await fetchTweetMetrics(creds, "deleted-id");
    expect(raw).toBeNull();
  });
});
