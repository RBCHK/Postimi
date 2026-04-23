/**
 * Threads (Meta Graph API) client
 * All functions require ThreadsApiCredentials (OAuth 2.0 per-user tokens from DB).
 */

import { fetchWithTimeout } from "@/lib/fetch-with-timeout";

const BASE_URL = "https://graph.threads.net/v1.0";

export interface ThreadsApiCredentials {
  accessToken: string;
  threadsUserId: string;
  threadsUsername: string;
}

// ─── Insights (ADR-008 Phase 2) ──────────────────────────

/**
 * Thrown when Threads returns a 401/403. Caller should delete the token
 * (user must reconnect) — we can't refresh past an auth-level error.
 */
export class ThreadsAuthError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = "ThreadsAuthError";
  }
}

/**
 * Thrown when a required scope (e.g. threads_manage_insights) is missing
 * from the token. Caller should remove the scope from grantedScopes and
 * flag the user in UI to reconnect.
 */
export class ThreadsScopeError extends Error {
  constructor(
    public readonly missingScope: string,
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "ThreadsScopeError";
  }
}

// Meta returns scope/permission denials with error code 10 ("Application
// does not have permission for this action"). Observed HTTP status varies
// — sometimes 403, sometimes 500 — so we rely on the body code rather
// than the status alone.
function isScopeDenial(body: string): boolean {
  try {
    const parsed = JSON.parse(body) as { error?: { code?: number; message?: string } };
    if (parsed?.error?.code === 10) return true;
    if (parsed?.error?.message?.toLowerCase().includes("scope")) return true;
  } catch {
    if (body.toLowerCase().includes("scope")) return true;
  }
  return false;
}

const THREADS_MEDIA_TYPES = [
  "TEXT_POST",
  "IMAGE",
  "VIDEO",
  "CAROUSEL_ALBUM",
  "AUDIO",
  "REPOST_FACADE",
] as const;
export type ThreadsMediaType = (typeof THREADS_MEDIA_TYPES)[number];

export interface ThreadsPost {
  id: string;
  text: string;
  mediaType: ThreadsMediaType;
  permalink: string | null;
  timestamp: Date;
  replyToId: string | null;
}

export interface ThreadPostInsights {
  views: number;
  likes: number;
  replies: number;
  reposts: number;
  quotes: number;
  shares: number;
}

export interface ThreadsAccountInsights {
  date: Date;
  views: number;
  followersCount: number;
}

const RETRY_DELAYS_MS = [1000, 4000, 15000];

async function threadsGet(url: string): Promise<Response> {
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    const res = await fetchWithTimeout(url);
    if (res.status !== 429) return res;
    if (attempt === RETRY_DELAYS_MS.length) return res;
    await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]!));
  }
  // Unreachable — the loop returns on non-429 or exhausts retries.
  throw new Error("threadsGet: retry logic bug");
}

function normalizeMediaType(raw: string | undefined): ThreadsMediaType {
  if (raw && THREADS_MEDIA_TYPES.includes(raw as ThreadsMediaType)) {
    return raw as ThreadsMediaType;
  }
  // Threads occasionally returns undocumented types for new surfaces.
  // Bucket them into TEXT_POST so we can import text at minimum.
  return "TEXT_POST";
}

/**
 * List the authenticated user's Threads posts since `opts.since`.
 * Uses pagination (up to `opts.limit`, default 200).
 */
export async function fetchThreadsPosts(
  creds: ThreadsApiCredentials,
  opts: { since?: Date; limit?: number } = {}
): Promise<ThreadsPost[]> {
  const limit = opts.limit ?? 200;
  const fields = "id,text,media_type,permalink,timestamp,reply_to";
  const posts: ThreadsPost[] = [];

  let url: string | null =
    `${BASE_URL}/${creds.threadsUserId}/threads?` +
    new URLSearchParams({
      fields,
      limit: String(Math.min(limit, 100)),
      access_token: creds.accessToken,
      ...(opts.since ? { since: String(Math.floor(opts.since.getTime() / 1000)) } : {}),
    }).toString();

  while (url && posts.length < limit) {
    const res: Response = await threadsGet(url);
    if (res.status === 401 || res.status === 403) {
      const body = await res.text();
      throw new ThreadsAuthError(`Threads auth failed ${res.status}: ${body}`, res.status);
    }
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Threads fetchPosts failed ${res.status}: ${body}`);
    }
    const page = (await res.json()) as {
      data?: Array<{
        id: string;
        text?: string;
        media_type?: string;
        permalink?: string;
        timestamp?: string;
        reply_to?: { id?: string };
      }>;
      paging?: { next?: string };
    };

    for (const row of page.data ?? []) {
      posts.push({
        id: row.id,
        text: row.text ?? "",
        mediaType: normalizeMediaType(row.media_type),
        permalink: row.permalink ?? null,
        timestamp: row.timestamp ? new Date(row.timestamp) : new Date(0),
        replyToId: row.reply_to?.id ?? null,
      });
      if (posts.length >= limit) break;
    }

    url = page.paging?.next ?? null;
  }

  return posts;
}

const POST_INSIGHT_METRICS = "views,likes,replies,reposts,quotes,shares";

/**
 * Per-post insights. Requires `threads_manage_insights` scope.
 * Throws `ThreadsScopeError` on scope denial — caller should strip the
 * scope from `grantedScopes` and stop attempting insight calls for this
 * user until they reconnect.
 */
export async function fetchThreadInsights(
  creds: ThreadsApiCredentials,
  threadId: string
): Promise<ThreadPostInsights> {
  const url =
    `${BASE_URL}/${threadId}/insights?` +
    new URLSearchParams({
      metric: POST_INSIGHT_METRICS,
      access_token: creds.accessToken,
    }).toString();

  const res = await threadsGet(url);
  if (res.status === 401 || res.status === 403) {
    const body = await res.text();
    if (isScopeDenial(body)) {
      throw new ThreadsScopeError("threads_manage_insights", res.status, body);
    }
    throw new ThreadsAuthError(`Threads auth failed ${res.status}: ${body}`, res.status);
  }
  if (!res.ok) {
    const body = await res.text();
    if (isScopeDenial(body)) {
      throw new ThreadsScopeError("threads_manage_insights", res.status, body);
    }
    throw new Error(`Threads fetchInsights failed ${res.status}: ${body}`);
  }

  const page = (await res.json()) as {
    data?: Array<{ name: string; values?: Array<{ value?: number }> }>;
  };
  const acc: ThreadPostInsights = {
    views: 0,
    likes: 0,
    replies: 0,
    reposts: 0,
    quotes: 0,
    shares: 0,
  };
  for (const row of page.data ?? []) {
    const value = row.values?.[0]?.value ?? 0;
    if (row.name in acc) {
      (acc as unknown as Record<string, number>)[row.name] = value;
    }
  }
  return acc;
}

const USER_INSIGHT_METRICS = "views,followers_count";

/**
 * Account-level daily insights. Returns one `ThreadsAccountInsights` per
 * day in the requested range. Used by the social-import cron to populate
 * `SocialFollowersSnapshot` and `SocialDailyStats` for Threads.
 */
export async function fetchThreadsUserInsights(
  creds: ThreadsApiCredentials,
  opts: { since: Date; until: Date }
): Promise<ThreadsAccountInsights[]> {
  const url =
    `${BASE_URL}/${creds.threadsUserId}/threads_insights?` +
    new URLSearchParams({
      metric: USER_INSIGHT_METRICS,
      since: String(Math.floor(opts.since.getTime() / 1000)),
      until: String(Math.floor(opts.until.getTime() / 1000)),
      access_token: creds.accessToken,
    }).toString();

  const res = await threadsGet(url);
  if (res.status === 401 || res.status === 403) {
    const body = await res.text();
    if (isScopeDenial(body)) {
      throw new ThreadsScopeError("threads_manage_insights", res.status, body);
    }
    throw new ThreadsAuthError(`Threads auth failed ${res.status}: ${body}`, res.status);
  }
  if (!res.ok) {
    const body = await res.text();
    if (isScopeDenial(body)) {
      throw new ThreadsScopeError("threads_manage_insights", res.status, body);
    }
    throw new Error(`Threads fetchUserInsights failed ${res.status}: ${body}`);
  }

  const page = (await res.json()) as {
    data?: Array<{
      name: string;
      values?: Array<{ value?: number; end_time?: string }>;
    }>;
  };

  // Threads returns one row per metric with a `values` array. Pivot into
  // one output row per day with each metric filled in.
  const byDay = new Map<string, ThreadsAccountInsights>();
  for (const row of page.data ?? []) {
    for (const v of row.values ?? []) {
      if (!v.end_time) continue;
      const date = new Date(v.end_time);
      date.setUTCHours(0, 0, 0, 0);
      const key = date.toISOString();
      const existing: ThreadsAccountInsights = byDay.get(key) ?? {
        date,
        views: 0,
        followersCount: 0,
      };
      if (row.name === "views") existing.views = v.value ?? 0;
      if (row.name === "followers_count") existing.followersCount = v.value ?? 0;
      byDay.set(key, existing);
    }
  }

  return Array.from(byDay.values()).sort((a, b) => a.date.getTime() - b.date.getTime());
}

/**
 * Post a text-only thread to Threads.
 * Two-step process: create container → publish.
 */
export async function postToThreads(
  credentials: ThreadsApiCredentials,
  text: string
): Promise<{ threadId: string; threadUrl: string }> {
  // Step 1: Create media container
  const containerRes = await fetchWithTimeout(
    `${BASE_URL}/${credentials.threadsUserId}/threads`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        media_type: "TEXT",
        text,
        access_token: credentials.accessToken,
      }),
    }
  );

  if (!containerRes.ok) {
    const body = await containerRes.text();
    throw new Error(`Threads container creation failed ${containerRes.status}: ${body}`);
  }

  const container = (await containerRes.json()) as { id: string };

  // Step 2: Publish the container
  const publishRes = await fetchWithTimeout(
    `${BASE_URL}/${credentials.threadsUserId}/threads_publish`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        creation_id: container.id,
        access_token: credentials.accessToken,
      }),
    }
  );

  if (!publishRes.ok) {
    const body = await publishRes.text();
    throw new Error(`Threads publish failed ${publishRes.status}: ${body}`);
  }

  const result = (await publishRes.json()) as { id: string };

  return {
    threadId: result.id,
    threadUrl: `https://www.threads.net/@${credentials.threadsUsername}/post/${result.id}`,
  };
}

/**
 * Post a thread with a single image to Threads.
 * Image must be at a publicly accessible URL.
 */
export async function postToThreadsWithImage(
  credentials: ThreadsApiCredentials,
  text: string,
  imageUrl: string
): Promise<{ threadId: string; threadUrl: string }> {
  // Step 1: Create image container
  const containerRes = await fetchWithTimeout(
    `${BASE_URL}/${credentials.threadsUserId}/threads`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        media_type: "IMAGE",
        image_url: imageUrl,
        text,
        access_token: credentials.accessToken,
      }),
    }
  );

  if (!containerRes.ok) {
    const body = await containerRes.text();
    throw new Error(`Threads image container creation failed ${containerRes.status}: ${body}`);
  }

  const container = (await containerRes.json()) as { id: string };

  // Step 2: Publish the container
  const publishRes = await fetchWithTimeout(
    `${BASE_URL}/${credentials.threadsUserId}/threads_publish`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        creation_id: container.id,
        access_token: credentials.accessToken,
      }),
    }
  );

  if (!publishRes.ok) {
    const body = await publishRes.text();
    throw new Error(`Threads image publish failed ${publishRes.status}: ${body}`);
  }

  const result = (await publishRes.json()) as { id: string };

  return {
    threadId: result.id,
    threadUrl: `https://www.threads.net/@${credentials.threadsUsername}/post/${result.id}`,
  };
}

/**
 * Wait for a Threads media container to reach FINISHED status.
 * Threads processes images asynchronously — we must poll until ready.
 */
async function waitForContainerReady(
  credentials: ThreadsApiCredentials,
  containerId: string,
  maxAttempts = 15
): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    const res = await fetchWithTimeout(
      `${BASE_URL}/${containerId}?fields=status,error_message&access_token=${credentials.accessToken}`
    );
    if (!res.ok) {
      throw new Error(`Threads status check failed ${res.status}: ${await res.text()}`);
    }
    const data = (await res.json()) as {
      status: string;
      error_message?: string;
    };

    if (data.status === "FINISHED") return;
    if (data.status === "ERROR") {
      throw new Error(`Threads media processing failed: ${data.error_message ?? "unknown error"}`);
    }

    // IN_PROGRESS — wait and retry
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("Threads media processing timed out");
}

/**
 * Post a thread with multiple images (carousel) to Threads.
 * Four-step process: create individual image containers → wait for processing →
 * create carousel container → publish.
 * Threads supports 2–20 images in a carousel.
 */
export async function postToThreadsWithImages(
  credentials: ThreadsApiCredentials,
  text: string,
  imageUrls: string[]
): Promise<{ threadId: string; threadUrl: string }> {
  // Step 1: Create individual image item containers
  const childIds: string[] = [];
  for (const imageUrl of imageUrls) {
    const itemRes = await fetchWithTimeout(
      `${BASE_URL}/${credentials.threadsUserId}/threads`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          media_type: "IMAGE",
          image_url: imageUrl,
          is_carousel_item: "true",
          access_token: credentials.accessToken,
        }),
      }
    );

    if (!itemRes.ok) {
      const body = await itemRes.text();
      throw new Error(`Threads carousel item creation failed ${itemRes.status}: ${body}`);
    }

    const item = (await itemRes.json()) as { id: string };
    childIds.push(item.id);
  }

  // Step 2: Wait for all items to finish processing
  for (const childId of childIds) {
    await waitForContainerReady(credentials, childId);
  }

  // Step 3: Create carousel container with children (comma-separated)
  const params = new URLSearchParams({
    media_type: "CAROUSEL",
    children: childIds.join(","),
    text,
    access_token: credentials.accessToken,
  });

  const carouselRes = await fetchWithTimeout(
    `${BASE_URL}/${credentials.threadsUserId}/threads`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    }
  );

  if (!carouselRes.ok) {
    const body = await carouselRes.text();
    throw new Error(`Threads carousel creation failed ${carouselRes.status}: ${body}`);
  }

  const carousel = (await carouselRes.json()) as { id: string };

  // Step 4: Wait for carousel to finish, then publish
  await waitForContainerReady(credentials, carousel.id);

  const publishRes = await fetchWithTimeout(
    `${BASE_URL}/${credentials.threadsUserId}/threads_publish`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        creation_id: carousel.id,
        access_token: credentials.accessToken,
      }),
    }
  );

  if (!publishRes.ok) {
    const body = await publishRes.text();
    throw new Error(`Threads carousel publish failed ${publishRes.status}: ${body}`);
  }

  const result = (await publishRes.json()) as { id: string };

  return {
    threadId: result.id,
    threadUrl: `https://www.threads.net/@${credentials.threadsUsername}/post/${result.id}`,
  };
}
