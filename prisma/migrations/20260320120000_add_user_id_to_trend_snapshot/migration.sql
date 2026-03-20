-- WARNING: Deletes existing TrendSnapshot data (global, no userId).
-- Trends are ephemeral (10-day retention); cron will repopulate per-user.

-- Drop existing index
DROP INDEX "TrendSnapshot_date_fetchHour_idx";

-- Delete all existing rows (they have no userId)
DELETE FROM "TrendSnapshot";

-- Add userId column (NOT NULL, since all old rows are deleted)
ALTER TABLE "TrendSnapshot" ADD COLUMN "userId" TEXT NOT NULL;

-- Add foreign key
ALTER TABLE "TrendSnapshot" ADD CONSTRAINT "TrendSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Add unique constraint for deduplication
ALTER TABLE "TrendSnapshot" ADD CONSTRAINT "TrendSnapshot_userId_date_fetchHour_trendName_key" UNIQUE ("userId", "date", "fetchHour", "trendName");

-- Add composite index
CREATE INDEX "TrendSnapshot_userId_date_fetchHour_idx" ON "TrendSnapshot"("userId", "date", "fetchHour");
