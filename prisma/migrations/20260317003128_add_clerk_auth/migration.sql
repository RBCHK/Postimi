/*
  Warnings:

  - A unique constraint covering the columns `[userId,date]` on the table `DailyAccountStats` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[userId,date]` on the table `DailyInsight` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[userId,date]` on the table `FollowersSnapshot` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[userId,postId,snapshotDate]` on the table `PostEngagementSnapshot` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[userId,postId]` on the table `XPost` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `userId` to the `Conversation` table without a default value. This is not possible if the table is not empty.
  - Added the required column `userId` to the `DailyAccountStats` table without a default value. This is not possible if the table is not empty.
  - Added the required column `userId` to the `DailyInsight` table without a default value. This is not possible if the table is not empty.
  - Added the required column `userId` to the `FollowersSnapshot` table without a default value. This is not possible if the table is not empty.
  - Added the required column `userId` to the `PlanProposal` table without a default value. This is not possible if the table is not empty.
  - Added the required column `userId` to the `PostEngagementSnapshot` table without a default value. This is not possible if the table is not empty.
  - Added the required column `userId` to the `ResearchNote` table without a default value. This is not possible if the table is not empty.
  - Added the required column `userId` to the `ScheduledSlot` table without a default value. This is not possible if the table is not empty.
  - Added the required column `userId` to the `StrategyAnalysis` table without a default value. This is not possible if the table is not empty.
  - Added the required column `userId` to the `StrategyConfig` table without a default value. This is not possible if the table is not empty.
  - Added the required column `userId` to the `VoiceBankEntry` table without a default value. This is not possible if the table is not empty.
  - Added the required column `userId` to the `XPost` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "DailyAccountStats_date_key";

-- DropIndex
DROP INDEX "DailyInsight_date_key";

-- DropIndex
DROP INDEX "FollowersSnapshot_date_key";

-- DropIndex
DROP INDEX "PostEngagementSnapshot_postId_snapshotDate_key";

-- DropIndex
DROP INDEX "XPost_postId_key";

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "userId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "DailyAccountStats" ADD COLUMN     "userId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "DailyInsight" ADD COLUMN     "userId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "FollowersSnapshot" ADD COLUMN     "userId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "PlanProposal" ADD COLUMN     "userId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "PostEngagementSnapshot" ADD COLUMN     "userId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "ResearchNote" ADD COLUMN     "userId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "ScheduledSlot" ADD COLUMN     "userId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "StrategyAnalysis" ADD COLUMN     "userId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "StrategyConfig" ADD COLUMN     "userId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "VoiceBankEntry" ADD COLUMN     "userId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "XPost" ADD COLUMN     "userId" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "clerkId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "imageUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_clerkId_key" ON "User"("clerkId");

-- CreateIndex
CREATE INDEX "Conversation_userId_idx" ON "Conversation"("userId");

-- CreateIndex
CREATE INDEX "DailyAccountStats_userId_idx" ON "DailyAccountStats"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "DailyAccountStats_userId_date_key" ON "DailyAccountStats"("userId", "date");

-- CreateIndex
CREATE INDEX "DailyInsight_userId_idx" ON "DailyInsight"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "DailyInsight_userId_date_key" ON "DailyInsight"("userId", "date");

-- CreateIndex
CREATE INDEX "FollowersSnapshot_userId_idx" ON "FollowersSnapshot"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "FollowersSnapshot_userId_date_key" ON "FollowersSnapshot"("userId", "date");

-- CreateIndex
CREATE INDEX "PlanProposal_userId_idx" ON "PlanProposal"("userId");

-- CreateIndex
CREATE INDEX "PostEngagementSnapshot_userId_idx" ON "PostEngagementSnapshot"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PostEngagementSnapshot_userId_postId_snapshotDate_key" ON "PostEngagementSnapshot"("userId", "postId", "snapshotDate");

-- CreateIndex
CREATE INDEX "ResearchNote_userId_idx" ON "ResearchNote"("userId");

-- CreateIndex
CREATE INDEX "ScheduledSlot_userId_idx" ON "ScheduledSlot"("userId");

-- CreateIndex
CREATE INDEX "StrategyAnalysis_userId_idx" ON "StrategyAnalysis"("userId");

-- CreateIndex
CREATE INDEX "StrategyConfig_userId_idx" ON "StrategyConfig"("userId");

-- CreateIndex
CREATE INDEX "VoiceBankEntry_userId_idx" ON "VoiceBankEntry"("userId");

-- CreateIndex
CREATE INDEX "XPost_userId_idx" ON "XPost"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "XPost_userId_postId_key" ON "XPost"("userId", "postId");

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoiceBankEntry" ADD CONSTRAINT "VoiceBankEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledSlot" ADD CONSTRAINT "ScheduledSlot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategyConfig" ADD CONSTRAINT "StrategyConfig_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "XPost" ADD CONSTRAINT "XPost_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyAccountStats" ADD CONSTRAINT "DailyAccountStats_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategyAnalysis" ADD CONSTRAINT "StrategyAnalysis_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchNote" ADD CONSTRAINT "ResearchNote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyInsight" ADD CONSTRAINT "DailyInsight_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowersSnapshot" ADD CONSTRAINT "FollowersSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostEngagementSnapshot" ADD CONSTRAINT "PostEngagementSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanProposal" ADD CONSTRAINT "PlanProposal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
