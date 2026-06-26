-- Phase B of the Location/Host Site/Presentation/Stay refactor.
--
-- HAND-WRITTEN + DATA-PRESERVING — do NOT regenerate. Prisma's generated DDL drops
-- ScheduleItem.presenterContactId with no backfill; here the new `_Presenting` m2m
-- join table is created and backfilled from the old single-presenter FK BEFORE the
-- column is dropped, so no presenter assignment is lost. A bare presenter is simply
-- an occurrence speaker — NO catalog Presentation rows are synthesised.
--
-- Adds: HostSite (1:1 ext of Location), Presentation (reusable catalog) + its
-- defaultPresenters m2m, Stay (per-trip lodging) + BoardType enum, ItineraryDay
-- .participantNotes, ScheduleItem.presentationId + presenters m2m, and Booking
-- targeting either a schedule item OR a stay (scheduleItemId now nullable, new
-- nullable+unique stayId, with a CHECK enforcing exactly one of the two).
--
-- ShareAudience.VENUE -> HOST_SITE is a pure enum rename (no ShareLink rows exist).
--
-- Validated before commit: `prisma migrate diff --from-migrations … --to-schema-datamodel
-- … --exit-code` ("No difference detected"; Prisma does not model CHECK constraints,
-- so the added CHECK is invisible to the diff) + scratch-DB replay over seeded rows.

-- CreateEnum
CREATE TYPE "BoardType" AS ENUM ('NONE', 'BED_AND_BREAKFAST', 'HALF_BOARD', 'FULL_BOARD');

-- AlterEnum: ShareAudience VENUE -> HOST_SITE (no data; M7 ShareLinks not built yet)
BEGIN;
CREATE TYPE "ShareAudience_new" AS ENUM ('STAFF', 'PARTICIPANT', 'HOST_SITE');
ALTER TABLE "public"."ShareLink" ALTER COLUMN "audience" DROP DEFAULT;
ALTER TABLE "ShareLink" ALTER COLUMN "audience" TYPE "ShareAudience_new" USING ("audience"::text::"ShareAudience_new");
ALTER TYPE "ShareAudience" RENAME TO "ShareAudience_old";
ALTER TYPE "ShareAudience_new" RENAME TO "ShareAudience";
DROP TYPE "public"."ShareAudience_old";
ALTER TABLE "ShareLink" ALTER COLUMN "audience" SET DEFAULT 'PARTICIPANT';
COMMIT;

-- CreateTable
CREATE TABLE "HostSite" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "providesLodging" BOOLEAN NOT NULL DEFAULT false,
    "providesMeals" BOOLEAN NOT NULL DEFAULT false,
    "providesMeetingSpace" BOOLEAN NOT NULL DEFAULT false,
    "staffNotes" TEXT,
    "logisticsNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HostSite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Presentation" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "notes" TEXT,
    "durationMinutes" INTEGER,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Presentation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Stay" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "label" TEXT,
    "checkIn" DATE NOT NULL,
    "checkOut" DATE NOT NULL,
    "arrivalTime" TEXT,
    "departureTime" TEXT,
    "board" "BoardType" NOT NULL DEFAULT 'NONE',
    "headcount" INTEGER,
    "costPerPersonPerNight" DECIMAL(10,2),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Stay_pkey" PRIMARY KEY ("id")
);

-- CreateTable (implicit m2m; A=Contact, B=ScheduleItem — occurrence speaker override)
CREATE TABLE "_Presenting" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_Presenting_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable (implicit m2m; A=Contact, B=Presentation — usual speakers)
CREATE TABLE "_PresentationDefaults" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_PresentationDefaults_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "HostSite_locationId_key" ON "HostSite"("locationId");
CREATE INDEX "Stay_tripId_idx" ON "Stay"("tripId");
CREATE INDEX "Stay_locationId_idx" ON "Stay"("locationId");
CREATE INDEX "_Presenting_B_index" ON "_Presenting"("B");
CREATE INDEX "_PresentationDefaults_B_index" ON "_PresentationDefaults"("B");

-- AddForeignKey
ALTER TABLE "HostSite" ADD CONSTRAINT "HostSite_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Stay" ADD CONSTRAINT "Stay_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Stay" ADD CONSTRAINT "Stay_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "_Presenting" ADD CONSTRAINT "_Presenting_A_fkey" FOREIGN KEY ("A") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_Presenting" ADD CONSTRAINT "_Presenting_B_fkey" FOREIGN KEY ("B") REFERENCES "ScheduleItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_PresentationDefaults" ADD CONSTRAINT "_PresentationDefaults_A_fkey" FOREIGN KEY ("A") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_PresentationDefaults" ADD CONSTRAINT "_PresentationDefaults_B_fkey" FOREIGN KEY ("B") REFERENCES "Presentation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: carry each item's single presenter into the new _Presenting m2m
-- (Contact = A, ScheduleItem = B). Done BEFORE dropping the old column. No catalog
-- Presentation rows are synthesised — a bare presenter is just an occurrence speaker.
INSERT INTO "_Presenting" ("A", "B")
SELECT "presenterContactId", "id"
FROM "ScheduleItem"
WHERE "presenterContactId" IS NOT NULL;

-- Now retire the old single-presenter FK/index/column on ScheduleItem
ALTER TABLE "ScheduleItem" DROP CONSTRAINT "ScheduleItem_presenterContactId_fkey";
DROP INDEX "ScheduleItem_presenterContactId_idx";
ALTER TABLE "ScheduleItem" DROP COLUMN "presenterContactId",
ADD COLUMN     "presentationId" TEXT;

-- CreateIndex + FK for the new catalogued-talk link
CREATE INDEX "ScheduleItem_presentationId_idx" ON "ScheduleItem"("presentationId");
ALTER TABLE "ScheduleItem" ADD CONSTRAINT "ScheduleItem_presentationId_fkey" FOREIGN KEY ("presentationId") REFERENCES "Presentation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ItineraryDay: participant-facing free text
ALTER TABLE "ItineraryDay" ADD COLUMN     "participantNotes" TEXT;

-- Booking can now target a stay instead of a schedule item.
ALTER TABLE "Booking" ADD COLUMN     "stayId" TEXT,
ALTER COLUMN "scheduleItemId" DROP NOT NULL;
CREATE UNIQUE INDEX "Booking_stayId_key" ON "Booking"("stayId");
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_stayId_fkey" FOREIGN KEY ("stayId") REFERENCES "Stay"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Enforce exactly one target (item XOR stay). Existing rows all have scheduleItemId
-- (stayId null) so they already satisfy num_nonnulls(...) = 1. Prisma cannot model
-- CHECK constraints, so this is invisible to migrate-diff drift checks.
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_one_target_chk" CHECK (num_nonnulls("scheduleItemId", "stayId") = 1);
