-- Google place link + coordinates on Location. Purely additive (nullable columns
-- plus a defaulted flag), so existing rows are untouched.
ALTER TABLE "Location" ADD COLUMN "googlePlaceId" TEXT,
ADD COLUMN "lat" DOUBLE PRECISION,
ADD COLUMN "lng" DOUBLE PRECISION,
ADD COLUMN "placeIdCheckedAt" TIMESTAMP(3),
ADD COLUMN "placeIdNeedsReview" BOOLEAN NOT NULL DEFAULT false;

-- Coordinates are both-or-neither and in range. Prisma does not model CHECK
-- constraints, so this is invisible to migrate-diff drift checks.
ALTER TABLE "Location" ADD CONSTRAINT "location_coordinates" CHECK (
  ("lat" IS NULL AND "lng" IS NULL)
  OR ("lat" IS NOT NULL AND "lng" IS NOT NULL
      AND "lat" BETWEEN -90 AND 90 AND "lng" BETWEEN -180 AND 180)
);
