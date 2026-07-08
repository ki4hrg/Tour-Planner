-- Stay: dual-mode anchoring — absolute dates (dated trip) OR day indices (template).
-- Existing rows are all dated (checkIn/checkOut set, indices null), so they satisfy
-- the dated branch of the CHECK below without any backfill.

-- 1. Relax the NOT NULLs so a day-relative stay can leave the date columns empty.
ALTER TABLE "Stay" ALTER COLUMN "checkIn" DROP NOT NULL;
ALTER TABLE "Stay" ALTER COLUMN "checkOut" DROP NOT NULL;

-- 2. Add the 1-based day-index anchors (null on dated stays).
ALTER TABLE "Stay" ADD COLUMN "checkInDayIndex" INTEGER;
ALTER TABLE "Stay" ADD COLUMN "checkOutDayIndex" INTEGER;

-- 3. Enforce exactly one anchor mode: both dates set with no indices, OR both
--    indices set with no dates. (Prisma can't model CHECK constraints.)
ALTER TABLE "Stay" ADD CONSTRAINT "stay_anchor_mode" CHECK (
  (
    "checkIn" IS NOT NULL AND "checkOut" IS NOT NULL
    AND "checkInDayIndex" IS NULL AND "checkOutDayIndex" IS NULL
  )
  OR
  (
    "checkIn" IS NULL AND "checkOut" IS NULL
    AND "checkInDayIndex" IS NOT NULL AND "checkOutDayIndex" IS NOT NULL
  )
);
