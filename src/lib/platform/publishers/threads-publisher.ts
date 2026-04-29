import {
  postToThreads,
  postToThreadsWithImage,
  postToThreadsWithImages,
  ThreadsScopeError,
} from "@/lib/threads-api";
import { PlatformDisconnectedError } from "@/lib/platform/errors";
import type { PlatformPublisher, PublishArgs, PublishResult } from "./types";

/**
 * Threads publisher — adapter over the existing `postToThreads` family.
 *
 * Threads is two-step (create media container, then publish). The
 * existing helpers handle both steps internally and wait for the
 * container to become ready. If step 1 succeeds but step 2 times out
 * on the network, the container can be re-published from
 * `resumeContainerId` on retry — but the helpers don't expose
 * the container id today, so retry-from-step-2 lives as a future
 * improvement (the schema's `platformContainerId` column is the home
 * for it). For now a retry repeats both steps.
 *
 * Media: Threads accepts CDN URLs directly — no pre-upload step. We
 * route to single-image vs carousel based on count. Threads supports
 * 2–20 images in a carousel; a single image goes through the IMAGE
 * container path.
 *
 * Stateless: nothing is held on the publisher singleton.
 *
 * Auth failures: Threads' API returns scope-denied errors as a typed
 * `ThreadsScopeError` (already used by social-import); other 401s
 * surface as plain Error with message we pattern-match. Either way
 * we throw PlatformDisconnectedError so the cron stops retrying.
 */
export const threadsPublisher: PlatformPublisher<"THREADS"> = {
  platform: "THREADS",

  async publish(args: PublishArgs<"THREADS">): Promise<PublishResult> {
    try {
      const media = args.media ?? [];
      let threadId: string;
      let threadUrl: string;

      if (media.length === 0) {
        ({ threadId, threadUrl } = await postToThreads(args.creds, args.content));
      } else if (media.length === 1) {
        ({ threadId, threadUrl } = await postToThreadsWithImage(
          args.creds,
          args.content,
          media[0]!.url
        ));
      } else {
        ({ threadId, threadUrl } = await postToThreadsWithImages(
          args.creds,
          args.content,
          media.map((m) => m.url)
        ));
      }

      return { externalPostId: threadId, externalUrl: threadUrl };
    } catch (err) {
      if (err instanceof ThreadsScopeError) {
        throw new PlatformDisconnectedError(
          "THREADS",
          args.userId,
          `Threads scope denied: ${err.message}`
        );
      }
      const msg = err instanceof Error ? err.message : String(err);
      if (/401|invalid_token|expired_token|unauthor/i.test(msg)) {
        throw new PlatformDisconnectedError("THREADS", args.userId, `Threads auth failed: ${msg}`);
      }
      throw err;
    }
  },
};
