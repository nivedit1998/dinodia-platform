-- CreateTable
CREATE TABLE "AutomationOwnership" (
    "id" SERIAL NOT NULL,
    "homeId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "automationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutomationOwnership_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AutomationOwnership_homeId_idx" ON "AutomationOwnership"("homeId");

-- CreateIndex
CREATE INDEX "AutomationOwnership_userId_idx" ON "AutomationOwnership"("userId");

-- CreateIndex
CREATE INDEX "AutomationOwnership_automationId_idx" ON "AutomationOwnership"("automationId");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationOwnership_automationId_homeId_key" ON "AutomationOwnership"("automationId", "homeId");

-- AddForeignKey
ALTER TABLE "AutomationOwnership" ADD CONSTRAINT "AutomationOwnership_homeId_fkey" FOREIGN KEY ("homeId") REFERENCES "Home"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationOwnership" ADD CONSTRAINT "AutomationOwnership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
