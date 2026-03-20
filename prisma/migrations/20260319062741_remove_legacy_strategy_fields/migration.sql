/*
  Warnings:

  - You are about to drop the column `postsPerDay` on the `StrategyConfig` table. All the data in the column will be lost.
  - You are about to drop the column `replySessionsPerDay` on the `StrategyConfig` table. All the data in the column will be lost.
  - You are about to drop the column `timeSlots` on the `StrategyConfig` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "StrategyConfig" DROP COLUMN "postsPerDay",
DROP COLUMN "replySessionsPerDay",
DROP COLUMN "timeSlots";
