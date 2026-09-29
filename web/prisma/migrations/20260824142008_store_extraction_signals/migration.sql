-- AlterTable
ALTER TABLE "Article" ADD COLUMN     "hasEmbeddedMedia" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isProduct" BOOLEAN NOT NULL DEFAULT false;
