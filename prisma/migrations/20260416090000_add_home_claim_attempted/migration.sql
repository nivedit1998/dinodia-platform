-- AlterEnum
ALTER TYPE "AuditEventType" ADD VALUE 'HOME_CLAIM_ATTEMPTED';

-- DropForeignKey
ALTER TABLE "HaConnection" DROP CONSTRAINT "HaConnection_ownerId_fkey";

-- AddForeignKey
ALTER TABLE "HaConnection" ADD CONSTRAINT "HaConnection_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
