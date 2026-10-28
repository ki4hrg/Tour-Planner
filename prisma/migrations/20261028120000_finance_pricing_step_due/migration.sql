-- Trip-overview polish: a trip-level default currency, active dates on venue
-- list prices, and due offsets on workflow steps. Purely additive and
-- data-preserving: every new column is nullable or defaulted, and the trip
-- default currency backfills from the first entry of each trip's currency set.

-- ── Trip.defaultCurrency ───────────────────────────────────────────────────
-- The currency new stays, bookings and price lines on the trip start in; one
-- of `currencies` (enforced by the validator, not the DB).
ALTER TABLE "Trip" ADD COLUMN "defaultCurrency" TEXT NOT NULL DEFAULT 'USD';

UPDATE "Trip"
  SET "defaultCurrency" = "currencies"[1]
  WHERE cardinality("currencies") > 0;

-- ── Cost validity window ───────────────────────────────────────────────────
-- A list price applies to a trip whose start date falls inside
-- [validFrom, validTo] (either bound open; undated = always). A known future
-- price change is a second, dated line beside the current one.
ALTER TABLE "Cost"
  ADD COLUMN "validFrom" DATE,
  ADD COLUMN "validTo" DATE;

ALTER TABLE "Cost" ADD CONSTRAINT "cost_validity_order" CHECK (
  "validFrom" IS NULL OR "validTo" IS NULL OR "validFrom" <= "validTo"
);

-- ── BookingWorkflowStep due offset ─────────────────────────────────────────
-- When a step falls due: dueOffsetValue dueOffsetUnits BEFORE the trip's start
-- date (both set or neither). Until then the step isn't anyone's move yet.
ALTER TABLE "BookingWorkflowStep"
  ADD COLUMN "dueOffsetValue" INTEGER,
  ADD COLUMN "dueOffsetUnit" "PaymentOffsetUnit";

ALTER TABLE "BookingWorkflowStep" ADD CONSTRAINT "booking_workflow_step_due" CHECK (
  ("dueOffsetValue" IS NULL) = ("dueOffsetUnit" IS NULL)
);
