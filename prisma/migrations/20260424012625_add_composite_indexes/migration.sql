-- CreateIndex
CREATE INDEX "Conversation_userId_createdAt_idx" ON "Conversation"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "ResearchNote_userId_createdAt_idx" ON "ResearchNote"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ScheduledSlot_userId_status_date_idx" ON "ScheduledSlot"("userId", "status", "date");

-- CreateIndex
CREATE INDEX "ScheduledSlot_status_date_idx" ON "ScheduledSlot"("status", "date");

-- CreateIndex
CREATE INDEX "StrategyAnalysis_userId_createdAt_idx" ON "StrategyAnalysis"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "VoiceBankEntry_userId_createdAt_idx" ON "VoiceBankEntry"("userId", "createdAt" DESC);
