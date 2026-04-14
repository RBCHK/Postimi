/*
  Warnings:

  - Added the required column `updatedAt` to the `AiUsage` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "AiUsageStatus" AS ENUM ('RESERVED', 'COMPLETED', 'ABORTED', 'FAILED');

-- AlterTable
ALTER TABLE "AiUsage" ADD COLUMN     "status" "AiUsageStatus" NOT NULL DEFAULT 'COMPLETED',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ALTER COLUMN "tokensIn" SET DEFAULT 0,
ALTER COLUMN "tokensOut" SET DEFAULT 0;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "rateLimitRequestCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "rateLimitWindowStart" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "AiUsage_userId_status_createdAt_idx" ON "AiUsage"("userId", "status", "createdAt");
