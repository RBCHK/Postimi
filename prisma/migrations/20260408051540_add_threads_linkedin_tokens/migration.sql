-- CreateTable
CREATE TABLE "ThreadsApiToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "threadsUserId" TEXT NOT NULL,
    "threadsUsername" TEXT NOT NULL,
    "threadsProfilePictureUrl" TEXT,
    "threadsBiography" TEXT,
    "accessToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "scopes" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ThreadsApiToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LinkedInApiToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "linkedinUserId" TEXT NOT NULL,
    "linkedinName" TEXT,
    "linkedinEmail" TEXT,
    "linkedinPictureUrl" TEXT,
    "linkedinHeadline" TEXT,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "scopes" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LinkedInApiToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ThreadsApiToken_userId_key" ON "ThreadsApiToken"("userId");

-- CreateIndex
CREATE INDEX "ThreadsApiToken_threadsUserId_idx" ON "ThreadsApiToken"("threadsUserId");

-- CreateIndex
CREATE UNIQUE INDEX "LinkedInApiToken_userId_key" ON "LinkedInApiToken"("userId");

-- CreateIndex
CREATE INDEX "LinkedInApiToken_linkedinUserId_idx" ON "LinkedInApiToken"("linkedinUserId");

-- AddForeignKey
ALTER TABLE "ThreadsApiToken" ADD CONSTRAINT "ThreadsApiToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LinkedInApiToken" ADD CONSTRAINT "LinkedInApiToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
