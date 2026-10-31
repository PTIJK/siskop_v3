-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN "province" TEXT,
ADD COLUMN "city" TEXT;

-- CreateTable
CREATE TABLE "RequestMetricHourly" (
    "id" TEXT NOT NULL,
    "hour" TIMESTAMP(3) NOT NULL,
    "routeGroup" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "errors5xx" INTEGER NOT NULL,
    "p50Ms" INTEGER NOT NULL,
    "p95Ms" INTEGER NOT NULL,

    CONSTRAINT "RequestMetricHourly_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RequestMetricHourly_hour_routeGroup_key" ON "RequestMetricHourly"("hour", "routeGroup");

-- CreateIndex
CREATE INDEX "RequestMetricHourly_hour_idx" ON "RequestMetricHourly"("hour");
