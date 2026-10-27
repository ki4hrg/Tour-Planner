-- Fixed-time schedule items (a public event whose timing we don't control).
-- Purely additive: existing items stay movable.
ALTER TABLE "ScheduleItem" ADD COLUMN "fixedTime" BOOLEAN NOT NULL DEFAULT false;
