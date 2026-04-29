import type { Platform } from "@/lib/types";

/**
 * Thrown by a publisher when the user's OAuth credentials for a
 * platform are no longer valid (token expired beyond refresh, scope
 * revoked in the platform's settings, etc.). The cron catches this
 * and marks the ScheduledPublish as FAILED with a clear "reconnect
 * required" message — automatic retries don't help when the user
 * needs to re-OAuth.
 */
export class PlatformDisconnectedError extends Error {
  constructor(
    public platform: Platform,
    public userId: string,
    message?: string
  ) {
    super(message ?? `Platform ${platform} disconnected for user ${userId}`);
    this.name = "PlatformDisconnectedError";
  }
}

/**
 * Thrown by a publisher when the post payload violates a static
 * platform rule (text too long, too many media items, etc.). These
 * are deterministic — no point retrying. Cron marks FAILED with the
 * specific reason so the user can fix the post.
 */
export class PlatformValidationError extends Error {
  constructor(
    public platform: Platform,
    public reason: string
  ) {
    super(`Platform ${platform} validation failed: ${reason}`);
    this.name = "PlatformValidationError";
  }
}
