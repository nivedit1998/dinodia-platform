-- CreateEnum
CREATE TYPE "MatterCommissioningStatus" AS ENUM ('CREATED', 'IN_PROGRESS', 'NEEDS_INPUT', 'SUCCEEDED', 'FAILED', 'CANCELED');

-- CreateTable
CREATE TABLE "MatterCommissioningSession" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "haConnectionId" INTEGER NOT NULL,
    "requestedArea" TEXT NOT NULL,
    "requestedName" TEXT,
    "requestedDinodiaType" TEXT,
    "requestedHaLabelId" TEXT,
    "setupPayloadHash" TEXT,
    "manualPairingCodeHash" TEXT,
    "haFlowId" TEXT,
    "status" "MatterCommissioningStatus" NOT NULL DEFAULT 'CREATED',
    "error" TEXT,
    "lastHaStep" JSONB,
    "beforeDeviceIds" JSONB,
    "beforeEntityIds" JSONB,
    "afterDeviceIds" JSONB,
    "afterEntityIds" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MatterCommissioningSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MatterCommissioningSession_userId_idx" ON "MatterCommissioningSession"("userId");
CREATE INDEX "MatterCommissioningSession_haConnectionId_idx" ON "MatterCommissioningSession"("haConnectionId");
CREATE INDEX "MatterCommissioningSession_haFlowId_idx" ON "MatterCommissioningSession"("haFlowId");

-- AddForeignKey
ALTER TABLE "MatterCommissioningSession" ADD CONSTRAINT "MatterCommissioningSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MatterCommissioningSession" ADD CONSTRAINT "MatterCommissioningSession_haConnectionId_fkey" FOREIGN KEY ("haConnectionId") REFERENCES "HaConnection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
