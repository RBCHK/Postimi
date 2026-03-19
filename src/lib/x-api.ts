/**
 * X (Twitter) API v2 client
 * All functions require XApiCredentials (OAuth 2.0 per-user tokens from DB).
 */

import { logXApiCall } from "@/lib/x-api-logger";

const BASE_URL = "https://api.twitter.com/2";

// ─── Types ──────────────────────────────────────────────

export interface XApiCredentials {
  accessToken: string;
  xUserId: string;
  xUsername: string;
}

export class XApiAuthError extends Error {
  constructor(
    public statusCode: number,
    message: string
  ) {
    super(message);
    this.name = "XApiAuthError";
  }
}

export class XApiNoTokenError extends Error {
  constructor(userId?: string) {
    super(userId ? `No X API token for user ${userId}` : "No X API token available");
    this.name = "XApiNoTokenError";
  }
}

export interface XTweetMetrics {
  postId: string;
  createdAt: Date;
  text: string;
  postLink: string;
  impressions: number;
  likes: number;
  engagements: number;
  bookmarks: number;
  replies: number;
  reposts: number;
  quoteCount: number;
  urlClicks: number;
  profileVisits: number | undefined;
}

export interface XUserData {
  followersCount: number;
  followingCount: number;
}

export interface XTweetRawResponse {
  id: string;
  text: string;
  created_at: string;
  public_metrics: {
    like_count: number;
    reply_count: number;
    retweet_count: number;
    bookmark_count: number;
    quote_count?: number;
    impression_count?: number;
  };
  non_public_metrics?: {
    impression_count: number;
    engagements?: number;
    url_clicks?: number;
    user_profile_clicks?: number;
  };
  organic_metrics?: {
    user_profile_clicks: number;
  };
}

/** Options for tracking X API calls */
interface XApiLogOpts {
  callerJob?: string;
  userId?: string;
}

// ─── Internal fetch ─────────────────────────────────────

async function xFetch<T>(
  accessToken: string,
  endpoint: string,
  params: Record<string, string>
): Promise<T> {
  const url = `${BASE_URL}${endpoint}`;
  const qs = new URLSearchParams(params).toString();

  const res = await fetch(`${url}?${qs}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text();
    if (res.status === 401 || res.status === 403) {
      throw new XApiAuthError(res.status, `X API ${res.status}: ${body}`);
    }
    throw new Error(`X API ${res.status} ${res.statusText}: ${body}`);
  }

  return res.json() as Promise<T>;
}

// ─── Tweet parsing helper ───────────────────────────────

interface RawTweet {
  id: string;
  text: string;
  created_at: string;
  public_metrics: {
    like_count: number;
    reply_count: number;
    retweet_count: number;
    bookmark_count: number;
    quote_count?: number;
    impression_count?: number;
  };
  non_public_metrics?: {
    impression_count: number;
    engagements?: number;
    url_clicks?: number;
    user_profile_clicks?: number;
  };
  organic_metrics?: {
    user_profile_clicks: number;
  };
}

function parseTweet(tweet: RawTweet, username: string): XTweetMetrics {
  const pub = tweet.public_metrics;
  const priv = tweet.non_public_metrics;

  return {
    postId: tweet.id,
    createdAt: new Date(tweet.created_at),
    text: tweet.text,
    postLink: `https://x.com/${username}/status/${tweet.id}`,
    impressions: priv?.impression_count ?? pub.impression_count ?? 0,
    likes: pub.like_count,
    engagements: priv?.engagements ?? 0,
    bookmarks: pub.bookmark_count,
    replies: pub.reply_count,
    reposts: pub.retweet_count,
    quoteCount: pub.quote_count ?? 0,
    urlClicks: priv?.url_clicks ?? 0,
    profileVisits: tweet.organic_metrics?.user_profile_clicks,
  };
}

// ─── Exported API functions ─────────────────────────────

const TWEET_FIELDS = "created_at,public_metrics,non_public_metrics,organic_metrics";

/** Fetch current user's ID and username */
export async function fetchCurrentUser(
  credentials: XApiCredentials,
  opts?: XApiLogOpts
): Promise<{ id: string; username: string }> {
  const data = await xFetch<{ data: { id: string; username: string } }>(
    credentials.accessToken,
    "/users/me",
    { "user.fields": "username" }
  );
  logXApiCall({
    endpoint: "/users/me",
    resourceType: "USER_READ",
    resourceCount: 1,
    httpStatus: 200,
    ...opts,
  });
  return { id: data.data.id, username: data.data.username };
}

/** Fetch current user's followers/following count */
export async function fetchUserData(
  credentials: XApiCredentials,
  opts?: XApiLogOpts
): Promise<XUserData> {
  const data = await xFetch<{
    data: { public_metrics: { followers_count: number; following_count: number } };
  }>(credentials.accessToken, "/users/me", { "user.fields": "public_metrics" });

  logXApiCall({
    endpoint: "/users/me",
    resourceType: "USER_READ",
    resourceCount: 1,
    httpStatus: 200,
    ...opts,
  });

  return {
    followersCount: data.data.public_metrics.followers_count,
    followingCount: data.data.public_metrics.following_count,
  };
}

/** Fetch user's own tweets with public + non-public metrics */
export async function fetchUserTweets(
  credentials: XApiCredentials,
  maxResults = 100,
  sinceId?: string,
  opts?: XApiLogOpts
): Promise<XTweetMetrics[]> {
  const params: Record<string, string> = {
    max_results: Math.min(maxResults, 100).toString(),
    "tweet.fields": TWEET_FIELDS,
  };
  if (sinceId) params.since_id = sinceId;

  const data = await xFetch<{ data?: RawTweet[] }>(
    credentials.accessToken,
    `/users/${credentials.xUserId}/tweets`,
    params
  );

  if (!data.data?.length) return [];

  const tweets = data.data.map((t) => parseTweet(t, credentials.xUsername));

  logXApiCall({
    endpoint: `/users/${credentials.xUserId}/tweets`,
    resourceType: "POST_READ",
    resourceCount: tweets.length,
    httpStatus: 200,
    ...opts,
  });

  return tweets;
}

/** Fetch user tweets with pagination support (>100 tweets) */
export async function fetchUserTweetsPaginated(
  credentials: XApiCredentials,
  opts: { maxResults?: number; startTime?: string; sinceId?: string } = {},
  logOpts?: XApiLogOpts
): Promise<XTweetMetrics[]> {
  const allTweets: XTweetMetrics[] = [];
  let paginationToken: string | undefined;
  const perPage = Math.min(opts.maxResults ?? 100, 100);

  do {
    const params: Record<string, string> = {
      max_results: perPage.toString(),
      "tweet.fields": TWEET_FIELDS,
    };
    if (opts.sinceId) params.since_id = opts.sinceId;
    if (opts.startTime) params.start_time = opts.startTime;
    if (paginationToken) params.pagination_token = paginationToken;

    const data = await xFetch<{ data?: RawTweet[]; meta?: { next_token?: string } }>(
      credentials.accessToken,
      `/users/${credentials.xUserId}/tweets`,
      params
    );

    if (data.data?.length) {
      for (const tweet of data.data) {
        allTweets.push(parseTweet(tweet, credentials.xUsername));
      }
    }

    paginationToken = data.meta?.next_token;

    if (opts.maxResults && allTweets.length >= opts.maxResults) {
      return allTweets.slice(0, opts.maxResults);
    }
  } while (paginationToken);

  if (allTweets.length > 0) {
    logXApiCall({
      endpoint: `/users/${credentials.xUserId}/tweets`,
      resourceType: "POST_READ",
      resourceCount: allTweets.length,
      httpStatus: 200,
      ...logOpts,
    });
  }

  return allTweets;
}

/** Fetch a single tweet's full text by ID */
export async function fetchTweetById(
  credentials: XApiCredentials,
  tweetId: string,
  opts?: XApiLogOpts
): Promise<string | null> {
  try {
    const data = await xFetch<{
      data?: { text: string; note_tweet?: { text: string } };
    }>(credentials.accessToken, `/tweets/${tweetId}`, {
      "tweet.fields": "text,note_tweet",
    });
    if (!data.data) return null;
    logXApiCall({
      endpoint: `/tweets/${tweetId}`,
      resourceType: "POST_READ",
      resourceCount: 1,
      httpStatus: 200,
      ...opts,
    });
    return data.data.note_tweet?.text ?? data.data.text;
  } catch {
    return null;
  }
}

/** Fetch a single tweet's full metrics by ID */
export async function fetchTweetMetrics(
  credentials: XApiCredentials,
  tweetId: string,
  opts?: XApiLogOpts
): Promise<XTweetRawResponse | null> {
  const data = await xFetch<{ data?: XTweetRawResponse }>(
    credentials.accessToken,
    `/tweets/${tweetId}`,
    { "tweet.fields": TWEET_FIELDS }
  );
  if (data.data) {
    logXApiCall({
      endpoint: `/tweets/${tweetId}`,
      resourceType: "POST_READ",
      resourceCount: 1,
      httpStatus: 200,
      ...opts,
    });
  }
  return data.data ?? null;
}

/** Fetch personalized trends */
export async function fetchPersonalizedTrends(
  credentials: XApiCredentials,
  opts?: XApiLogOpts
): Promise<
  {
    trendName: string;
    postCount: number;
    category?: string;
    trendingSince?: string;
  }[]
> {
  const data = await xFetch<{
    data?: Array<{
      trend_name: string;
      post_count?: number;
      category?: string;
      trending_since?: string;
    }>;
  }>(credentials.accessToken, "/users/personalized_trends", {
    "personalized_trend.fields": "category,post_count,trend_name,trending_since",
  });

  if (!data.data?.length) return [];

  const trends = data.data.map((t) => ({
    trendName: t.trend_name,
    postCount: t.post_count ?? 0,
    category: t.category,
    trendingSince: t.trending_since,
  }));

  logXApiCall({
    endpoint: "/users/personalized_trends",
    resourceType: "TREND_READ",
    resourceCount: trends.length,
    httpStatus: 200,
    ...opts,
  });

  return trends;
}
