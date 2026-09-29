-- AlterTable
ALTER TABLE "BackgroundJob" ADD COLUMN     "cursor" TEXT,
ADD COLUMN     "force" BOOLEAN NOT NULL DEFAULT false;
