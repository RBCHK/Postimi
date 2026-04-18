-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('X', 'LINKEDIN', 'THREADS');

-- CreateEnum
CREATE TYPE "Language" AS ENUM ('EN', 'RU', 'UK', 'ES', 'DE', 'FR');

-- CreateEnum
CREATE TYPE "AudienceSize" AS ENUM ('NANO', 'MICRO', 'MID', 'MACRO');

-- AlterTable
ALTER TABLE "PlanProposal" ADD COLUMN     "platform" "Platform" NOT NULL DEFAULT 'X';

-- AlterTable
ALTER TABLE "StrategyAnalysis" ADD COLUMN     "platform" "Platform" NOT NULL DEFAULT 'X';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "outputLanguage" "Language";

-- CreateTable
CREATE TABLE "SocialPost" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "externalPostId" TEXT NOT NULL,
    "postedAt" TIMESTAMP(3) NOT NULL,
    "text" TEXT NOT NULL,
    "postUrl" TEXT,
    "postType" TEXT NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "engagements" INTEGER NOT NULL DEFAULT 0,
    "bookmarks" INTEGER NOT NULL DEFAULT 0,
    "replies" INTEGER NOT NULL DEFAULT 0,
    "reposts" INTEGER NOT NULL DEFAULT 0,
    "quoteCount" INTEGER NOT NULL DEFAULT 0,
    "urlClicks" INTEGER NOT NULL DEFAULT 0,
    "profileVisits" INTEGER NOT NULL DEFAULT 0,
    "shares" INTEGER NOT NULL DEFAULT 0,
    "views" INTEGER NOT NULL DEFAULT 0,
    "newFollowers" INTEGER NOT NULL DEFAULT 0,
    "detailExpands" INTEGER NOT NULL DEFAULT 0,
    "platformMetadata" JSONB,
    "dataSource" "DataSource" NOT NULL DEFAULT 'API',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialDailyStats" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "engagements" INTEGER NOT NULL DEFAULT 0,
    "bookmarks" INTEGER NOT NULL DEFAULT 0,
    "shares" INTEGER NOT NULL DEFAULT 0,
    "newFollows" INTEGER NOT NULL DEFAULT 0,
    "unfollows" INTEGER NOT NULL DEFAULT 0,
    "replies" INTEGER NOT NULL DEFAULT 0,
    "reposts" INTEGER NOT NULL DEFAULT 0,
    "profileVisits" INTEGER NOT NULL DEFAULT 0,
    "createPost" INTEGER NOT NULL DEFAULT 0,
    "videoViews" INTEGER NOT NULL DEFAULT 0,
    "mediaViews" INTEGER NOT NULL DEFAULT 0,
    "views" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SocialDailyStats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialFollowersSnapshot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "followersCount" INTEGER NOT NULL,
    "followingCount" INTEGER,
    "deltaFollowers" INTEGER NOT NULL DEFAULT 0,
    "deltaFollowing" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SocialFollowersSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialPostEngagementSnapshot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "postId" TEXT NOT NULL,
    "snapshotDate" TIMESTAMP(3) NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "engagements" INTEGER NOT NULL DEFAULT 0,
    "bookmarks" INTEGER NOT NULL DEFAULT 0,
    "replies" INTEGER NOT NULL DEFAULT 0,
    "reposts" INTEGER NOT NULL DEFAULT 0,
    "quoteCount" INTEGER NOT NULL DEFAULT 0,
    "profileVisits" INTEGER NOT NULL DEFAULT 0,
    "urlClicks" INTEGER NOT NULL DEFAULT 0,
    "shares" INTEGER NOT NULL DEFAULT 0,
    "views" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SocialPostEngagementSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformBenchmark" (
    "id" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "audienceSize" "AudienceSize" NOT NULL,
    "metric" TEXT NOT NULL,
    "strongThreshold" DOUBLE PRECISION NOT NULL,
    "avgThreshold" DOUBLE PRECISION NOT NULL,
    "weakThreshold" DOUBLE PRECISION NOT NULL,
    "source" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformBenchmark_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SocialPost_userId_platform_postedAt_idx" ON "SocialPost"("userId", "platform", "postedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SocialPost_userId_platform_externalPostId_key" ON "SocialPost"("userId", "platform", "externalPostId");

-- CreateIndex
CREATE INDEX "SocialDailyStats_userId_platform_date_idx" ON "SocialDailyStats"("userId", "platform", "date");

-- CreateIndex
CREATE UNIQUE INDEX "SocialDailyStats_userId_platform_date_key" ON "SocialDailyStats"("userId", "platform", "date");

-- CreateIndex
CREATE INDEX "SocialFollowersSnapshot_userId_platform_date_idx" ON "SocialFollowersSnapshot"("userId", "platform", "date");

-- CreateIndex
CREATE UNIQUE INDEX "SocialFollowersSnapshot_userId_platform_date_key" ON "SocialFollowersSnapshot"("userId", "platform", "date");

-- CreateIndex
CREATE INDEX "SocialPostEngagementSnapshot_userId_platform_idx" ON "SocialPostEngagementSnapshot"("userId", "platform");

-- CreateIndex
CREATE INDEX "SocialPostEngagementSnapshot_postId_idx" ON "SocialPostEngagementSnapshot"("postId");

-- CreateIndex
CREATE UNIQUE INDEX "SocialPostEngagementSnapshot_userId_platform_postId_snapsho_key" ON "SocialPostEngagementSnapshot"("userId", "platform", "postId", "snapshotDate");

-- CreateIndex
CREATE INDEX "PlatformBenchmark_platform_idx" ON "PlatformBenchmark"("platform");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformBenchmark_platform_audienceSize_metric_key" ON "PlatformBenchmark"("platform", "audienceSize", "metric");

-- CreateIndex
CREATE INDEX "PlanProposal_userId_platform_idx" ON "PlanProposal"("userId", "platform");

-- CreateIndex
CREATE INDEX "StrategyAnalysis_userId_platform_weekStart_idx" ON "StrategyAnalysis"("userId", "platform", "weekStart");

-- AddForeignKey
ALTER TABLE "SocialPost" ADD CONSTRAINT "SocialPost_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialDailyStats" ADD CONSTRAINT "SocialDailyStats_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialFollowersSnapshot" ADD CONSTRAINT "SocialFollowersSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialPostEngagementSnapshot" ADD CONSTRAINT "SocialPostEngagementSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialPostEngagementSnapshot" ADD CONSTRAINT "SocialPostEngagementSnapshot_postId_fkey" FOREIGN KEY ("postId") REFERENCES "SocialPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
