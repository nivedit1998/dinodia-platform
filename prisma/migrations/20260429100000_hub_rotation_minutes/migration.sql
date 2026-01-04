-- Move hub token rotation to minute granularity and tighten defaults.

ALTER TABLE "HubInstall"
ADD COLUMN     "rotateEveryMinutes" INTEGER NOT NULL DEFAULT 60;

-- Force-security backfill for all existing installs.
UPDATE "HubInstall" SET "rotateEveryMinutes" = 60;
UPDATE "HubInstall" SET "graceMinutes" = 20;
UPDATE "HubInstall" SET "platformSyncIntervalMinutes" = 2;

ALTER TABLE "HubInstall" ALTER COLUMN "platformSyncIntervalMinutes" SET DEFAULT 2;
ALTER TABLE "HubInstall" ALTER COLUMN "graceMinutes" SET DEFAULT 20;

ALTER TABLE "HubInstall" DROP COLUMN "rotateEveryDays";
