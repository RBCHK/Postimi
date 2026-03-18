-- CreateEnum
CREATE TYPE "XApiResourceType" AS ENUM ('POST_READ', 'USER_READ', 'TREND_READ');

-- CreateEnum
CREATE TYPE "CronJobStatus" AS ENUM ('SUCCESS', 'PARTIAL', 'FAILURE', 'SKIPPED');

-- CreateTable
CREATE TABLE "XApiCallLog" (
    "id" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "resourceType" "XApiResourceType" NOT NULL,
    "resourceCount" INTEGER NOT NULL,
    "costCents" DOUBLE PRECISION NOT NULL,
    "callerJob" TEXT,
    "userId" TEXT,
    "httpStatus" INTEGER,
    "error" TEXT,
    "calledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "XApiCallLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CronJobRun" (
    "id" TEXT NOT NULL,
    "jobName" TEXT NOT NULL,
    "status" "CronJobStatus" NOT NULL,
    "durationMs" INTEGER,
    "resultJson" JSONB,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CronJobRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CronJobConfig" (
    "jobName" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "schedule" TEXT,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CronJobConfig_pkey" PRIMARY KEY ("jobName")
);

-- CreateIndex
CREATE INDEX "XApiCallLog_calledAt_idx" ON "XApiCallLog"("calledAt");

-- CreateIndex
CREATE INDEX "XApiCallLog_userId_idx" ON "XApiCallLog"("userId");

-- CreateIndex
CREATE INDEX "CronJobRun_jobName_idx" ON "CronJobRun"("jobName");

-- CreateIndex
CREATE INDEX "CronJobRun_startedAt_idx" ON "CronJobRun"("startedAt");

-- AddForeignKey
ALTER TABLE "XApiCallLog" ADD CONSTRAINT "XApiCallLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
