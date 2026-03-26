-- AlterTable
ALTER TABLE "XApiToken" ADD COLUMN     "xAccountCreatedAt" TIMESTAMP(3),
ADD COLUMN     "xDescription" TEXT,
ADD COLUMN     "xDisplayName" TEXT,
ADD COLUMN     "xLocation" TEXT,
ADD COLUMN     "xProfileImageUrl" TEXT,
ADD COLUMN     "xUrl" TEXT,
ADD COLUMN     "xVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "xVerifiedType" TEXT;
