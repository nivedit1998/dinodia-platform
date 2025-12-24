-- CreateEnum
CREATE TYPE "HomeStatus" AS ENUM ('ACTIVE', 'TRANSFER_PENDING', 'UNCLAIMED');

-- CreateEnum
CREATE TYPE "AuditEventType" AS ENUM ('SELL_INITIATED', 'CLAIM_CODE_GENERATED', 'HOME_RESET', 'OWNER_TRANSFERRED', 'HOME_CLAIMED');

-- CreateTable
CREATE TABLE "Home" (
    "id" SERIAL NOT NULL,
    "status" "HomeStatus" NOT NULL DEFAULT 'ACTIVE',
    "addressLine1" TEXT NOT NULL,
    "addressLine2" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT,
    "postcode" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "haConnectionId" INTEGER NOT NULL,
    "claimCodeHash" TEXT,
    "claimCodeIssuedAt" TIMESTAMP(3),
    "claimCodeConsumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Home_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "type" "AuditEventType" NOT NULL,
    "metadata" JSONB,
    "homeId" INTEGER NOT NULL,
    "actorUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "homeId" INTEGER;

-- AlterTable
ALTER TABLE "HaConnection" ALTER COLUMN "ownerId" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Home_haConnectionId_key" ON "Home"("haConnectionId");

-- CreateIndex
CREATE UNIQUE INDEX "Home_claimCodeHash_key" ON "Home"("claimCodeHash");

-- CreateIndex
CREATE INDEX "AuditEvent_homeId_idx" ON "AuditEvent"("homeId");

-- CreateIndex
CREATE INDEX "AuditEvent_actorUserId_idx" ON "AuditEvent"("actorUserId");

-- AddForeignKey
ALTER TABLE "Home" ADD CONSTRAINT "Home_haConnectionId_fkey" FOREIGN KEY ("haConnectionId") REFERENCES "HaConnection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_homeId_fkey" FOREIGN KEY ("homeId") REFERENCES "Home"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: create a Home for each existing HA connection (placeholder address fields)
INSERT INTO "Home" (
    "status",
    "addressLine1",
    "addressLine2",
    "city",
    "state",
    "postcode",
    "country",
    "haConnectionId",
    "claimCodeHash",
    "claimCodeIssuedAt",
    "claimCodeConsumedAt",
    "createdAt",
    "updatedAt"
)
SELECT
    'ACTIVE'::"HomeStatus",
    '',
    NULL,
    '',
    NULL,
    '',
    '',
    hc."id",
    NULL,
    NULL,
    NULL,
    NOW(),
    NOW()
FROM "HaConnection" AS hc
ON CONFLICT ("haConnectionId") DO NOTHING;

-- Backfill: assign users to homes based on existing HA connection or ownership
UPDATE "User" AS u
SET "homeId" = h."id"
FROM "Home" AS h
WHERE u."haConnectionId" IS NOT NULL
  AND h."haConnectionId" = u."haConnectionId";

UPDATE "User" AS u
SET
  "homeId" = h."id",
  "haConnectionId" = COALESCE(u."haConnectionId", h."haConnectionId")
FROM "HaConnection" AS hc
JOIN "Home" AS h ON h."haConnectionId" = hc."id"
WHERE u."homeId" IS NULL
  AND hc."ownerId" = u."id";

DO $$
DECLARE
  home_count INTEGER;
  single_home_id INTEGER;
  single_home_conn_id INTEGER;
BEGIN
  SELECT COUNT(*) INTO home_count FROM "Home";

  IF home_count = 1 THEN
    SELECT "id", "haConnectionId" INTO single_home_id, single_home_conn_id FROM "Home" LIMIT 1;
    UPDATE "User"
    SET
      "homeId" = single_home_id,
      "haConnectionId" = COALESCE("haConnectionId", single_home_conn_id)
    WHERE "homeId" IS NULL;
  END IF;
END $$;

-- Finalize: ensure every user has a home
ALTER TABLE "User" ALTER COLUMN "homeId" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_homeId_fkey" FOREIGN KEY ("homeId") REFERENCES "Home"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Optional: index for common home lookups
CREATE INDEX "User_homeId_idx" ON "User"("homeId");
