-- Admin-defined booking workflows replace the fixed five-step BookingStatus.
-- Data-preserving and hand-ordered: the new tables are created and backfilled
-- from the OLD status values BEFORE the enum is swapped for the coarse one.
--
-- Every existing booking is put on a seeded "Standard booking" workflow whose
-- steps mirror the old statuses, with completions for each step its old status
-- had passed (dated from the booking's updatedAt — the best date on record). An
-- admin can then rename/re-cut those steps; completions follow the step rows.

-- New coarse enum, created alongside the old one until the swap below.
CREATE TYPE "BookingStatus_new" AS ENUM ('PLANNED', 'IN_PROGRESS', 'CONFIRMED', 'NOT_NEEDED');

-- CreateTable
CREATE TABLE "BookingWorkflow" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BookingWorkflow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingWorkflowStep" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "status" "BookingStatus_new" NOT NULL DEFAULT 'IN_PROGRESS',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BookingWorkflowStep_pkey" PRIMARY KEY ("id"),
    -- A step can only move a booking forward to underway or secured; PLANNED is
    -- "nothing done" and NOT_NEEDED is a manual override.
    CONSTRAINT "booking_workflow_step_status" CHECK ("status" IN ('IN_PROGRESS', 'CONFIRMED'))
);

-- CreateTable
CREATE TABLE "BookingStepCompletion" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "completedOn" DATE NOT NULL,
    "completedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingStepCompletion_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN "stageLabel" TEXT,
ADD COLUMN "stageOn" DATE,
ADD COLUMN "workflowId" TEXT;

-- AlterTable
ALTER TABLE "Location" ADD COLUMN "defaultWorkflowId" TEXT;

-- Seed the Standard workflow (the global default) from the old status ladder.
INSERT INTO "BookingWorkflow" ("id", "name", "isDefault", "sortOrder", "updatedAt")
VALUES ('wf_standard_booking', 'Standard booking', true, 0, CURRENT_TIMESTAMP);

INSERT INTO "BookingWorkflowStep" ("id", "workflowId", "label", "sortOrder", "status", "updatedAt") VALUES
  ('wfs_standard_requested', 'wf_standard_booking', 'Requested', 0, 'IN_PROGRESS', CURRENT_TIMESTAMP),
  ('wfs_standard_tentative', 'wf_standard_booking', 'Tentatively confirmed', 1, 'IN_PROGRESS', CURRENT_TIMESTAMP),
  ('wfs_standard_confirmed', 'wf_standard_booking', 'Confirmed', 2, 'CONFIRMED', CURRENT_TIMESTAMP),
  ('wfs_standard_finalized', 'wf_standard_booking', 'Finalized', 3, 'CONFIRMED', CURRENT_TIMESTAMP);

UPDATE "Booking" SET "workflowId" = 'wf_standard_booking';

-- One completion per step the old status had reached. md5 ids are unique per
-- (booking, step) and never collide with cuids.
INSERT INTO "BookingStepCompletion" ("id", "bookingId", "stepId", "completedOn")
SELECT md5(b."id" || s."id"), b."id", s."id", b."updatedAt"::date
FROM "Booking" b
JOIN "BookingWorkflowStep" s ON s."workflowId" = 'wf_standard_booking'
WHERE s."sortOrder" < CASE b."status"::text
    WHEN 'REQUESTED' THEN 1
    WHEN 'TENTATIVELY_CONFIRMED' THEN 2
    WHEN 'CONFIRMED' THEN 3
    WHEN 'FINALIZED' THEN 4
    ELSE 0
  END;

-- Stage = the furthest step reached.
UPDATE "Booking" b SET
  "stageLabel" = CASE b."status"::text
    WHEN 'REQUESTED' THEN 'Requested'
    WHEN 'TENTATIVELY_CONFIRMED' THEN 'Tentatively confirmed'
    WHEN 'CONFIRMED' THEN 'Confirmed'
    WHEN 'FINALIZED' THEN 'Finalized'
  END,
  "stageOn" = CASE WHEN b."status"::text IN ('REQUESTED', 'TENTATIVELY_CONFIRMED', 'CONFIRMED', 'FINALIZED')
    THEN b."updatedAt"::date END;

-- Swap the enum: map the old ladder onto the coarse statuses.
ALTER TABLE "Booking" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Booking" ALTER COLUMN "status" TYPE "BookingStatus_new" USING (
  CASE "status"::text
    WHEN 'NOT_BOOKED' THEN 'PLANNED'
    WHEN 'REQUESTED' THEN 'IN_PROGRESS'
    WHEN 'TENTATIVELY_CONFIRMED' THEN 'IN_PROGRESS'
    WHEN 'CONFIRMED' THEN 'CONFIRMED'
    WHEN 'FINALIZED' THEN 'CONFIRMED'
    ELSE 'NOT_NEEDED'
  END::"BookingStatus_new"
);
ALTER TYPE "BookingStatus" RENAME TO "BookingStatus_old";
ALTER TYPE "BookingStatus_new" RENAME TO "BookingStatus";
DROP TYPE "BookingStatus_old";
ALTER TABLE "Booking" ALTER COLUMN "status" SET DEFAULT 'PLANNED';

-- CreateIndex
CREATE INDEX "BookingWorkflowStep_workflowId_idx" ON "BookingWorkflowStep"("workflowId");

-- CreateIndex
CREATE INDEX "BookingStepCompletion_stepId_idx" ON "BookingStepCompletion"("stepId");

-- CreateIndex
CREATE INDEX "BookingStepCompletion_completedById_idx" ON "BookingStepCompletion"("completedById");

-- CreateIndex
CREATE UNIQUE INDEX "BookingStepCompletion_bookingId_stepId_key" ON "BookingStepCompletion"("bookingId", "stepId");

-- CreateIndex
CREATE INDEX "Booking_workflowId_idx" ON "Booking"("workflowId");

-- CreateIndex
CREATE INDEX "Location_defaultWorkflowId_idx" ON "Location"("defaultWorkflowId");

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_defaultWorkflowId_fkey" FOREIGN KEY ("defaultWorkflowId") REFERENCES "BookingWorkflow"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "BookingWorkflow"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingWorkflowStep" ADD CONSTRAINT "BookingWorkflowStep_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "BookingWorkflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingStepCompletion" ADD CONSTRAINT "BookingStepCompletion_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingStepCompletion" ADD CONSTRAINT "BookingStepCompletion_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "BookingWorkflowStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingStepCompletion" ADD CONSTRAINT "BookingStepCompletion_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
