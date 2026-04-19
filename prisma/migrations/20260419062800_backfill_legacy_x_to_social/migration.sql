-- Backfill legacy XPost and FollowersSnapshot rows that predate the
-- Phase 1a dual-write (migration 20260418024038_phase1a_multi_platform_models).
-- Rows written since Phase 1a already have a SocialPost / SocialFollowersSnapshot
-- mirror; the parity script (prisma/scripts/parity-x-social.ts) confirmed a
-- strict subset of legacy rows is missing. This migration copies them with
-- the same platform="X" mapping the dual-write uses, so Phase 1b cutover can
-- proceed against 100% parity. The DailyAccountStats → SocialDailyStats pair
-- is already at parity and is not backfilled.
--
-- Idempotent: `LEFT JOIN ... WHERE mirror IS NULL` skips rows that already
-- exist. Re-running this migration (e.g. after a rebase) is a no-op.
--
-- `id` is generated via `gen_random_uuid()` (pgcrypto, enabled in Supabase by
-- default) with a `bf_` prefix so backfilled rows are distinguishable from
-- cuid-generated rows in logs. Prisma does not care about id format — only
-- uniqueness, which UUID guarantees.

-- ─── SocialPost backfill ──────────────────────────────
INSERT INTO "SocialPost" (
  "id", "userId", "platform", "externalPostId", "postedAt",
  "text", "postUrl", "postType",
  "impressions", "likes", "engagements", "bookmarks",
  "replies", "reposts", "quoteCount",
  "urlClicks", "profileVisits",
  "newFollowers", "detailExpands",
  "platformMetadata", "dataSource",
  "createdAt", "updatedAt"
)
SELECT
  'bf_' || gen_random_uuid()::text,
  x."userId",
  'X'::"Platform",
  x."postId",
  x."date",
  x."text",
  x."postLink",
  x."postType"::text,
  x."impressions", x."likes", x."engagements", x."bookmarks",
  x."replies", x."reposts", x."quoteCount",
  x."urlClicks", x."profileVisits",
  x."newFollowers", x."detailExpands",
  jsonb_build_object('platform', 'X', 'postType', x."postType"::text),
  x."dataSource",
  x."createdAt", x."updatedAt"
FROM "XPost" x
LEFT JOIN "SocialPost" s
  ON s."userId" = x."userId"
  AND s."platform" = 'X'
  AND s."externalPostId" = x."postId"
WHERE s."id" IS NULL;

-- ─── SocialFollowersSnapshot backfill ──────────────────
INSERT INTO "SocialFollowersSnapshot" (
  "id", "userId", "platform", "date",
  "followersCount", "followingCount",
  "deltaFollowers", "deltaFollowing",
  "createdAt"
)
SELECT
  'bf_' || gen_random_uuid()::text,
  f."userId",
  'X'::"Platform",
  f."date",
  f."followersCount",
  f."followingCount",
  f."deltaFollowers",
  f."deltaFollowing",
  f."createdAt"
FROM "FollowersSnapshot" f
LEFT JOIN "SocialFollowersSnapshot" s
  ON s."userId" = f."userId"
  AND s."platform" = 'X'
  AND s."date" = f."date"
WHERE s."id" IS NULL;
