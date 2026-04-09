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
 * Post a thread with a single image to Threads.
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
    const res = await fetch(
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
    const itemRes = await fetch(`${BASE_URL}/${credentials.threadsUserId}/threads`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        media_type: "IMAGE",
        image_url: imageUrl,
        is_carousel_item: "true",
        access_token: credentials.accessToken,
      }),
    });

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

  const carouselRes = await fetch(`${BASE_URL}/${credentials.threadsUserId}/threads`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });

  if (!carouselRes.ok) {
    const body = await carouselRes.text();
    throw new Error(`Threads carousel creation failed ${carouselRes.status}: ${body}`);
  }

  const carousel = (await carouselRes.json()) as { id: string };

  // Step 4: Wait for carousel to finish, then publish
  await waitForContainerReady(credentials, carousel.id);

  const publishRes = await fetch(`${BASE_URL}/${credentials.threadsUserId}/threads_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      creation_id: carousel.id,
      access_token: credentials.accessToken,
    }),
  });

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
