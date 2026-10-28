-- A workflow step may now reach FINALIZED. Kept apart from the enum change:
-- a value added by ALTER TYPE ... ADD VALUE can't be used in the transaction
-- that added it, and this CHECK uses it.
ALTER TABLE "BookingWorkflowStep" DROP CONSTRAINT "booking_workflow_step_status";
ALTER TABLE "BookingWorkflowStep"
  ADD CONSTRAINT "booking_workflow_step_status"
  CHECK ("status" IN ('IN_PROGRESS', 'CONFIRMED', 'FINALIZED'));

-- The seeded "Standard booking" workflow (20261027120000_booking_workflows)
-- has a "Finalized" step that could only reach CONFIRMED until now. Point it
-- at FINALIZED — only while it is still the seeded step, untouched — and
-- lift the stored status of bookings that already completed it (the stored
-- status is the furthest step reached; CANCELLED / NOT_NEEDED overrides stay).
UPDATE "BookingWorkflowStep"
SET "status" = 'FINALIZED', "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'wfs_standard_finalized'
  AND "label" = 'Finalized'
  AND "status" = 'CONFIRMED';

UPDATE "Booking" b
SET "status" = 'FINALIZED', "updatedAt" = CURRENT_TIMESTAMP
WHERE b."status" = 'CONFIRMED'
  AND EXISTS (
    SELECT 1
    FROM "BookingStepCompletion" c
    JOIN "BookingWorkflowStep" s ON s."id" = c."stepId"
    WHERE c."bookingId" = b."id"
      AND s."workflowId" = b."workflowId"
      AND s."status" = 'FINALIZED'
  );
