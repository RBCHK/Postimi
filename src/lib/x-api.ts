/**
 * X (Twitter) API v2 client
 * All functions require XApiCredentials (OAuth 2.0 per-user tokens from DB).
 */

import { logXApiCall } from "@/lib/x-api-logger";
import { fetchWithRetry } from "@/lib/fetch-with-retry";

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
export interface XApiLogOpts {
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

  const res = await fetchWithRetry(`${url}?${qs}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    cache: "no-store",
    retryContext: `x-api:GET ${endpoint}`,
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

async function xPost<T>(
  accessToken: string,
  endpoint: string,
  body: Record<string, unknown>
): Promise<T> {
  const res = await fetchWithRetry(`${BASE_URL}${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    retryContext: `x-api:POST ${endpoint}`,
  });

  if (!res.ok) {
    const text = await res.text();
    if (res.status === 401 || res.status === 403) {
      throw new XApiAuthError(res.status, `X API ${res.status}: ${text}`);
    }
    throw new Error(`X API ${res.status} ${res.statusText}: ${text}`);
  }

  return res.json() as Promise<T>;
}

// ─── Media upload ────────────────────────────────────────

const UPLOAD_BASE_URL = "https://api.x.com/2/media/upload";
const CHUNK_SIZE = 1024 * 1024; // 1MB per chunk

/**
 * Upload an image to X API using chunked upload (INIT → APPEND → FINALIZE).
 * Returns the media_id string to attach to a tweet.
 */
export async function uploadMediaToX(
  credentials: XApiCredentials,
  imageBuffer: Buffer,
  mimeType: string,
  opts?: XApiLogOpts
): Promise<string> {
  const { accessToken } = credentials;

  // INIT
  const initRes = await fetchWithRetry(UPLOAD_BASE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      command: "INIT",
      total_bytes: imageBuffer.length,
      media_type: mimeType,
    }),
    retryContext: "x-api:media/upload INIT",
  });
  if (!initRes.ok) {
    const body = await initRes.text();
    throw new Error(`X media INIT failed (${initRes.status}): ${body}`);
  }
  const initData = (await initRes.json()) as { media_id_string: string };
  const mediaId = initData.media_id_string;

  // APPEND (chunked)
  const totalChunks = Math.ceil(imageBuffer.length / CHUNK_SIZE);
  for (let i = 0; i < totalChunks; i++) {
    const chunk = imageBuffer.subarray(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
    const formData = new FormData();
    formData.append("command", "APPEND");
    formData.append("media_id", mediaId);
    formData.append("segment_index", i.toString());
    formData.append("media_data", new Blob([new Uint8Array(chunk)]));

    // APPEND uploads a 1MB binary chunk — give it a larger budget than
    // the 30s default to tolerate slow client connections.
    const appendRes = await fetchWithRetry(UPLOAD_BASE_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      body: formData,
      timeoutMs: 60_000,
      retryContext: "x-api:media/upload APPEND",
    });
    if (!appendRes.ok) {
      const body = await appendRes.text();
      throw new Error(
        `X media APPEND failed (${appendRes.status}, chunk ${i}/${totalChunks}): ${body}`
      );
    }
  }

  // FINALIZE
  const finalizeRes = await fetchWithRetry(UPLOAD_BASE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ command: "FINALIZE", media_id: mediaId }),
    retryContext: "x-api:media/upload FINALIZE",
  });
  if (!finalizeRes.ok) {
    const body = await finalizeRes.text();
    throw new Error(`X media FINALIZE failed (${finalizeRes.status}): ${body}`);
  }

  logXApiCall({
    endpoint: "/media/upload",
    resourceType: "MEDIA_WRITE",
    resourceCount: 1,
    httpStatus: 200,
    ...opts,
  });

  return mediaId;
}

// ─── Post a tweet ───────────────────────────────────────

export async function postTweet(
  credentials: XApiCredentials,
  text: string,
  opts?: XApiLogOpts & { mediaIds?: string[] }
): Promise<{ tweetId: string; tweetUrl: string }> {
  const body: Record<string, unknown> = { text };
  if (opts?.mediaIds?.length) {
    body.media = { media_ids: opts.mediaIds };
  }

  const result = await xPost<{ data: { id: string; text: string } }>(
    credentials.accessToken,
    "/tweets",
    body
  );

  logXApiCall({
    endpoint: "/tweets",
    resourceType: "POST_WRITE",
    resourceCount: 1,
    httpStatus: 201,
    callerJob: opts?.callerJob,
    userId: opts?.userId,
  });

  return {
    tweetId: result.data.id,
    tweetUrl: `https://x.com/${credentials.xUsername}/status/${result.data.id}`,
  };
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

/**
 * Safety cap on pagination loops. X returns a `meta.next_token` per
 * page; without a cap a misbehaving API (same token returned forever)
 * or a legitimate-but-huge account could loop indefinitely.
 */
const MAX_PAGES = 50;

/** Fetch user tweets with pagination support (>100 tweets) */
export async function fetchUserTweetsPaginated(
  credentials: XApiCredentials,
  opts: { maxResults?: number; startTime?: string; sinceId?: string; maxPages?: number } = {},
  logOpts?: XApiLogOpts
): Promise<XTweetMetrics[]> {
  const allTweets: XTweetMetrics[] = [];
  let paginationToken: string | undefined;
  const perPage = Math.min(opts.maxResults ?? 100, 100);
  const maxPages = opts.maxPages ?? MAX_PAGES;
  let pageCount = 0;

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

    pageCount++;

    if (data.data?.length) {
      for (const tweet of data.data) {
        allTweets.push(parseTweet(tweet, credentials.xUsername));
      }
    }

    const nextToken = data.meta?.next_token;

    // Stuck-cursor guard: API handed us the SAME token we just used.
    // This indicates a broken upstream — the next page would be identical.
    if (nextToken && nextToken === paginationToken) {
      const Sentry = await import("@sentry/nextjs");
      Sentry.captureMessage("x-api: stuck pagination cursor", {
        level: "warning",
        tags: { area: "x-api", endpoint: "users/tweets" },
        extra: { userId: credentials.xUserId, token: nextToken, pageCount },
      });
      break;
    }

    // Max-pages guard: explicit cap so we never loop forever.
    if (pageCount >= maxPages && nextToken) {
      const Sentry = await import("@sentry/nextjs");
      Sentry.captureMessage("x-api: max pagination pages reached", {
        level: "warning",
        tags: { area: "x-api", endpoint: "users/tweets" },
        extra: { userId: credentials.xUserId, maxPages, collected: allTweets.length },
      });
      break;
    }

    paginationToken = nextToken;

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

  // Visibility: log the page count so we notice crons approaching the cap in prod.
  console.log(
    `[x-api] fetchUserTweetsPaginated: user=${credentials.xUserId} pages=${pageCount} tweets=${allTweets.length}`
  );

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
