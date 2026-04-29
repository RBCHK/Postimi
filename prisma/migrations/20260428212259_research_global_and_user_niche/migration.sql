-- CreateEnum
CREATE TYPE "ResearchScope" AS ENUM ('GLOBAL', 'USER');

-- AlterTable: User — add user-declared niche / focus area
ALTER TABLE "User" ADD COLUMN "niche" VARCHAR(100);

-- DropForeignKey: relax userId before making it nullable
ALTER TABLE "ResearchNote" DROP CONSTRAINT "ResearchNote_userId_fkey";

-- AlterTable: ResearchNote — split into GLOBAL vs USER scopes
ALTER TABLE "ResearchNote" ADD COLUMN "scope" "ResearchScope" NOT NULL DEFAULT 'USER';
ALTER TABLE "ResearchNote" ADD COLUMN "platform" "Platform";
ALTER TABLE "ResearchNote" ADD COLUMN "niche" VARCHAR(100);
ALTER TABLE "ResearchNote" ALTER COLUMN "userId" DROP NOT NULL;

-- Re-add the FK with the same cascade behaviour but allowing NULL.
ALTER TABLE "ResearchNote" ADD CONSTRAINT "ResearchNote_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DropIndex: replaced by the (scope, platform, createdAt) index below.
-- The existing (userId, createdAt DESC) index is preserved.
DROP INDEX "ResearchNote_userId_idx";

-- CreateIndex: GLOBAL scope lookups by platform.
CREATE INDEX "ResearchNote_scope_platform_createdAt_idx"
  ON "ResearchNote" ("scope", "platform", "createdAt" DESC);

-- Integrity: enforce scope/userId/platform invariants in DB. Application
-- code is the primary guard, but a CHECK keeps stray writes from corrupting
-- analytics queries that rely on (scope = GLOBAL ⇒ platform NOT NULL).
ALTER TABLE "ResearchNote" ADD CONSTRAINT "ResearchNote_scope_invariants_check"
  CHECK (
    (scope = 'GLOBAL' AND "userId" IS NULL  AND "platform" IS NOT NULL)
    OR
    (scope = 'USER'   AND "userId" IS NOT NULL)
  );
