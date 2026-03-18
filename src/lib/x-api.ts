/**
 * X (Twitter) API v2 client
 * - OAuth 1.0a: for tweets, users/me (app-level access)
 * - OAuth 2.0 User Token: for personalized_trends (user-context)
 * Single-user setup: credentials stored in .env.local
 */

import crypto from "crypto";
import { logXApiCall } from "@/lib/x-api-logger";

const BASE_URL = "https://api.twitter.com/2";

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

function generateOAuthSignature(
  method: string,
  url: string,
  params: Record<string, string>,
  oauthParams: Record<string, string>
): string {
  const allParams = { ...params, ...oauthParams };
  const paramString = Object.entries(allParams)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");

  const baseString = [
    method.toUpperCase(),
    encodeURIComponent(url),
    encodeURIComponent(paramString),
  ].join("&");

  const signingKey = [
    encodeURIComponent(process.env.X_CONSUMER_KEY_SECRET ?? ""),
    encodeURIComponent(process.env.X_ACCESS_TOKEN_SECRET ?? ""),
  ].join("&");

  return crypto.createHmac("sha1", signingKey).update(baseString).digest("base64");
}

function buildAuthHeader(method: string, url: string, params: Record<string, string>): string {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomBytes(16).toString("hex");

  const oauthParams: Record<string, string> = {
    oauth_consumer_key: process.env.X_CONSUMER_KEY ?? "",
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: timestamp,
    oauth_token: process.env.X_ACCESS_TOKEN ?? "",
    oauth_version: "1.0",
  };

  const signature = generateOAuthSignature(method, url, params, oauthParams);

  const headerParts = { ...oauthParams, oauth_signature: signature };
  const headerStr = Object.entries(headerParts)
    .map(([k, v]) => `${k}="${encodeURIComponent(v)}"`)
    .join(", ");

  return `OAuth ${headerStr}`;
}

async function xFetch<T>(endpoint: string, params: Record<string, string>): Promise<T> {
  const url = `${BASE_URL}${endpoint}`;
  const qs = new URLSearchParams(params).toString();
  const authHeader = buildAuthHeader("GET", url, params);

  const res = await fetch(`${url}?${qs}`, {
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`X API ${res.status} ${res.statusText}: ${body}`);
  }

  return res.json() as Promise<T>;
}

/** Options for tracking X API calls */
interface XApiLogOpts {
  callerJob?: string;
  userId?: string;
}

/** Fetch current user's ID and username */
export async function fetchCurrentUser(
  opts?: XApiLogOpts
): Promise<{ id: string; username: string }> {
  const data = await xFetch<{ data: { id: string; username: string } }>("/users/me", {
    "user.fields": "username",
  });
  logXApiCall({
    endpoint: "/users/me",
    resourceType: "USER_READ",
    resourceCount: 1,
    httpStatus: 200,
    ...opts,
  });
  return { id: data.data.id, username: data.data.username };
}

/** Fetch current user's ID (needed for /users/:id/tweets) */
export async function fetchCurrentUserId(opts?: XApiLogOpts): Promise<string> {
  const { id } = await fetchCurrentUser(opts);
  return id;
}

/** Fetch current user's followers/following count */
export async function fetchUserData(opts?: XApiLogOpts): Promise<XUserData> {
  const data = await xFetch<{
    data: { public_metrics: { followers_count: number; following_count: number } };
  }>("/users/me", { "user.fields": "public_metrics" });

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

// --- OAuth 2.0 User Token support ---

async function xFetchOAuth2<T>(endpoint: string, params: Record<string, string>): Promise<T> {
  const token = process.env.X_OAUTH2_ACCESS_TOKEN;
  if (!token) {
    throw new Error("X_OAUTH2_ACCESS_TOKEN is not set. Run the OAuth 2.0 PKCE flow first.");
  }

  const url = `${BASE_URL}${endpoint}`;
  const qs = new URLSearchParams(params).toString();

  const res = await fetch(`${url}?${qs}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`X API OAuth2 ${res.status} ${res.statusText}: ${body}`);
  }

  return res.json() as Promise<T>;
}

/** Fetch user's own tweets with public + non-public metrics */
export async function fetchUserTweets(
  userId: string,
  username: string,
  maxResults = 100,
  sinceId?: string,
  opts?: XApiLogOpts
): Promise<XTweetMetrics[]> {
  const params: Record<string, string> = {
    max_results: Math.min(maxResults, 100).toString(),
    "tweet.fields": "created_at,public_metrics,non_public_metrics,organic_metrics",
  };
  if (sinceId) params.since_id = sinceId;

  const data = await xFetch<{
    data?: Array<{
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
    }>;
  }>(`/users/${userId}/tweets`, params);

  if (!data.data?.length) return [];

  const tweets = data.data.map((tweet) => {
    const pub = tweet.public_metrics;
    const priv = tweet.non_public_metrics;

    const impressions = priv?.impression_count ?? pub.impression_count ?? 0;
    const urlClicks = priv?.url_clicks ?? 0;
    const engagements = priv?.engagements ?? 0;

    return {
      postId: tweet.id,
      createdAt: new Date(tweet.created_at),
      text: tweet.text,
      postLink: `https://x.com/${username}/status/${tweet.id}`,
      impressions,
      likes: pub.like_count,
      engagements,
      bookmarks: pub.bookmark_count,
      replies: pub.reply_count,
      reposts: pub.retweet_count,
      quoteCount: pub.quote_count ?? 0,
      urlClicks,
      profileVisits: tweet.organic_metrics?.user_profile_clicks,
    };
  });

  logXApiCall({
    endpoint: `/users/${userId}/tweets`,
    resourceType: "POST_READ",
    resourceCount: tweets.length,
    httpStatus: 200,
    ...opts,
  });

  return tweets;
}

/** Fetch user tweets with pagination support (>100 tweets) */
export async function fetchUserTweetsPaginated(
  userId: string,
  username: string,
  opts: { maxResults?: number; startTime?: string; sinceId?: string } = {},
  logOpts?: XApiLogOpts
): Promise<XTweetMetrics[]> {
  const allTweets: XTweetMetrics[] = [];
  let paginationToken: string | undefined;
  const perPage = Math.min(opts.maxResults ?? 100, 100);

  do {
    const params: Record<string, string> = {
      max_results: perPage.toString(),
      "tweet.fields": "created_at,public_metrics,non_public_metrics,organic_metrics",
    };
    if (opts.sinceId) params.since_id = opts.sinceId;
    if (opts.startTime) params.start_time = opts.startTime;
    if (paginationToken) params.pagination_token = paginationToken;

    const data = await xFetch<{
      data?: Array<{
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
      }>;
      meta?: { next_token?: string };
    }>(`/users/${userId}/tweets`, params);

    if (data.data?.length) {
      for (const tweet of data.data) {
        const pub = tweet.public_metrics;
        const priv = tweet.non_public_metrics;
        const impressions = priv?.impression_count ?? pub.impression_count ?? 0;
        const urlClicks = priv?.url_clicks ?? 0;
        const engagements = priv?.engagements ?? 0;

        allTweets.push({
          postId: tweet.id,
          createdAt: new Date(tweet.created_at),
          text: tweet.text,
          postLink: `https://x.com/${username}/status/${tweet.id}`,
          impressions,
          likes: pub.like_count,
          engagements,
          bookmarks: pub.bookmark_count,
          replies: pub.reply_count,
          reposts: pub.retweet_count,
          quoteCount: pub.quote_count ?? 0,
          urlClicks,
          profileVisits: tweet.organic_metrics?.user_profile_clicks,
        });
      }
    }

    paginationToken = data.meta?.next_token;

    // If maxResults specified, stop when we have enough
    if (opts.maxResults && allTweets.length >= opts.maxResults) {
      return allTweets.slice(0, opts.maxResults);
    }
  } while (paginationToken);

  if (allTweets.length > 0) {
    logXApiCall({
      endpoint: `/users/${userId}/tweets`,
      resourceType: "POST_READ",
      resourceCount: allTweets.length,
      httpStatus: 200,
      ...logOpts,
    });
  }

  return allTweets;
}

/** Fetch a single tweet's full text by ID (OAuth 1.0a) */
export async function fetchTweetById(tweetId: string, opts?: XApiLogOpts): Promise<string | null> {
  try {
    const data = await xFetch<{
      data?: { text: string; note_tweet?: { text: string } };
    }>(`/tweets/${tweetId}`, {
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
    // note_tweet.text contains the full text for long-form X Premium posts;
    // fall back to standard text for regular tweets
    return data.data.note_tweet?.text ?? data.data.text;
  } catch {
    return null;
  }
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

/** Fetch a single tweet's full metrics by ID (OAuth 1.0a) */
export async function fetchTweetMetrics(
  tweetId: string,
  opts?: XApiLogOpts
): Promise<XTweetRawResponse | null> {
  try {
    const data = await xFetch<{ data?: XTweetRawResponse }>(`/tweets/${tweetId}`, {
      "tweet.fields": "created_at,public_metrics,non_public_metrics,organic_metrics",
    });
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
  } catch (err) {
    throw err;
  }
}

/** Fetch personalized trends (requires OAuth 2.0 User Token) */
export async function fetchPersonalizedTrends(opts?: XApiLogOpts): Promise<
  {
    trendName: string;
    postCount: number;
    category?: string;
    trendingSince?: string;
  }[]
> {
  const data = await xFetchOAuth2<{
    data?: Array<{
      trend_name: string;
      post_count?: number;
      category?: string;
      trending_since?: string;
    }>;
  }>("/users/personalized_trends", {
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
