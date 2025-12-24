-- Phase 7: ensure Home/User backfill completeness and production-safe constraints.

-- Create a Home for every HA connection missing one (keep status ACTIVE and placeholder address fields)
WITH missing_connections AS (
  SELECT hc."id" AS ha_connection_id
  FROM "HaConnection" hc
  LEFT JOIN "Home" h ON h."haConnectionId" = hc."id"
  WHERE h."id" IS NULL
)
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
  'Pending address',
  NULL,
  'Pending',
  NULL,
  '00000',
  'Unknown',
  mc.ha_connection_id,
  NULL,
  NULL,
  NULL,
  NOW(),
  NOW()
FROM missing_connections mc
ON CONFLICT ("haConnectionId") DO NOTHING;

-- Align owner-derived HA connections with the owning user
UPDATE "User" AS u
SET "haConnectionId" = hc."id"
FROM "HaConnection" AS hc
WHERE hc."ownerId" = u."id"
  AND u."haConnectionId" IS DISTINCT FROM hc."id";

-- Map users to the Home that matches their HA connection (tenants + admins)
UPDATE "User" AS u
SET "homeId" = h."id"
FROM "Home" AS h
WHERE u."haConnectionId" = h."haConnectionId"
  AND u."homeId" IS DISTINCT FROM h."id";

-- Fill missing haConnectionId from the Home mapping when possible
UPDATE "User" AS u
SET "haConnectionId" = h."haConnectionId"
FROM "Home" AS h
WHERE u."homeId" = h."id"
  AND u."haConnectionId" IS NULL;

-- Fallback: if there is exactly one home, attach any remaining users to it
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

-- Guardrail: surface any remaining null homeId rows before locking the schema
DO $$
DECLARE
  missing_home_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO missing_home_count FROM "User" WHERE "homeId" IS NULL;

  IF missing_home_count > 0 THEN
    RAISE EXCEPTION 'Phase 7 backfill failed; % users still missing homeId', missing_home_count;
  END IF;
END $$;

-- Ensure constraints are in place
ALTER TABLE "User" ALTER COLUMN "homeId" SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Home_haConnectionId_key'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_class WHERE relname = 'Home_haConnectionId_key' AND relkind = 'i'
  ) THEN
    ALTER TABLE "Home" ADD CONSTRAINT "Home_haConnectionId_key" UNIQUE ("haConnectionId");
  END IF;
END $$;
