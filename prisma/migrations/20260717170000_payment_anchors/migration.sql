-- Payment installment anchors (GH #86 refinement): a due date is now `offsetValue`
-- `offsetUnit`s from a selectable `anchor` (EVENT_START = before trip start, the
-- original behavior; BOOKING = after the booking's bookedOn date; NONE = no
-- deadline). Data-preserving: existing rows are all EVENT_START in DAYs, so
-- offsetValue backfills verbatim from dueOffsetDays before that column is dropped.

-- CreateEnum
CREATE TYPE "PaymentAnchor" AS ENUM ('EVENT_START', 'BOOKING', 'NONE');
CREATE TYPE "PaymentOffsetUnit" AS ENUM ('DAY', 'WEEK', 'MONTH');

-- Booking: planner-set date the engagement was booked (BOOKING anchor date).
ALTER TABLE "Booking" ADD COLUMN "bookedOn" DATE;

-- ── PaymentScheduleItem ────────────────────────────────────────────────────
-- Add the new columns, backfill from the old offset, then drop it. EVENT_START's
-- offset keeps the same "days before start" sign as the retired dueOffsetDays.
ALTER TABLE "PaymentScheduleItem"
  ADD COLUMN "anchor" "PaymentAnchor" NOT NULL DEFAULT 'EVENT_START',
  ADD COLUMN "offsetValue" INTEGER,
  ADD COLUMN "offsetUnit" "PaymentOffsetUnit";

UPDATE "PaymentScheduleItem"
  SET "offsetValue" = "dueOffsetDays", "offsetUnit" = 'DAY';

ALTER TABLE "PaymentScheduleItem" DROP COLUMN "dueOffsetDays";

-- CHECK: NONE ⇒ no offset; any dated anchor ⇒ both offset fields present.
ALTER TABLE "PaymentScheduleItem" ADD CONSTRAINT "payment_schedule_anchor" CHECK (
  ("anchor" = 'NONE' AND "offsetValue" IS NULL AND "offsetUnit" IS NULL)
  OR ("anchor" <> 'NONE' AND "offsetValue" IS NOT NULL AND "offsetUnit" IS NOT NULL)
);

-- ── LocationPaymentScheduleItem (standing terms) ───────────────────────────
ALTER TABLE "LocationPaymentScheduleItem"
  ADD COLUMN "anchor" "PaymentAnchor" NOT NULL DEFAULT 'EVENT_START',
  ADD COLUMN "offsetValue" INTEGER,
  ADD COLUMN "offsetUnit" "PaymentOffsetUnit";

UPDATE "LocationPaymentScheduleItem"
  SET "offsetValue" = "dueOffsetDays", "offsetUnit" = 'DAY';

ALTER TABLE "LocationPaymentScheduleItem" DROP COLUMN "dueOffsetDays";

ALTER TABLE "LocationPaymentScheduleItem" ADD CONSTRAINT "location_payment_schedule_anchor" CHECK (
  ("anchor" = 'NONE' AND "offsetValue" IS NULL AND "offsetUnit" IS NULL)
  OR ("anchor" <> 'NONE' AND "offsetValue" IS NOT NULL AND "offsetUnit" IS NOT NULL)
);
