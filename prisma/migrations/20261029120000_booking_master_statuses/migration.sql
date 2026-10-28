-- Booking master statuses: PENDING → IN_PROGRESS → CONFIRMED → FINALIZED, with
-- CANCELLED beside NOT_NEEDED as a manual override. PLANNED ("nothing done
-- yet") is the same state as PENDING, so it is renamed in place: every stored
-- row and the column default follow the label, no data rewrite.
ALTER TYPE "BookingStatus" RENAME VALUE 'PLANNED' TO 'PENDING';
ALTER TYPE "BookingStatus" ADD VALUE IF NOT EXISTS 'FINALIZED' AFTER 'CONFIRMED';
ALTER TYPE "BookingStatus" ADD VALUE IF NOT EXISTS 'CANCELLED' AFTER 'FINALIZED';
