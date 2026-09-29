-- AlterTable
ALTER TABLE "Article" ADD COLUMN     "summary" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "aiApiKey" TEXT,
ADD COLUMN     "aiModel" TEXT NOT NULL DEFAULT 'gemini-3.1-pro-preview',
ADD COLUMN     "aiPrompt" TEXT,
ADD COLUMN     "aiSummariesEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "summaryView" TEXT NOT NULL DEFAULT 'card';
