ALTER TABLE "HubInstall"
ADD COLUMN "runtimeKind" TEXT,
ADD COLUMN "runtimeVersion" TEXT,
ADD COLUMN "runtimeCapabilities" JSONB,
ADD COLUMN "runtimeCapabilitiesReportedAt" TIMESTAMP(3);
