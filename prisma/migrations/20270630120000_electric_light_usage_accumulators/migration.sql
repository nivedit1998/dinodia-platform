ALTER TABLE "Home" ADD COLUMN "timeZone" TEXT NOT NULL DEFAULT 'Europe/London';

CREATE TABLE "ElectricUsageAccumulator" (
    "id" SERIAL NOT NULL,
    "haConnectionId" INTEGER NOT NULL,
    "entityId" TEXT NOT NULL,
    "entityName" TEXT,
    "trackingStartedAt" TIMESTAMP(3),
    "trackingEpoch" TEXT NOT NULL,
    "assignmentStartedAt" TIMESTAMP(3),
    "assignmentEpoch" TEXT NOT NULL,
    "sourceAreaId" TEXT,
    "sourceAreaName" TEXT,
    "onSeconds" INTEGER NOT NULL DEFAULT 0,
    "offSeconds" INTEGER NOT NULL DEFAULT 0,
    "unknownSeconds" INTEGER NOT NULL DEFAULT 0,
    "lastSeenAt" TIMESTAMP(3),
    "lastWasOn" BOOLEAN,
    "lastWasKnown" BOOLEAN,
    "retiredAt" TIMESTAMP(3),
    "lastSnapshotOnSeconds" INTEGER,
    "lastSnapshotOffSeconds" INTEGER,
    "lastSnapshotUnknownSeconds" INTEGER,
    "lastSnapshotAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ElectricUsageAccumulator_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ElectricUsageReading" (
    "id" SERIAL NOT NULL,
    "haConnectionId" INTEGER NOT NULL,
    "entityId" TEXT NOT NULL,
    "entityName" TEXT,
    "trackingEpoch" TEXT NOT NULL,
    "assignmentEpoch" TEXT NOT NULL,
    "sourceAreaId" TEXT,
    "sourceAreaName" TEXT,
    "windowStartedAt" TIMESTAMP(3) NOT NULL,
    "windowEndedAt" TIMESTAMP(3) NOT NULL,
    "onForSeconds" INTEGER NOT NULL DEFAULT 0,
    "offForSeconds" INTEGER NOT NULL DEFAULT 0,
    "unknownForSeconds" INTEGER NOT NULL DEFAULT 0,
    "averageWattsApplied" DOUBLE PRECISION,
    "electricPricePerKwh" DOUBLE PRECISION,
    "estimatedKwh" DOUBLE PRECISION,
    "estimatedCostGbp" DOUBLE PRECISION,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ElectricUsageReading_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ElectricUsageDailyRollup" (
    "id" SERIAL NOT NULL,
    "haConnectionId" INTEGER NOT NULL,
    "entityId" TEXT NOT NULL,
    "entityName" TEXT,
    "trackingEpoch" TEXT NOT NULL,
    "assignmentEpoch" TEXT NOT NULL,
    "sourceAreaId" TEXT,
    "sourceAreaName" TEXT,
    "localDate" TEXT NOT NULL,
    "timeZone" TEXT NOT NULL,
    "onForSeconds" INTEGER NOT NULL DEFAULT 0,
    "offForSeconds" INTEGER NOT NULL DEFAULT 0,
    "unknownForSeconds" INTEGER NOT NULL DEFAULT 0,
    "estimatedKwh" DOUBLE PRECISION,
    "estimatedCostGbp" DOUBLE PRECISION,
    "averageWattsApplied" DOUBLE PRECISION,
    "electricPricePerKwh" DOUBLE PRECISION,
    "configurationMixed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ElectricUsageDailyRollup_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ElectricUsageAccumulator_haConnectionId_entityId_key" ON "ElectricUsageAccumulator"("haConnectionId", "entityId");
CREATE INDEX "ElectricUsageAccumulator_haConnectionId_idx" ON "ElectricUsageAccumulator"("haConnectionId");
CREATE INDEX "ElectricUsageAccumulator_haConnectionId_updatedAt_idx" ON "ElectricUsageAccumulator"("haConnectionId", "updatedAt");

CREATE UNIQUE INDEX "ElectricUsageReading_haConnectionId_entityId_windowStartedAt_assignmentEpoch_key" ON "ElectricUsageReading"("haConnectionId", "entityId", "windowStartedAt", "assignmentEpoch");
CREATE INDEX "ElectricUsageReading_haConnectionId_entityId_capturedAt_idx" ON "ElectricUsageReading"("haConnectionId", "entityId", "capturedAt");
CREATE INDEX "ElectricUsageReading_haConnectionId_capturedAt_idx" ON "ElectricUsageReading"("haConnectionId", "capturedAt");
CREATE INDEX "ElectricUsageReading_haConnectionId_sourceAreaId_capturedAt_idx" ON "ElectricUsageReading"("haConnectionId", "sourceAreaId", "capturedAt");

CREATE UNIQUE INDEX "ElectricUsageDailyRollup_haConnectionId_entityId_localDate_assignmentEpoch_key" ON "ElectricUsageDailyRollup"("haConnectionId", "entityId", "localDate", "assignmentEpoch");
CREATE INDEX "ElectricUsageDailyRollup_haConnectionId_localDate_idx" ON "ElectricUsageDailyRollup"("haConnectionId", "localDate");
CREATE INDEX "ElectricUsageDailyRollup_haConnectionId_sourceAreaId_localDate_idx" ON "ElectricUsageDailyRollup"("haConnectionId", "sourceAreaId", "localDate");

ALTER TABLE "ElectricUsageAccumulator" ADD CONSTRAINT "ElectricUsageAccumulator_haConnectionId_fkey" FOREIGN KEY ("haConnectionId") REFERENCES "HaConnection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ElectricUsageReading" ADD CONSTRAINT "ElectricUsageReading_haConnectionId_fkey" FOREIGN KEY ("haConnectionId") REFERENCES "HaConnection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ElectricUsageDailyRollup" ADD CONSTRAINT "ElectricUsageDailyRollup_haConnectionId_fkey" FOREIGN KEY ("haConnectionId") REFERENCES "HaConnection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
