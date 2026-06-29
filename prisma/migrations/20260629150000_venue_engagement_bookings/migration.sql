-- Retarget Booking from (scheduleItem XOR stay) to (scheduleItem XOR trip+location).
--
-- HAND-WRITTEN + DATA-PRESERVING — do NOT regenerate. A booking becomes a VENUE
-- ENGAGEMENT keyed on (trip, location) that auto-covers every schedule item in the
-- trip visiting that location PLUS any Stay there; lodging bookings are subsumed.
-- Site-less item bookings (coach) keep their scheduleItemId target.
--
-- Order matters: the new tripId column is added and existing stay bookings are
-- backfilled into (trip, location) engagements BEFORE stayId is dropped, so no
-- lodging booking is lost.
--
-- Validated before commit: `prisma migrate diff --from-migrations … --to-schema-datamodel
-- … --exit-code` ("No difference detected"). The @@unique([tripId, locationId]) and the
-- locationId onDelete change (SetNull -> Cascade) ARE modeled and appear below; the two
-- CHECK constraints are NOT modeled by Prisma, so they are invisible to the diff.

-- 1. New venue-engagement target column.
ALTER TABLE "Booking" ADD COLUMN "tripId" TEXT;

-- 2. Backfill: each stay booking (Stay->Booking is 1:1) becomes a (trip, location)
--    engagement at the stay's location.
UPDATE "Booking" b
SET "tripId" = s."tripId", "locationId" = s."locationId", "stayId" = NULL
FROM "Stay" s
WHERE b."stayId" = s."id";

-- 3. Dedup safeguard before the unique index: if two former stay bookings now collide
--    on (tripId, locationId), keep the most-advanced status (CONFIRMED > REQUESTED >
--    NOT_BOOKED), tie-broken by oldest createdAt, and delete the rest. No-op on clean
--    data (item bookings have NULL tripId and never collide).
DELETE FROM "Booking"
WHERE "tripId" IS NOT NULL
  AND "id" NOT IN (
    SELECT DISTINCT ON ("tripId", "locationId") "id"
    FROM "Booking"
    WHERE "tripId" IS NOT NULL
    ORDER BY "tripId", "locationId",
      CASE "status" WHEN 'CONFIRMED' THEN 2 WHEN 'REQUESTED' THEN 1 ELSE 0 END DESC,
      "createdAt" ASC
  );

-- 4. Drop the old stay target. The old CHECK references stayId, so drop it first
--    (DROP COLUMN would cascade-drop it anyway; explicit is clearer).
ALTER TABLE "Booking" DROP CONSTRAINT "Booking_one_target_chk";
ALTER TABLE "Booking" DROP CONSTRAINT "Booking_stayId_fkey";
DROP INDEX "Booking_stayId_key";
ALTER TABLE "Booking" DROP COLUMN "stayId";

-- 5. Wire up the trip target + one-engagement-per-venue uniqueness. (NULL tripId rows
--    are distinct in Postgres, so site-less item bookings are unconstrained.)
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_tripId_fkey"
  FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "Booking_tripId_idx" ON "Booking"("tripId");
CREATE UNIQUE INDEX "Booking_tripId_locationId_key" ON "Booking"("tripId", "locationId");

-- 6. An engagement requires its location to exist; locations are archived, not hard
--    deleted, but SetNull would violate the venue-has-location CHECK — use Cascade.
ALTER TABLE "Booking" DROP CONSTRAINT "Booking_locationId_fkey";
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 7. Enforce the new target rule (invisible to migrate-diff — Prisma can't model CHECK).
--    Existing rows post-backfill satisfy these: item bookings have scheduleItemId only;
--    engagements have tripId + locationId.
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_one_target_chk"
  CHECK (num_nonnulls("scheduleItemId", "tripId") = 1);
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_venue_has_location_chk"
  CHECK ("tripId" IS NULL OR "locationId" IS NOT NULL);
