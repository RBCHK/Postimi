import { postTweet } from "@/lib/x-api";
import { XApiAuthError } from "@/lib/x-api";
import { PlatformDisconnectedError } from "@/lib/platform/errors";
import type { PlatformPublisher, PublishArgs, PublishResult } from "./types";

/**
 * X publisher — adapter over the existing `postTweet` API client.
 * Stateless: a single instance serves every user concurrently because
 * all per-user state (creds, mediaIds) flows through the args object.
 *
 * Token refresh is the caller's responsibility — `x-token` helpers
 * already auto-refresh on read; the cron loads fresh creds before each
 * publish call.
 *
 * Auth failures from `postTweet` (HTTP 401 → XApiAuthError) translate
 * to PlatformDisconnectedError so the cron can mark the publish FAILED
 * with a "reconnect required" reason and stop retrying.
 */
export const xPublisher: PlatformPublisher<"X"> = {
  platform: "X",

  async publish(args: PublishArgs<"X">): Promise<PublishResult> {
    try {
      const { tweetId, tweetUrl } = await postTweet(args.creds, args.content, {
        callerJob: args.callerJob,
        userId: args.userId,
        mediaIds: args.mediaIds,
      });
      return { externalPostId: tweetId, externalUrl: tweetUrl };
    } catch (err) {
      if (err instanceof XApiAuthError) {
        throw new PlatformDisconnectedError(
          "X",
          args.userId,
          `X auth failed (${err.statusCode}): ${err.message}`
        );
      }
      throw err;
    }
  },
};
