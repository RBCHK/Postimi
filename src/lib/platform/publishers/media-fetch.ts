import * as Sentry from "@sentry/nextjs";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import type { MediaItem } from "@/lib/types";

const MEDIA_FETCH_TIMEOUT_MS = 15_000;

/**
 * Fetch every media item's binary in parallel with a per-item timeout.
 *
 * Returns buffers in the same order as `items` so callers that need a
 * position-sensitive upload (X tweet media array, LinkedIn carousel)
 * can rely on the index correspondence.
 *
 * Throws if ANY item fails — partial uploads would publish a misleading
 * post (missing photos rendered as text-only). Each rejected promise's
 * underlying error is reported to Sentry first so ops sees aggregate
 * trends even though only the first reason surfaces in the thrown
 * message.
 */
export async function fetchMediaBuffers(
  items: MediaItem[],
  context: { userId: string; callerJob: string }
): Promise<Array<{ item: MediaItem; buf: Buffer }>> {
  const settled = await Promise.allSettled(
    items.map(async (item) => {
      const res = await fetchWithTimeout(item.url, { timeoutMs: MEDIA_FETCH_TIMEOUT_MS });
      if (!res.ok) {
        throw new Error(`Media fetch failed (${res.status} ${res.statusText}) for ${item.url}`);
      }
      const buf = Buffer.from(await res.arrayBuffer());
      return { item, buf };
    })
  );

  const failures = settled
    .map((r, i) => ({ r, item: items[i]! }))
    .filter((x) => x.r.status === "rejected");

  if (failures.length > 0) {
    for (const f of failures) {
      Sentry.captureException((f.r as PromiseRejectedResult).reason, {
        tags: {
          area: "publisher-media",
          mediaId: f.item.id,
          userId: context.userId,
          callerJob: context.callerJob,
        },
        extra: { url: f.item.url },
      });
    }
    throw new Error(`Media fetch failed for ${failures.length}/${items.length} item(s)`);
  }

  return settled.map((r) => (r as PromiseFulfilledResult<{ item: MediaItem; buf: Buffer }>).value);
}
