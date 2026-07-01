-- Add two workflow statuses to the booking lifecycle. Full flow:
--   NOT_BOOKED → REQUESTED → TENTATIVELY_CONFIRMED → CONFIRMED → FINALIZED
-- (NOT_NEEDED remains the per-trip "skip this one").
--
-- Postgres forbids USING a newly-added enum value in the same transaction that
-- adds it, but ADDING values is fine — this migration only adds them (no rows
-- reference the new values yet), so a single migration step is safe. BEFORE/AFTER
-- position the values so the DB enum order matches schema.prisma.
ALTER TYPE "BookingStatus" ADD VALUE IF NOT EXISTS 'TENTATIVELY_CONFIRMED' BEFORE 'CONFIRMED';
ALTER TYPE "BookingStatus" ADD VALUE IF NOT EXISTS 'FINALIZED' AFTER 'CONFIRMED';
