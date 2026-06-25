-- Refactor: split the booking concern off the itinerary line, support multiple
-- sites + bookings per line, and add admin-configurable categories + presenters.
--
-- `Stop` is RENAMED to `ScheduleItem` (data preserved, not dropped). Its single
-- `siteId` and inline booking fields are migrated into the new `ScheduleItemSite`
-- and `Booking` tables, then dropped. See GH #2 / #5.

-- CreateTable: ScheduleItemCategory (admin-configurable kinds)
CREATE TABLE "ScheduleItemCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScheduleItemCategory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ScheduleItemCategory_name_key" ON "ScheduleItemCategory"("name");

-- Seed a starter set of categories (admins can edit/extend these afterwards).
INSERT INTO "ScheduleItemCategory" ("id", "name", "color", "sortOrder") VALUES
    ('sic_visit',         'Visit',         '#2e5e4e', 10),
    ('sic_presentation',  'Presentation',  '#a9762f', 20),
    ('sic_meal',          'Meal',          '#9b342b', 30),
    ('sic_travel',        'Travel',        '#6b7269', 40),
    ('sic_freetime',      'Free time',     '#46685c', 50),
    ('sic_reception',     'Reception',     '#7c5a9e', 60),
    ('sic_worship',       'Worship',       '#3b6ea5', 70),
    ('sic_accommodation', 'Accommodation', '#8a6d3b', 80),
    ('sic_other',         'Other',         NULL,      90);

-- CreateTable: ScheduleItemSite (item <-> site join)
CREATE TABLE "ScheduleItemSite" (
    "id" TEXT NOT NULL,
    "scheduleItemId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ScheduleItemSite_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ScheduleItemSite_scheduleItemId_idx" ON "ScheduleItemSite"("scheduleItemId");
CREATE INDEX "ScheduleItemSite_siteId_idx" ON "ScheduleItemSite"("siteId");
CREATE UNIQUE INDEX "ScheduleItemSite_scheduleItemId_siteId_key" ON "ScheduleItemSite"("scheduleItemId", "siteId");

-- CreateTable: Booking (status column uses the existing enum for now; trimmed below)
CREATE TABLE "Booking" (
    "id" TEXT NOT NULL,
    "scheduleItemId" TEXT NOT NULL,
    "siteId" TEXT,
    "label" TEXT,
    "status" "BookingStatus" NOT NULL DEFAULT 'NOT_BOOKED',
    "bookedContactId" TEXT,
    "confirmationRef" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Booking_scheduleItemId_idx" ON "Booking"("scheduleItemId");
CREATE INDEX "Booking_siteId_idx" ON "Booking"("siteId");

-- Rename Stop -> ScheduleItem, preserving data.
ALTER TABLE "Stop" RENAME TO "ScheduleItem";
ALTER TABLE "ScheduleItem" RENAME CONSTRAINT "Stop_pkey" TO "ScheduleItem_pkey";
ALTER TABLE "ScheduleItem" RENAME COLUMN "scheduleNotes" TO "notes";
ALTER INDEX "Stop_dayId_idx" RENAME TO "ScheduleItem_dayId_idx";
ALTER TABLE "ScheduleItem" RENAME CONSTRAINT "Stop_dayId_fkey" TO "ScheduleItem_dayId_fkey";

-- Drop the FKs/index tied to columns that are moving out of the item.
ALTER TABLE "ScheduleItem" DROP CONSTRAINT "Stop_siteId_fkey";
ALTER TABLE "ScheduleItem" DROP CONSTRAINT "Stop_bookedContactId_fkey";
DROP INDEX "Stop_siteId_idx";

-- New item columns.
ALTER TABLE "ScheduleItem" ADD COLUMN "categoryId" TEXT;
ALTER TABLE "ScheduleItem" ADD COLUMN "isBlock" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ScheduleItem" ADD COLUMN "presenterContactId" TEXT;

CREATE INDEX "ScheduleItem_categoryId_idx" ON "ScheduleItem"("categoryId");
CREATE INDEX "ScheduleItem_presenterContactId_idx" ON "ScheduleItem"("presenterContactId");

-- Backfill: each item's single site -> one join row.
INSERT INTO "ScheduleItemSite" ("id", "scheduleItemId", "siteId", "order")
SELECT gen_random_uuid()::text, "id", "siteId", 0
FROM "ScheduleItem"
WHERE "siteId" IS NOT NULL;

-- Backfill: synthesize a Booking only where booking was actually being tracked.
-- NOT_NEEDED -> none; NOT_BOOKED with no contact/ref/notes -> none (informational).
INSERT INTO "Booking" ("id", "scheduleItemId", "siteId", "status", "bookedContactId", "confirmationRef", "notes", "createdAt", "updatedAt")
SELECT
    gen_random_uuid()::text, "id", "siteId", "bookingStatus", "bookedContactId", "confirmationRef", "bookingNotes",
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "ScheduleItem"
WHERE "bookingStatus" <> 'NOT_NEEDED'
  AND ("bookingStatus" IN ('REQUESTED', 'CONFIRMED')
       OR "bookedContactId" IS NOT NULL
       OR "confirmationRef" IS NOT NULL
       OR "bookingNotes" IS NOT NULL);

-- Backfill: a sensible default category (site-bearing -> Visit, else Other).
UPDATE "ScheduleItem"
SET "categoryId" = CASE WHEN "siteId" IS NOT NULL THEN 'sic_visit' ELSE 'sic_other' END;

-- Drop the migrated-out columns.
ALTER TABLE "ScheduleItem" DROP COLUMN "siteId";
ALTER TABLE "ScheduleItem" DROP COLUMN "bookingStatus";
ALTER TABLE "ScheduleItem" DROP COLUMN "bookingNotes";
ALTER TABLE "ScheduleItem" DROP COLUMN "bookedContactId";
ALTER TABLE "ScheduleItem" DROP COLUMN "confirmationRef";

-- AlterEnum: drop NOT_NEEDED now that only Booking.status references BookingStatus.
BEGIN;
CREATE TYPE "BookingStatus_new" AS ENUM ('NOT_BOOKED', 'REQUESTED', 'CONFIRMED');
ALTER TABLE "Booking" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Booking" ALTER COLUMN "status" TYPE "BookingStatus_new" USING ("status"::text::"BookingStatus_new");
ALTER TYPE "BookingStatus" RENAME TO "BookingStatus_old";
ALTER TYPE "BookingStatus_new" RENAME TO "BookingStatus";
ALTER TABLE "Booking" ALTER COLUMN "status" SET DEFAULT 'NOT_BOOKED';
DROP TYPE "BookingStatus_old";
COMMIT;

-- AddForeignKey
ALTER TABLE "ScheduleItem" ADD CONSTRAINT "ScheduleItem_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ScheduleItemCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ScheduleItem" ADD CONSTRAINT "ScheduleItem_presenterContactId_fkey" FOREIGN KEY ("presenterContactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ScheduleItemSite" ADD CONSTRAINT "ScheduleItemSite_scheduleItemId_fkey" FOREIGN KEY ("scheduleItemId") REFERENCES "ScheduleItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScheduleItemSite" ADD CONSTRAINT "ScheduleItemSite_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_scheduleItemId_fkey" FOREIGN KEY ("scheduleItemId") REFERENCES "ScheduleItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_bookedContactId_fkey" FOREIGN KEY ("bookedContactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
