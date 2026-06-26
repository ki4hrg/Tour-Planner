-- Rename Site -> Location (Phase A of the Location/Host Site/Presentation/Stay refactor).
--
-- HAND-WRITTEN + DATA-PRESERVING — do NOT regenerate. This is a pure physical rename:
-- every table/column/constraint/index that referenced "Site" is renamed in place, so
-- all existing rows are kept. No data is copied or dropped.
--
-- The implicit m2m join tables are the fiddly part. Prisma names them "_AToB" with the
-- two model names in alphabetical order, and columns A/B in that same order:
--   _ContactToSite : A=Contact, B=Site   -> _ContactToLocation : A=Contact, B=Location
--                    (Contact < Location, so B still points at the renamed table)
--   _SiteToTripType: A=Site,   B=TripType-> _LocationToTripType: A=Location, B=TripType
--                    (Location < TripType, so A still points at the renamed table)
-- In both cases the A/B letter assignment is unchanged — only names are renamed.
--
-- Validated before commit via `prisma migrate diff --from-migrations … --to-schema-datamodel …
-- --exit-code` ("No difference detected") and a scratch-DB replay over seeded rows.
--
-- Fallback (NOT used): had the m2m renames proven fragile, we could have kept the DB
-- names with @@map("Site")/@map("siteId") and skipped this migration entirely, at the
-- cost of model/DB name divergence. The physical rename is preferred and is what runs.

-- 1. Base table + primary key
ALTER TABLE "Site" RENAME TO "Location";
ALTER INDEX "Site_pkey" RENAME TO "Location_pkey";

-- 2. Cost.siteId -> locationId
ALTER TABLE "Cost" RENAME COLUMN "siteId" TO "locationId";
ALTER TABLE "Cost" RENAME CONSTRAINT "Cost_siteId_fkey" TO "Cost_locationId_fkey";

-- 3. Booking.siteId -> locationId
ALTER TABLE "Booking" RENAME COLUMN "siteId" TO "locationId";
ALTER TABLE "Booking" RENAME CONSTRAINT "Booking_siteId_fkey" TO "Booking_locationId_fkey";
ALTER INDEX "Booking_siteId_idx" RENAME TO "Booking_locationId_idx";

-- 4. ScheduleItemSite.siteId -> locationId (model/table name kept; only the FK field renamed)
ALTER TABLE "ScheduleItemSite" RENAME COLUMN "siteId" TO "locationId";
ALTER TABLE "ScheduleItemSite" RENAME CONSTRAINT "ScheduleItemSite_siteId_fkey" TO "ScheduleItemSite_locationId_fkey";
ALTER INDEX "ScheduleItemSite_siteId_idx" RENAME TO "ScheduleItemSite_locationId_idx";
ALTER INDEX "ScheduleItemSite_scheduleItemId_siteId_key" RENAME TO "ScheduleItemSite_scheduleItemId_locationId_key";

-- 5. Implicit m2m: Contact <-> Location (was _ContactToSite). A=Contact, B=Location.
ALTER TABLE "_ContactToSite" RENAME TO "_ContactToLocation";
ALTER TABLE "_ContactToLocation" RENAME CONSTRAINT "_ContactToSite_A_fkey" TO "_ContactToLocation_A_fkey";
ALTER TABLE "_ContactToLocation" RENAME CONSTRAINT "_ContactToSite_B_fkey" TO "_ContactToLocation_B_fkey";
ALTER INDEX "_ContactToSite_AB_pkey" RENAME TO "_ContactToLocation_AB_pkey";
ALTER INDEX "_ContactToSite_B_index" RENAME TO "_ContactToLocation_B_index";

-- 6. Implicit m2m: Location <-> TripType (was _SiteToTripType). A=Location, B=TripType.
ALTER TABLE "_SiteToTripType" RENAME TO "_LocationToTripType";
ALTER TABLE "_LocationToTripType" RENAME CONSTRAINT "_SiteToTripType_A_fkey" TO "_LocationToTripType_A_fkey";
ALTER TABLE "_LocationToTripType" RENAME CONSTRAINT "_SiteToTripType_B_fkey" TO "_LocationToTripType_B_fkey";
ALTER INDEX "_SiteToTripType_AB_pkey" RENAME TO "_LocationToTripType_AB_pkey";
ALTER INDEX "_SiteToTripType_B_index" RENAME TO "_LocationToTripType_B_index";
