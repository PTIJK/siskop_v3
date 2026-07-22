-- CreateEnum
CREATE TYPE "CalkSection" AS ENUM ('UMUM', 'DASAR_PENYUSUNAN', 'KEBIJAKAN_AKUNTANSI', 'INFORMASI_TAMBAHAN');

-- CreateTable
CREATE TABLE "CalkNarrative" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "section" "CalkSection" NOT NULL,
    "content" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalkNarrative_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CalkNarrative_tenantId_idx" ON "CalkNarrative"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "CalkNarrative_tenantId_section_key" ON "CalkNarrative"("tenantId", "section");

-- AddForeignKey
ALTER TABLE "CalkNarrative" ADD CONSTRAINT "CalkNarrative_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
