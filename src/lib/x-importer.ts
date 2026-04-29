import { fetchUserTweetsPaginated, fetchUserData } from "@/lib/x-api";
import type {
  CredentialsFor,
  FollowersInput,
  ImporterOptions,
  PlatformImporter,
  SocialPostInput,
} from "@/lib/platform/types";

// 2026-04 refactor: X joins the registry-based importer pattern.
//
// Adapter between the raw X API client (`x-api.ts`) and the platform-
// agnostic `PlatformImporter` contract. The legacy `/api/cron/x-import`
// route is removed in this PR — `social-import` now handles X via
// `listImportablePlatforms()` like Threads.
//
// Two design choices that look surprising:
//
// 1. `since` becomes `startTime`, NOT `sinceId`. The legacy x-import
//    used `sinceId` (last-seen-tweet ID) for "default mode" and
//    `startTime` (last-7-days) for refresh mode. The unified social-
//    import passes `since` (a Date) — we map it to `startTime`. The
//    `sinceId` optimization is dropped because:
//      a) social-import already does a 1-day overlap on `since` for
//         metric refresh, which subsumes the new-only optimization.
//      b) `sinceId` would require a separate code path for the unified
//         loop — defeats the registry pattern.
//
// 2. `engagements` / `quoteCount` / `urlClicks` / `profileVisits` are
//    X-specific. We surface them through `SocialPostInput.metrics`
//    optional fields (added to the contract in this PR) so social-
//    import can write them to the X-specific `SocialPost` columns
//    without losing data. Other platforms leave them undefined.

function detectPostType(text: string): "POST" | "REPLY" {
  // X v2 doesn't return a structured "is_reply" flag on user tweets;
  // the original x-import used "@" prefix as the heuristic. Keep the
  // exact behavior to avoid reclassifying historical SocialPost rows
  // on first run after the refactor.
  return text.startsWith("@") ? "REPLY" : "POST";
}

export const xImporter: PlatformImporter<"X"> = {
  platform: "X",

  async *fetchPosts(
    creds: CredentialsFor<"X">,
    opts: ImporterOptions = {}
  ): AsyncIterable<SocialPostInput> {
    // Map ImporterOptions.since (Date) → x-api startTime (ISO string).
    const startTime = opts.since ? opts.since.toISOString() : undefined;

    const tweets = await fetchUserTweetsPaginated(creds, { startTime });

    for (const tweet of tweets) {
      const postType = detectPostType(tweet.text);
      yield {
        platform: "X",
        externalPostId: tweet.postId,
        text: tweet.text,
        postedAt: tweet.createdAt,
        postUrl: tweet.postLink,
        metadata: {
          platform: "X",
          postType,
        },
        metrics: {
          impressions: tweet.impressions,
          likes: tweet.likes,
          replies: tweet.replies,
          reposts: tweet.reposts,
          // X surfaces "shares" via tweet retweets only; we already
          // record retweets as `reposts`. Keep `shares` at 0 to avoid
          // double-counting cross-platform.
          shares: 0,
          bookmarks: tweet.bookmarks,
          engagements: tweet.engagements,
          quoteCount: tweet.quoteCount,
          urlClicks: tweet.urlClicks,
          profileVisits: tweet.profileVisits ?? 0,
        },
      };
    }
  },

  async fetchFollowers(creds: CredentialsFor<"X">): Promise<FollowersInput> {
    const data = await fetchUserData(creds);
    // X user data is point-in-time, not date-bucketed. The unified
    // contract requires a date — use UTC midnight (today) so the
    // `SocialFollowersSnapshot.[userId, platform, date]` upsert key
    // collapses any duplicate same-day reads.
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    return {
      platform: "X",
      date: today,
      followersCount: data.followersCount,
      followingCount: data.followingCount,
    };
  },
};
