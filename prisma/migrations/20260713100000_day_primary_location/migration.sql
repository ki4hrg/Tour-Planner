-- Default/primary location per day (GH #10): a planner can mark the venue most of a
-- day happens at, so the "add item" location picker pre-fills it. Purely additive and
-- nullable — existing days keep no default. SetNull so archiving/deleting a location
-- never cascades into days.

-- AlterTable
ALTER TABLE "ItineraryDay" ADD COLUMN "primaryLocationId" TEXT;

-- CreateIndex
CREATE INDEX "ItineraryDay_primaryLocationId_idx" ON "ItineraryDay"("primaryLocationId");

-- AddForeignKey: deleting/archiving the location clears the day's default (day survives).
ALTER TABLE "ItineraryDay" ADD CONSTRAINT "ItineraryDay_primaryLocationId_fkey" FOREIGN KEY ("primaryLocationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;
