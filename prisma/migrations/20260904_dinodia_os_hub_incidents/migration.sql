CREATE TABLE "HubIncident" (
    "id" TEXT NOT NULL,
    "hubInstallId" TEXT NOT NULL,
    "homeId" INTEGER NOT NULL,
    "incidentId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "detail" TEXT,
    "deviceId" TEXT,
    "deviceName" TEXT,
    "deviceProtocol" TEXT,
    "deviceModel" TEXT,
    "areaName" TEXT,
    "labels" JSONB,
    "details" JSONB,
    "firstObservedAt" TIMESTAMP(3) NOT NULL,
    "lastObservedAt" TIMESTAMP(3) NOT NULL,
    "openedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HubIncident_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HubIncident_hubInstallId_incidentId_key" ON "HubIncident"("hubInstallId", "incidentId");
CREATE INDEX "HubIncident_homeId_state_lastObservedAt_idx" ON "HubIncident"("homeId", "state", "lastObservedAt");
CREATE INDEX "HubIncident_hubInstallId_lastObservedAt_idx" ON "HubIncident"("hubInstallId", "lastObservedAt");

ALTER TABLE "HubIncident" ADD CONSTRAINT "HubIncident_hubInstallId_fkey" FOREIGN KEY ("hubInstallId") REFERENCES "HubInstall"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HubIncident" ADD CONSTRAINT "HubIncident_homeId_fkey" FOREIGN KEY ("homeId") REFERENCES "Home"("id") ON DELETE CASCADE ON UPDATE CASCADE;
