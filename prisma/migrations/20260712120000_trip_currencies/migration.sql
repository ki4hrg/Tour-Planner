-- Per-trip currency vocabulary (GH #11): trip-scoped currency pickers offer the
-- trip's own currency set instead of free text. Backfill each trip with its trip
-- type's default currency plus any currencies its stays / priced engagement
-- bookings already use, so existing values stay selectable.
ALTER TABLE "Trip" ADD COLUMN "currencies" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE "Trip" t
SET "currencies" = ARRAY(
  SELECT DISTINCT c FROM (
    SELECT tt."defaultCurrency" AS c
    FROM "TripType" tt
    WHERE tt.id = t."tripTypeId"
    UNION
    SELECT s."currency"
    FROM "Stay" s
    WHERE s."tripId" = t.id
    UNION
    SELECT b."agreedCurrency"
    FROM "Booking" b
    WHERE b."tripId" = t.id AND b."agreedAmount" IS NOT NULL
  ) x
  ORDER BY c
);
