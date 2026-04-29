import { postTweet, uploadMediaToX, XApiAuthError } from "@/lib/x-api";
import { PlatformDisconnectedError } from "@/lib/platform/errors";
import { fetchMediaBuffers } from "./media-fetch";
import type { PlatformPublisher, PublishArgs, PublishResult } from "./types";

/**
 * X publisher — adapter over the existing `postTweet` API client.
 * Stateless: a single instance serves every user concurrently because
 * all per-user state (creds, media) flows through the args object.
 *
 * Token refresh is the caller's responsibility — `x-token` helpers
 * already auto-refresh on read; the cron loads fresh creds before each
 * publish call.
 *
 * Media: chunked-uploads each item via `uploadMediaToX` to obtain X
 * media ids, then attaches to the tweet. X requires position-stable
 * order, so uploads run sequentially. Auth failures from the upload or
 * the post call translate to PlatformDisconnectedError so the cron can
 * mark the publish FAILED with a "reconnect required" reason and stop
 * retrying.
 */
export const xPublisher: PlatformPublisher<"X"> = {
  platform: "X",

  async publish(args: PublishArgs<"X">): Promise<PublishResult> {
    try {
      let mediaIds: string[] | undefined;
      if (args.media && args.media.length > 0) {
        const buffers = await fetchMediaBuffers(args.media, {
          userId: args.userId,
          callerJob: args.callerJob,
        });
        mediaIds = [];
        for (const { item, buf } of buffers) {
          const xMediaId = await uploadMediaToX(args.creds, buf, item.mimeType, {
            callerJob: args.callerJob,
            userId: args.userId,
          });
          mediaIds.push(xMediaId);
        }
      }

      const { tweetId, tweetUrl } = await postTweet(args.creds, args.content, {
        callerJob: args.callerJob,
        userId: args.userId,
        mediaIds,
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
