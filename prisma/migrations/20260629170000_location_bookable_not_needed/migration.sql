-- Non-bookable sites + a "booking not needed" status.
--
-- HAND-WRITTEN but ADDITIVE: Location.bookable defaults true (existing rows become
-- bookable, no backfill needed) and a new BookingStatus value is appended. The
-- enum add is split out of any transaction block — Postgres forbids using a new
-- enum value in the same transaction it is added; we don't, but keeping it separate
-- is the safe, conventional form. Validated with `prisma migrate diff … --exit-code`.

-- AlterEnum
ALTER TYPE "BookingStatus" ADD VALUE 'NOT_NEEDED';

-- AlterTable
ALTER TABLE "Location" ADD COLUMN "bookable" BOOLEAN NOT NULL DEFAULT true;
