-- CreateEnum
CREATE TYPE "CronJobTrigger" AS ENUM ('SCHEDULED', 'MANUAL');

-- AlterTable
ALTER TABLE "CronJobRun" ADD COLUMN "trigger" "CronJobTrigger" NOT NULL DEFAULT 'SCHEDULED';
