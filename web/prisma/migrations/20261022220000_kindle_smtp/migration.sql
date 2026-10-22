-- The account the server uses to mail articles to Kindle. Edited in Admin.
ALTER TABLE "SystemSettings" ADD COLUMN "smtpHost" TEXT;
ALTER TABLE "SystemSettings" ADD COLUMN "smtpPort" INTEGER;
ALTER TABLE "SystemSettings" ADD COLUMN "smtpUser" TEXT;
ALTER TABLE "SystemSettings" ADD COLUMN "smtpPassword" TEXT;
ALTER TABLE "SystemSettings" ADD COLUMN "smtpFrom" TEXT;
