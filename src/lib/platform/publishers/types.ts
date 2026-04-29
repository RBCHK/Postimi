import type { CredentialsFor } from "@/lib/platform/types";
import type { MediaItem, Platform } from "@/lib/types";

/**
 * Result of a successful publish to a platform.
 * - `externalPostId` is the platform's identifier we store on
 *   ScheduledPublish.externalPostId for analytics + idempotency.
 * - `externalUrl` is the user-visible permalink for the published post.
 */
export interface PublishResult {
  externalPostId: string;
  externalUrl: string;
}

/**
 * Args passed to a publisher. Stateless: all credentials and content
 * arrive per-call so a single publisher singleton can serve multiple
 * users in parallel without leaking state across invocations.
 *
 * `media` is the unified per-platform media input — every publisher
 * receives the same shape (CDN URL + mimeType + alt) and handles its
 * own platform-specific upload (X chunked upload, LinkedIn asset URN,
 * Threads passthrough URL). Cron loads it once from
 * `getMediaForConversation(post.conversationId)` and forwards.
 */
export interface PublishArgs<P extends Platform> {
  creds: CredentialsFor<P>;
  content: string;
  media?: MediaItem[];
  /** For X-api-logger / Sentry tags. */
  callerJob: string;
  userId: string;
  /** For Threads two-step retry resilience. Carries over from a prior
   *  attempt so step-2 can resume if step-1 already succeeded. */
  resumeContainerId?: string;
}

export interface PlatformPublisher<P extends Platform = Platform> {
  readonly platform: P;
  publish(args: PublishArgs<P>): Promise<PublishResult>;
}
