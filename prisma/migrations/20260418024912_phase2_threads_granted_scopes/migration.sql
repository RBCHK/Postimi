-- AlterTable
ALTER TABLE "ThreadsApiToken" ADD COLUMN     "grantedScopes" TEXT[] DEFAULT ARRAY[]::TEXT[];
