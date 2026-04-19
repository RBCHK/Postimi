-- ADR-008 Phase 1b: drop the four X-only legacy analytics tables.
--
-- All reads/writes were switched to Social* (filtered by platform="X")
-- in the companion PR. Parity between the legacy tables and the new
-- Social* projections was verified via /api/admin/parity
-- (allAligned: true) before generating this migration.
--
-- DROP TABLE ... CASCADE also drops dependent foreign keys and indexes.

DROP TABLE "PostEngagementSnapshot" CASCADE;
DROP TABLE "FollowersSnapshot" CASCADE;
DROP TABLE "DailyAccountStats" CASCADE;
DROP TABLE "XPost" CASCADE;

-- XPostType is no longer referenced by any table.
DROP TYPE "XPostType";
