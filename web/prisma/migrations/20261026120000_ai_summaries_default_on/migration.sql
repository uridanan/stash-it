-- New accounts start with summaries on, and accounts created while the
-- default was off are turned on too. Someone can still switch it off.
ALTER TABLE "User" ALTER COLUMN "aiSummariesEnabled" SET DEFAULT true;

UPDATE "User"
SET "aiSummariesEnabled" = true
WHERE "aiSummariesEnabled" = false;
