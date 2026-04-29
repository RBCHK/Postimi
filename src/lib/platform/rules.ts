import type { Platform } from "@/lib/types";

// 2026-04 refactor: static per-platform publishing constraints. Single
// typed Record (not 3 files) so adding a constraint to the shape forces
// every platform to declare a value — TypeScript catches drift at
// compile time rather than at runtime in production.
//
// Lives in code (not DB) because:
//   - rules change ~yearly per platform; code review at change time is
//     valuable to catch breaking changes
//   - hot-deployable in 5 min, cheaper than a DB migration
//   - the cron AND the composer both need them — one source of truth

export interface PlatformMediaLimits {
  /** Max number of media items in a single post. */
  max: number;
  /** Cap when all items are photos (some platforms limit photos lower than total). */
  photo: number;
  /** Cap on videos in the same post. Most platforms allow 1 video at most. */
  video: number;
}

export interface PlatformFileSizeLimits {
  /** Max bytes for a single photo. */
  photo: number;
  /** Max bytes for a single video. */
  video: number;
}

export interface PlatformRules {
  /** Max characters in the post text. Validation rejects above this. */
  textLimit: number;
  mediaCount: PlatformMediaLimits;
  /** MIME types accepted by the platform's media-upload API. */
  supportedFormats: string[];
  maxFileSizeBytes: PlatformFileSizeLimits;
  /** Post types the publisher knows how to render to this platform. */
  postTypes: ReadonlyArray<"POST" | "REPLY" | "QUOTE" | "THREAD" | "ARTICLE" | "REPOST">;
  /** Reply support: full = arbitrary thread depth, limited = own posts only,
   *  none = platform doesn't expose reply API to us. */
  replySupport: "full" | "limited" | "none";
}

const MB = 1024 * 1024;

export const PLATFORM_RULES: Record<Platform, PlatformRules> = {
  X: {
    // X v2: 280 chars (or 25,000 for verified accounts via Premium —
    // we conservatively use the free tier limit).
    textLimit: 280,
    // X allows up to 4 photos OR 1 video OR 1 GIF per tweet — there's
    // no combination. The composer enforces "all photos" or "1 video".
    mediaCount: { max: 4, photo: 4, video: 1 },
    supportedFormats: ["image/jpeg", "image/png", "image/gif", "image/webp", "video/mp4"],
    // X v2 photo: 5 MB; video: 512 MB (and 2:20 max length).
    maxFileSizeBytes: { photo: 5 * MB, video: 512 * MB },
    postTypes: ["POST", "REPLY", "QUOTE", "THREAD"],
    replySupport: "full",
  },
  LINKEDIN: {
    // LinkedIn v2 long-form posts: 3,000 chars; this is the
    // characters limit on UGC posts (creator/profile both).
    textLimit: 3000,
    // LinkedIn allows up to 9 image attachments in a single post; one
    // video at most (and not in combination with photos).
    mediaCount: { max: 9, photo: 9, video: 1 },
    supportedFormats: ["image/jpeg", "image/png", "image/gif", "video/mp4"],
    // LinkedIn photo: 10 MB; video: 5 GB (10 min max).
    maxFileSizeBytes: { photo: 10 * MB, video: 5 * 1024 * MB },
    postTypes: ["POST", "ARTICLE", "REPOST"],
    // LinkedIn comment API exists but our publisher only handles
    // top-level posts — replying to others requires extra OAuth scope
    // we don't request.
    replySupport: "limited",
  },
  THREADS: {
    // Threads: 500 chars per post.
    textLimit: 500,
    // Threads carousels: up to 20 items (mix of photos and one video
    // permitted by the API but rare in practice).
    mediaCount: { max: 20, photo: 20, video: 1 },
    supportedFormats: ["image/jpeg", "image/png", "video/mp4"],
    // Threads photo: 8 MB; video: 1 GB (5 min).
    maxFileSizeBytes: { photo: 8 * MB, video: 1024 * MB },
    postTypes: ["POST", "REPLY"],
    replySupport: "full",
  },
};

export function getRules(platform: Platform): PlatformRules {
  return PLATFORM_RULES[platform];
}

/**
 * Cheap pre-flight validation for a post draft against a platform's
 * rules. Returns null on success, or a human-readable reason on
 * failure. Used by the composer (UX-time validation) and by auto-publish
 * (defense-in-depth — fails fast before hitting the platform API with
 * bad input).
 */
export function validatePostForPlatform(
  platform: Platform,
  args: { content: string; mediaCount?: number }
): string | null {
  const rules = PLATFORM_RULES[platform];
  if (args.content.length > rules.textLimit) {
    return `Content exceeds ${platform} limit (${rules.textLimit} chars; got ${args.content.length})`;
  }
  if (args.mediaCount !== undefined && args.mediaCount > rules.mediaCount.max) {
    return `Too many media items for ${platform} (max ${rules.mediaCount.max}; got ${args.mediaCount})`;
  }
  return null;
}
