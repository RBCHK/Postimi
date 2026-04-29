import { postToThreads, ThreadsScopeError } from "@/lib/threads-api";
import { PlatformDisconnectedError } from "@/lib/platform/errors";
import type { PlatformPublisher, PublishArgs, PublishResult } from "./types";

/**
 * Threads publisher — adapter over the existing `postToThreads` client.
 *
 * Threads is two-step (create media container, then publish). The
 * existing `postToThreads` handles both steps internally and waits
 * for the container to become ready. If step 1 succeeds but step 2
 * times out on the network, the container can be re-published from
 * `resumeContainerId` on retry — but `postToThreads` doesn't expose
 * the container id today, so retry-from-step-2 lives as a future
 * improvement (the schema's `platformContainerId` column is the home
 * for it). For now a retry repeats both steps.
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
      const { threadId, threadUrl } = await postToThreads(args.creds, args.content);
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
