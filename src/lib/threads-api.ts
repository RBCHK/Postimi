/**
 * Threads (Meta Graph API) client
 * All functions require ThreadsApiCredentials (OAuth 2.0 per-user tokens from DB).
 */

const BASE_URL = "https://graph.threads.net/v1.0";

export interface ThreadsApiCredentials {
  accessToken: string;
  threadsUserId: string;
  threadsUsername: string;
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
  const containerRes = await fetch(`${BASE_URL}/${credentials.threadsUserId}/threads`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      media_type: "TEXT",
      text,
      access_token: credentials.accessToken,
    }),
  });

  if (!containerRes.ok) {
    const body = await containerRes.text();
    throw new Error(`Threads container creation failed ${containerRes.status}: ${body}`);
  }

  const container = (await containerRes.json()) as { id: string };

  // Step 2: Publish the container
  const publishRes = await fetch(`${BASE_URL}/${credentials.threadsUserId}/threads_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      creation_id: container.id,
      access_token: credentials.accessToken,
    }),
  });

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
 * Post a thread with an image to Threads.
 * Image must be at a publicly accessible URL.
 */
export async function postToThreadsWithImage(
  credentials: ThreadsApiCredentials,
  text: string,
  imageUrl: string
): Promise<{ threadId: string; threadUrl: string }> {
  // Step 1: Create image container
  const containerRes = await fetch(`${BASE_URL}/${credentials.threadsUserId}/threads`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      media_type: "IMAGE",
      image_url: imageUrl,
      text,
      access_token: credentials.accessToken,
    }),
  });

  if (!containerRes.ok) {
    const body = await containerRes.text();
    throw new Error(`Threads image container creation failed ${containerRes.status}: ${body}`);
  }

  const container = (await containerRes.json()) as { id: string };

  // Step 2: Publish the container
  const publishRes = await fetch(`${BASE_URL}/${credentials.threadsUserId}/threads_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      creation_id: container.id,
      access_token: credentials.accessToken,
    }),
  });

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
