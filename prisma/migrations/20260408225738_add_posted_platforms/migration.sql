-- AlterTable
ALTER TABLE "ScheduledSlot" ADD COLUMN     "postedPlatforms" TEXT[] DEFAULT ARRAY[]::TEXT[];
