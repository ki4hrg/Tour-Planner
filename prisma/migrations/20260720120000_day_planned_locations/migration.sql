-- Rough scheduling (GH #9): assign locations to a day WITHOUT committing to timed
-- schedule items — a coarse "we'll be in this city seeing A, B, C" layer that later
-- firms up into real ScheduleItems. New join table, purely additive.
--
-- onDelete Cascade on both sides mirrors ScheduleItemSite: a hard-deleted location
-- drops its rough assignments. (A location present in any rough plan is archived
-- rather than hard-deleted — see deleteLocation — so this cascade only fires for
-- genuinely unreferenced venues.)

-- CreateTable
CREATE TABLE "ItineraryDayLocation" (
    "id" TEXT NOT NULL,
    "dayId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,

    CONSTRAINT "ItineraryDayLocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: one rough assignment per (day, location).
CREATE UNIQUE INDEX "ItineraryDayLocation_dayId_locationId_key" ON "ItineraryDayLocation"("dayId", "locationId");

-- CreateIndex
CREATE INDEX "ItineraryDayLocation_dayId_idx" ON "ItineraryDayLocation"("dayId");

-- CreateIndex
CREATE INDEX "ItineraryDayLocation_locationId_idx" ON "ItineraryDayLocation"("locationId");

-- AddForeignKey: the rough assignment lives and dies with its day.
ALTER TABLE "ItineraryDayLocation" ADD CONSTRAINT "ItineraryDayLocation_dayId_fkey" FOREIGN KEY ("dayId") REFERENCES "ItineraryDay"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: dropping an (unreferenced) location clears its rough assignments.
ALTER TABLE "ItineraryDayLocation" ADD CONSTRAINT "ItineraryDayLocation_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
