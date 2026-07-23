ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'SUPPORT_HA_CODE_ISSUED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'SUPPORT_HA_CODE_CONSUMED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'SUPPORT_HA_SESSION_STARTED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'SUPPORT_HA_SESSION_FAILED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'SUPPORT_HA_SESSION_EXPIRED';

ALTER TYPE "SupportAccessScope" ADD VALUE IF NOT EXISTS 'CONNECT_HA_BACKEND';

CREATE TYPE "SupportApprovalRecipientType" AS ENUM ('HOMEOWNER', 'PROPERTY_MANAGER');

ALTER TABLE "SupportRequest"
ALTER COLUMN "authChallengeId" DROP NOT NULL,
ADD COLUMN "approvedAt" TIMESTAMP(3),
ADD COLUMN "approvalValidUntil" TIMESTAMP(3),
ADD COLUMN "approvalRecipientType" "SupportApprovalRecipientType",
ADD COLUMN "approvalRecipientEmail" TEXT,
ADD COLUMN "approvalRecipientName" TEXT,
ADD COLUMN "haSecurityCodeHash" TEXT,
ADD COLUMN "haSecurityCodeIssuedAt" TIMESTAMP(3),
ADD COLUMN "haSecurityCodeExpiresAt" TIMESTAMP(3),
ADD COLUMN "haSecurityCodeConsumedAt" TIMESTAMP(3),
ADD COLUMN "connectButtonClickedAt" TIMESTAMP(3),
ADD COLUMN "haSessionStartedAt" TIMESTAMP(3),
ADD COLUMN "haSessionExpiresAt" TIMESTAMP(3),
ADD COLUMN "haSessionEndedAt" TIMESTAMP(3),
ADD COLUMN "haSessionFailureAt" TIMESTAMP(3),
ADD COLUMN "haSessionFailureCode" TEXT,
ADD COLUMN "haSessionRevokedAt" TIMESTAMP(3),
ADD COLUMN "notificationSentAt" TIMESTAMP(3),
ADD COLUMN "notificationFailedAt" TIMESTAMP(3),
ADD COLUMN "notificationFailureReason" TEXT,
ADD COLUMN "supportGatewayHostname" TEXT,
ADD COLUMN "launchTicketHash" TEXT,
ADD COLUMN "launchTicketExpiresAt" TIMESTAMP(3),
ADD COLUMN "gatewaySessionHash" TEXT,
ADD COLUMN "gatewaySessionBoundAt" TIMESTAMP(3),
ADD COLUMN "gatewaySessionUserAgentHash" TEXT;

CREATE UNIQUE INDEX "SupportRequest_launchTicketHash_key" ON "SupportRequest"("launchTicketHash");
CREATE UNIQUE INDEX "SupportRequest_gatewaySessionHash_key" ON "SupportRequest"("gatewaySessionHash");
CREATE INDEX "SupportRequest_approvalValidUntil_idx" ON "SupportRequest"("approvalValidUntil");
CREATE INDEX "SupportRequest_haSessionExpiresAt_idx" ON "SupportRequest"("haSessionExpiresAt");
CREATE INDEX "SupportRequest_supportGatewayHostname_idx" ON "SupportRequest"("supportGatewayHostname");

CREATE TABLE "SupportRequestApprovalToken" (
    "id" TEXT NOT NULL,
    "supportRequestId" TEXT NOT NULL,
    "recipientType" "SupportApprovalRecipientType" NOT NULL,
    "recipientUserId" INTEGER,
    "recipientEmail" TEXT NOT NULL,
    "recipientName" TEXT,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SupportRequestApprovalToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SupportRequestApprovalToken_tokenHash_key" ON "SupportRequestApprovalToken"("tokenHash");
CREATE INDEX "SupportRequestApprovalToken_supportRequestId_idx" ON "SupportRequestApprovalToken"("supportRequestId");
CREATE INDEX "SupportRequestApprovalToken_expiresAt_idx" ON "SupportRequestApprovalToken"("expiresAt");
CREATE INDEX "SupportRequestApprovalToken_recipientUserId_idx" ON "SupportRequestApprovalToken"("recipientUserId");

ALTER TABLE "SupportRequestApprovalToken"
ADD CONSTRAINT "SupportRequestApprovalToken_supportRequestId_fkey"
FOREIGN KEY ("supportRequestId") REFERENCES "SupportRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
