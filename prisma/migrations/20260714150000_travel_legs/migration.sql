-- Travel legs (GH #80): a schedule item can be a real travel span — origin →
-- destination by a method, with ordered en-route stops — replacing the paired
-- start-only "Depart"/"Arrive" items. New enum + two tables; purely additive.

-- CreateEnum
CREATE TYPE "TravelMethod" AS ENUM ('COACH', 'TRAIN', 'FERRY', 'FLIGHT', 'WALK', 'TAXI', 'OTHER');

-- CreateTable
CREATE TABLE "TravelLeg" (
    "id" TEXT NOT NULL,
    "scheduleItemId" TEXT NOT NULL,
    "method" "TravelMethod" NOT NULL DEFAULT 'COACH',
    "fromLocationId" TEXT,
    "fromLabel" TEXT,
    "toLocationId" TEXT,
    "toLabel" TEXT,

    CONSTRAINT "TravelLeg_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TravelStop" (
    "id" TEXT NOT NULL,
    "travelLegId" TEXT NOT NULL,
    "locationId" TEXT,
    "label" TEXT,
    "dwellMinutes" INTEGER,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TravelStop_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TravelLeg_scheduleItemId_key" ON "TravelLeg"("scheduleItemId");

-- CreateIndex
CREATE INDEX "TravelLeg_fromLocationId_idx" ON "TravelLeg"("fromLocationId");

-- CreateIndex
CREATE INDEX "TravelLeg_toLocationId_idx" ON "TravelLeg"("toLocationId");

-- CreateIndex
CREATE INDEX "TravelStop_travelLegId_idx" ON "TravelStop"("travelLegId");

-- CreateIndex
CREATE INDEX "TravelStop_locationId_idx" ON "TravelStop"("locationId");

-- AddForeignKey: the leg lives and dies with its schedule item.
ALTER TABLE "TravelLeg" ADD CONSTRAINT "TravelLeg_scheduleItemId_fkey" FOREIGN KEY ("scheduleItemId") REFERENCES "ScheduleItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: deleting a location never drops a leg — the endpoint just clears.
ALTER TABLE "TravelLeg" ADD CONSTRAINT "TravelLeg_fromLocationId_fkey" FOREIGN KEY ("fromLocationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TravelLeg" ADD CONSTRAINT "TravelLeg_toLocationId_fkey" FOREIGN KEY ("toLocationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: stops cascade with the leg; a deleted location clears the link.
ALTER TABLE "TravelStop" ADD CONSTRAINT "TravelStop_travelLegId_fkey" FOREIGN KEY ("travelLegId") REFERENCES "TravelLeg"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TravelStop" ADD CONSTRAINT "TravelStop_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;
