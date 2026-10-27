-- Owner per workflow step: whose move it is once the booking reaches it (US =
-- the planner, VENUE = waiting on the venue). Purely additive: every existing
-- step defaults to US; admins re-assign at /admin/workflows.
CREATE TYPE "StepActor" AS ENUM ('US', 'VENUE');

ALTER TABLE "BookingWorkflowStep" ADD COLUMN "actor" "StepActor" NOT NULL DEFAULT 'US';
