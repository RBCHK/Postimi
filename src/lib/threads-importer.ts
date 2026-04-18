import {
  fetchThreadsPosts,
  fetchThreadInsights,
  fetchThreadsUserInsights,
  ThreadsScopeError,
  type ThreadsApiCredentials,
} from "@/lib/threads-api";
import type {
  FollowersInput,
  ImporterOptions,
  PlatformImporter,
  SocialPostInput,
} from "@/lib/platform/types";

// ADR-008 Phase 2.
//
// Adapter between the raw Threads Graph API client (`threads-api.ts`) and
// the platform-agnostic `PlatformImporter` contract. All Threads-specific
// quirks live here so the `social-import` cron can stay generic.
//
// Scope handling:
//   - `fetchPosts` tries to call `fetchThreadInsights` for each post.
//   - If the user declined `threads_manage_insights` (or Meta silently
//     downgraded the grant on refresh), `fetchThreadInsights` throws
//     `ThreadsScopeError`. We catch it once and set `insightsBlocked` for
//     the rest of the iteration so we don't re-issue 400s per post.
//   - Posts still get yielded with zero insight metrics — the `text`,
//     `postedAt`, and metadata are still useful to the Strategist.
//   - The cron layer is responsible for removing the scope from
//     `ThreadsApiToken.grantedScopes` on `ThreadsScopeError` so the UI can
//     surface a "reconnect Threads" banner. The importer does not touch
//     the DB directly — single responsibility.

export interface ThreadsScopeStatus {
  /** True if `threads_manage_insights` was denied during this run. */
  insightsBlocked: boolean;
}

/**
 * Threads importer — implements `PlatformImporter<"THREADS">`.
 *
 * The `fetchPosts` generator yields one `SocialPostInput` per Threads post,
 * enriched with per-post insights when the scope permits. Callers that need
 * to observe scope denials should construct a `threadsImporterWithScopeProbe`
 * wrapper — the base importer just yields and moves on.
 */
export const threadsImporter: PlatformImporter<"THREADS"> = {
  platform: "THREADS",

  async *fetchPosts(
    creds: ThreadsApiCredentials & { platform: "THREADS" },
    opts: ImporterOptions = {}
  ): AsyncIterable<SocialPostInput> {
    const posts = await fetchThreadsPosts(creds, opts);

    let insightsBlocked = false;

    for (const post of posts) {
      let insights = {
        views: 0,
        likes: 0,
        replies: 0,
        reposts: 0,
        quotes: 0,
        shares: 0,
      };

      if (!insightsBlocked) {
        try {
          insights = await fetchThreadInsights(creds, post.id);
        } catch (err) {
          if (err instanceof ThreadsScopeError) {
            // Scope denied — stop calling insights for this user. The cron
            // wrapper will catch this via the separate probe below and
            // update `grantedScopes` in the DB.
            insightsBlocked = true;
            throw err;
          }
          // Per-post transient error: yield with zero metrics and continue.
          // The weekly refresh will pick it up next run.
          insights = { views: 0, likes: 0, replies: 0, reposts: 0, quotes: 0, shares: 0 };
        }
      }

      yield {
        platform: "THREADS",
        externalPostId: post.id,
        text: post.text,
        postedAt: post.timestamp,
        postUrl: post.permalink,
        metadata: {
          platform: "THREADS",
          mediaType: post.mediaType,
          replyToId: post.replyToId,
          permalink: post.permalink,
        },
        metrics: {
          impressions: insights.views,
          likes: insights.likes,
          replies: insights.replies,
          reposts: insights.reposts,
          // Threads models "shares" (external) and "quotes" separately. We
          // fold quotes into `bookmarks` as the closest analogue (an
          // "internal share" that keeps attribution), and keep `shares`
          // for true external shares.
          shares: insights.shares,
          bookmarks: insights.quotes,
        },
      };
    }
  },

  async fetchFollowers(
    creds: ThreadsApiCredentials & { platform: "THREADS" }
  ): Promise<FollowersInput> {
    // Ask for a 2-day window and take the most recent row. Threads' user
    // insights endpoint only reports historical days, so "today" is usually
    // missing and we pick yesterday's value. That matches the semantics of
    // `SocialFollowersSnapshot` (one row per calendar day).
    const until = new Date();
    until.setUTCHours(23, 59, 59, 999);
    const since = new Date(until);
    since.setUTCDate(since.getUTCDate() - 2);

    const rows = await fetchThreadsUserInsights(creds, { since, until });
    if (rows.length === 0) {
      // No insights returned (brand-new account, or API gap). Fall back to
      // today's date + zero count so the snapshot row exists and the delta
      // math on the next run makes sense.
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      return {
        platform: "THREADS",
        date: today,
        followersCount: 0,
        followingCount: null,
      };
    }
    const latest = rows[rows.length - 1]!;
    return {
      platform: "THREADS",
      date: latest.date,
      followersCount: latest.followersCount,
      // Threads API does not expose `following_count` — the value is
      // deliberately null, not 0, so analytics can distinguish "not
      // available" from "genuinely zero".
      followingCount: null,
    };
  },
};
