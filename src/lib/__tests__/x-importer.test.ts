import { describe, it, expect, vi, beforeEach } from "vitest";

// Unit coverage for the X PlatformImporter adapter. The pre-refactor
// /api/cron/x-import route had its own test file (regression coverage
// for $transaction batching, classification, REFRESH_DAYS skip, wall-
// clock budget guard) — those concerns now live in social-import's test
// since the adapter doesn't own DB writes. Here we test only what the
// adapter is responsible for: shape mapping, since→startTime, async-
// generator behavior, fetchFollowers date semantics.

const fetchUserTweetsPaginatedMock = vi.hoisted(() => vi.fn());
const fetchUserDataMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/x-api", () => ({
  fetchUserTweetsPaginated: fetchUserTweetsPaginatedMock,
  fetchUserData: fetchUserDataMock,
}));

import { xImporter } from "../x-importer";
import type { CredentialsFor } from "@/lib/platform/types";

const CREDS: CredentialsFor<"X"> = {
  platform: "X",
  accessToken: "tok",
  xUserId: "x-user-1",
  xUsername: "alice",
};

function makeTweet(postId: string, overrides: Record<string, unknown> = {}) {
  return {
    postId,
    createdAt: new Date("2026-04-15T12:00:00Z"),
    text: "hello world",
    postLink: `https://x.com/alice/status/${postId}`,
    impressions: 100,
    likes: 10,
    engagements: 12,
    bookmarks: 1,
    replies: 0,
    reposts: 2,
    quoteCount: 0,
    urlClicks: 5,
    profileVisits: 3,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("xImporter.fetchPosts", () => {
  it("yields one SocialPostInput per tweet, in the order returned by the API", async () => {
    fetchUserTweetsPaginatedMock.mockResolvedValueOnce([
      makeTweet("t-1"),
      makeTweet("t-2"),
      makeTweet("t-3"),
    ]);

    const ids: string[] = [];
    for await (const post of xImporter.fetchPosts(CREDS, {})) {
      ids.push(post.externalPostId);
    }
    expect(ids).toEqual(["t-1", "t-2", "t-3"]);
  });

  it("maps tweet fields to the cross-platform metric shape", async () => {
    fetchUserTweetsPaginatedMock.mockResolvedValueOnce([makeTweet("m-1")]);

    const collected = [];
    for await (const post of xImporter.fetchPosts(CREDS, {})) {
      collected.push(post);
    }
    expect(collected).toHaveLength(1);
    const post = collected[0]!;
    expect(post.platform).toBe("X");
    expect(post.externalPostId).toBe("m-1");
    expect(post.text).toBe("hello world");
    expect(post.postUrl).toBe("https://x.com/alice/status/m-1");
    expect(post.metadata).toEqual({ platform: "X", postType: "POST" });
    expect(post.metrics).toMatchObject({
      impressions: 100,
      likes: 10,
      replies: 0,
      reposts: 2,
      shares: 0, // X has no separate "shares" — retweets already in `reposts`
      bookmarks: 1,
      engagements: 12,
      quoteCount: 0,
      urlClicks: 5,
      profileVisits: 3,
    });
  });

  it("classifies tweets starting with @ as REPLY in metadata", async () => {
    fetchUserTweetsPaginatedMock.mockResolvedValueOnce([
      makeTweet("p-1", { text: "@someone nice take" }),
      makeTweet("p-2", { text: "regular post" }),
    ]);

    const types: Record<string, string> = {};
    for await (const post of xImporter.fetchPosts(CREDS, {})) {
      if (post.metadata.platform === "X") {
        types[post.externalPostId] = post.metadata.postType;
      }
    }
    expect(types["p-1"]).toBe("REPLY");
    expect(types["p-2"]).toBe("POST");
  });

  it("converts ImporterOptions.since (Date) into x-api startTime (ISO string)", async () => {
    fetchUserTweetsPaginatedMock.mockResolvedValueOnce([]);
    const since = new Date("2026-04-08T03:30:00Z");

    for await (const _post of xImporter.fetchPosts(CREDS, { since })) {
      void _post;
      // empty iteration
    }

    expect(fetchUserTweetsPaginatedMock).toHaveBeenCalledTimes(1);
    const args = fetchUserTweetsPaginatedMock.mock.calls[0]!;
    expect(args[0]).toEqual(CREDS);
    expect(args[1]).toEqual({ startTime: "2026-04-08T03:30:00.000Z" });
  });

  it("omits startTime when since is undefined (initial / full import)", async () => {
    fetchUserTweetsPaginatedMock.mockResolvedValueOnce([]);

    for await (const _post of xImporter.fetchPosts(CREDS, {})) {
      void _post;
    }

    expect(fetchUserTweetsPaginatedMock).toHaveBeenCalledTimes(1);
    const args = fetchUserTweetsPaginatedMock.mock.calls[0]!;
    expect(args[1]).toEqual({ startTime: undefined });
  });

  it("normalises null profileVisits to 0 (legacy x-import behavior)", async () => {
    fetchUserTweetsPaginatedMock.mockResolvedValueOnce([
      makeTweet("p-1", { profileVisits: undefined }),
    ]);

    for await (const post of xImporter.fetchPosts(CREDS, {})) {
      expect(post.metrics.profileVisits).toBe(0);
    }
  });

  it("supports consumer breaking out early — does not call API again", async () => {
    fetchUserTweetsPaginatedMock.mockResolvedValueOnce([
      makeTweet("a"),
      makeTweet("b"),
      makeTweet("c"),
    ]);

    let count = 0;
    for await (const _post of xImporter.fetchPosts(CREDS, {})) {
      void _post;
      count++;
      if (count === 1) break;
    }
    expect(count).toBe(1);
    // Single API call regardless of consumer iteration shape.
    expect(fetchUserTweetsPaginatedMock).toHaveBeenCalledTimes(1);
  });
});

describe("xImporter.fetchFollowers", () => {
  it("returns followers + following counts under today's UTC midnight date", async () => {
    fetchUserDataMock.mockResolvedValueOnce({
      followersCount: 1234,
      followingCount: 567,
    });

    const result = await xImporter.fetchFollowers(CREDS);

    expect(result.platform).toBe("X");
    expect(result.followersCount).toBe(1234);
    expect(result.followingCount).toBe(567);
    // Date should be today's UTC midnight — the SocialFollowersSnapshot
    // unique key is (userId, platform, date), so any same-day re-import
    // collapses onto the same row.
    expect(result.date.getUTCHours()).toBe(0);
    expect(result.date.getUTCMinutes()).toBe(0);
    expect(result.date.getUTCSeconds()).toBe(0);
    expect(result.date.getUTCMilliseconds()).toBe(0);
  });
});
