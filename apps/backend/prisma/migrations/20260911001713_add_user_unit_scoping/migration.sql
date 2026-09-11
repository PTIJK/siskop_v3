-- CreateTable
CREATE TABLE "UserUnit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserUnit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserUnit_unitId_idx" ON "UserUnit"("unitId");

-- CreateIndex
CREATE INDEX "UserUnit_userId_idx" ON "UserUnit"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserUnit_userId_unitId_key" ON "UserUnit"("userId", "unitId");

-- AddForeignKey
ALTER TABLE "UserUnit" ADD CONSTRAINT "UserUnit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserUnit" ADD CONSTRAINT "UserUnit_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "CooperativeUnit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
