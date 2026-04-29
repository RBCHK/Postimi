import {
  postToLinkedIn,
  postToLinkedInWithImage,
  postToLinkedInWithImages,
  uploadImageToLinkedIn,
} from "@/lib/linkedin-api";
import { PlatformDisconnectedError } from "@/lib/platform/errors";
import { fetchMediaBuffers } from "./media-fetch";
import type { PlatformPublisher, PublishArgs, PublishResult } from "./types";

/**
 * LinkedIn publisher — adapter over the existing `postToLinkedIn`
 * API client family. Stateless.
 *
 * Media: uploads each item via `uploadImageToLinkedIn` to obtain image
 * URNs, then routes to single-image or multi-image post based on count.
 *
 * Auth failures (LinkedIn returns 401 with INVALID_ACCESS_TOKEN) bubble
 * up as PlatformDisconnectedError so the cron can mark the publish
 * FAILED and surface a "reconnect required" message in the UI.
 *
 * URL composition: LinkedIn's REST API returns `postUrn` only — we
 * derive the permalink from the standard feed URL pattern. URN format
 * is `urn:li:share:<id>` for member posts; the permalink uses the
 * `<id>` portion only.
 */
function deriveLinkedInPermalink(postUrn: string): string {
  // postUrn format: "urn:li:share:7287123456789012345"
  // permalink: https://www.linkedin.com/feed/update/urn:li:share:7287.../
  // LinkedIn's URL accepts the full URN — no need to extract the id.
  return `https://www.linkedin.com/feed/update/${encodeURIComponent(postUrn)}/`;
}

export const linkedinPublisher: PlatformPublisher<"LINKEDIN"> = {
  platform: "LINKEDIN",

  async publish(args: PublishArgs<"LINKEDIN">): Promise<PublishResult> {
    try {
      let postUrn: string;
      const media = args.media ?? [];

      if (media.length === 0) {
        ({ postUrn } = await postToLinkedIn(args.creds, args.content));
      } else {
        const buffers = await fetchMediaBuffers(media, {
          userId: args.userId,
          callerJob: args.callerJob,
        });
        const imageUrns: string[] = [];
        for (const { item, buf } of buffers) {
          const urn = await uploadImageToLinkedIn(args.creds, buf, item.mimeType);
          imageUrns.push(urn);
        }
        if (imageUrns.length === 1) {
          ({ postUrn } = await postToLinkedInWithImage(args.creds, args.content, imageUrns[0]!));
        } else {
          ({ postUrn } = await postToLinkedInWithImages(args.creds, args.content, imageUrns));
        }
      }

      return {
        externalPostId: postUrn,
        externalUrl: deriveLinkedInPermalink(postUrn),
      };
    } catch (err) {
      // LinkedIn errors don't have a typed Auth class today; pattern-
      // match the message. Future improvement: add LinkedInAuthError
      // to linkedin-api.ts and check `instanceof` here.
      const msg = err instanceof Error ? err.message : String(err);
      if (/401|INVALID_ACCESS_TOKEN|unauthor/i.test(msg)) {
        throw new PlatformDisconnectedError(
          "LINKEDIN",
          args.userId,
          `LinkedIn auth failed: ${msg}`
        );
      }
      throw err;
    }
  },
};
