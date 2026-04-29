-- 2026-04 refactor: Post → ScheduledPublish[] for multi-platform publishing.
-- ScheduledSlot stays in the schema for one release (data backfilled by a
-- Node migration script after this one applies). Drop in a follow-up PR.

-- CreateEnum
CREATE TYPE "ScheduledPublishStatus" AS ENUM (
  'PENDING',
  'PUBLISHING',
  'PUBLISHED',
  'FAILED'
);

-- CreateTable: Post — one row per logical post, multi-platform.
CREATE TABLE "Post" (
  "id"             TEXT NOT NULL,
  "userId"         TEXT NOT NULL,
  "content"        TEXT NOT NULL,
  "conversationId" TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Post_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Post_userId_createdAt_idx" ON "Post" ("userId", "createdAt" DESC);
CREATE INDEX "Post_conversationId_idx" ON "Post" ("conversationId");

-- AddForeignKey
ALTER TABLE "Post"
  ADD CONSTRAINT "Post_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Post"
  ADD CONSTRAINT "Post_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable: ScheduledPublish — per-platform schedule with own status.
-- userId is denormalized from Post.userId for direct isolation queries.
CREATE TABLE "ScheduledPublish" (
  "id"                  TEXT NOT NULL,
  "userId"              TEXT NOT NULL,
  "postId"              TEXT NOT NULL,
  "platform"            "Platform" NOT NULL,
  "scheduledAt"         TIMESTAMP(3) NOT NULL,
  "status"              "ScheduledPublishStatus" NOT NULL DEFAULT 'PENDING',
  "externalPostId"      TEXT,
  "externalUrl"         TEXT,
  "platformContainerId" TEXT,
  "publishedAt"         TIMESTAMP(3),
  "attemptCount"        INTEGER NOT NULL DEFAULT 0,
  "manualRetryCount"    INTEGER NOT NULL DEFAULT 0,
  "lastError"           TEXT,
  "lastAttemptAt"       TIMESTAMP(3),
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ScheduledPublish_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- Cron claim query: WHERE status='PENDING' AND scheduledAt <= now()
CREATE INDEX "ScheduledPublish_status_scheduledAt_idx"
  ON "ScheduledPublish" ("status", "scheduledAt");
-- Per-user calendar view
CREATE INDEX "ScheduledPublish_userId_scheduledAt_idx"
  ON "ScheduledPublish" ("userId", "scheduledAt");
-- Per-post lookup (schedule UI's expand path)
CREATE INDEX "ScheduledPublish_postId_idx"
  ON "ScheduledPublish" ("postId");
-- Stale PUBLISHING sweep
CREATE INDEX "ScheduledPublish_status_lastAttemptAt_idx"
  ON "ScheduledPublish" ("status", "lastAttemptAt");

-- AddForeignKey
ALTER TABLE "ScheduledPublish"
  ADD CONSTRAINT "ScheduledPublish_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ScheduledPublish"
  ADD CONSTRAINT "ScheduledPublish_postId_fkey"
    FOREIGN KEY ("postId") REFERENCES "Post"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
