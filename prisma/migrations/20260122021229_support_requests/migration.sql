-- Add new purposes for support approvals
ALTER TYPE "AuthChallengePurpose" ADD VALUE IF NOT EXISTS 'SUPPORT_HOME_ACCESS';
ALTER TYPE "AuthChallengePurpose" ADD VALUE IF NOT EXISTS 'SUPPORT_USER_REMOTE_SUPPORT';

-- Support request kind enum
CREATE TYPE "SupportRequestKind" AS ENUM ('HOME_ACCESS', 'USER_REMOTE_ACCESS');

-- Support requests table
CREATE TABLE "SupportRequest" (
    "id" TEXT NOT NULL,
    "kind" "SupportRequestKind" NOT NULL,
    "homeId" INTEGER NOT NULL,
    "targetUserId" INTEGER,
    "installerUserId" INTEGER NOT NULL,
    "authChallengeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SupportRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SupportRequest_authChallengeId_key" ON "SupportRequest"("authChallengeId");
CREATE INDEX "SupportRequest_homeId_idx" ON "SupportRequest"("homeId");
CREATE INDEX "SupportRequest_targetUserId_idx" ON "SupportRequest"("targetUserId");
CREATE INDEX "SupportRequest_installerUserId_idx" ON "SupportRequest"("installerUserId");
