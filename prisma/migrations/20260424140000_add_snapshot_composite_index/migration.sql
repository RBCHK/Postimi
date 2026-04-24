-- CreateIndex
CREATE INDEX "SocialPostEngagementSnapshot_userId_platform_snapshotDate_idx" ON "SocialPostEngagementSnapshot"("userId", "platform", "snapshotDate");
