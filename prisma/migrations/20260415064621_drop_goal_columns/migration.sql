/*
  Warnings:

  - You are about to drop the column `targetDate` on the `StrategyConfig` table. All the data in the column will be lost.
  - You are about to drop the column `targetFollowers` on the `StrategyConfig` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "StrategyConfig" DROP COLUMN "targetDate",
DROP COLUMN "targetFollowers";
