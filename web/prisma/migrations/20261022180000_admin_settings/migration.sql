-- CreateTable
CREATE TABLE "SystemSettings" (
    "id" TEXT NOT NULL,
    "aiModel" TEXT NOT NULL DEFAULT 'gemini-3.1-pro-preview',
    "aiApiKey" TEXT,
    "aiPrompt" TEXT,
    "defaultTopics" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "importTags" TEXT NOT NULL DEFAULT 'assign',
    "importContent" TEXT NOT NULL DEFAULT 'missing',
    "importSummary" TEXT NOT NULL DEFAULT 'ondemand',

    CONSTRAINT "SystemSettings_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "User" ADD COLUMN "excludedTopics" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "User" ADD COLUMN "importTagsOverride" TEXT;

-- One settings row. Copy the admin account's model, key, and prompt when that
-- account already exists, so moving them off the user row does not drop them.
INSERT INTO "SystemSettings" ("id", "aiModel", "aiApiKey", "aiPrompt", "defaultTopics", "importTags", "importContent", "importSummary")
SELECT
    'system',
    COALESCE(u."aiModel", 'gemini-3.1-pro-preview'),
    u."aiApiKey",
    u."aiPrompt",
    ARRAY['Technology','AI','Science','Health','Business','Finance','Economics','Politics','World','Culture','Media','History','Education','Sport','Travel','Food','Design','Environment','Psychology','Personal']::TEXT[],
    'assign',
    'missing',
    'ondemand'
FROM (SELECT 1) AS seed
LEFT JOIN "User" u ON lower(u.email) = 'uridanan@gmail.com';
