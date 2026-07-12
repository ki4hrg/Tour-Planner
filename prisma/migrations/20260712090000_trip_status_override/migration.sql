-- Trip lifecycle is now derived from dates (GH #56): Planning → In progress →
-- Complete comes from startDate/endDate vs today, so the stored status shrinks to
-- a manual override: ACTIVE (normal, lifecycle derived) / ARCHIVED / CANCELLED.
-- Data-preserving mapping: ARCHIVED stays ARCHIVED; PLANNING / CONFIRMED /
-- IN_PROGRESS / COMPLETED all collapse to ACTIVE (their lifecycle re-derives from
-- the trip's dates). CANCELLED is new. The enum is rebuilt (rather than
-- ALTER TYPE ... ADD VALUE) so removed values actually go away.
CREATE TYPE "TripStatus_new" AS ENUM ('ACTIVE', 'ARCHIVED', 'CANCELLED');

ALTER TABLE "Trip" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Trip"
  ALTER COLUMN "status" TYPE "TripStatus_new"
  USING (
    CASE "status"::text
      WHEN 'ARCHIVED' THEN 'ARCHIVED'
      ELSE 'ACTIVE'
    END::"TripStatus_new"
  );

DROP TYPE "TripStatus";
ALTER TYPE "TripStatus_new" RENAME TO "TripStatus";

ALTER TABLE "Trip" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';
