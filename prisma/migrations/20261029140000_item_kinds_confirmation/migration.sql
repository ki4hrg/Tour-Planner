-- Schedule-item kinds (which form fields a category shows), takeaway meal
-- providers, and per-item venue confirmation.
CREATE TYPE "ScheduleItemKind" AS ENUM ('VISIT', 'MEAL', 'PRESENTATION', 'TRAVEL', 'FREE', 'OTHER');
CREATE TYPE "ItemConfirmation" AS ENUM ('REQUESTED', 'CONFIRMED');

ALTER TABLE "ScheduleItemCategory"
  ADD COLUMN "kind" "ScheduleItemKind" NOT NULL DEFAULT 'OTHER';

-- Backfill from the seeded names; `system` previously meant the two
-- self-describing built-ins (Free time / Break), which become FREE.
UPDATE "ScheduleItemCategory" SET "kind" = 'FREE' WHERE "system";
UPDATE "ScheduleItemCategory" SET "kind" = 'VISIT', "system" = true WHERE lower("name") = 'visit';
UPDATE "ScheduleItemCategory" SET "kind" = 'MEAL', "system" = true WHERE lower("name") = 'meal';
UPDATE "ScheduleItemCategory" SET "kind" = 'PRESENTATION', "system" = true WHERE lower("name") = 'presentation';
UPDATE "ScheduleItemCategory" SET "kind" = 'TRAVEL', "system" = true WHERE lower("name") = 'travel';
-- Other meal-like admin categories ("Supper", "Packed lunch") show the meal fields.
UPDATE "ScheduleItemCategory" SET "kind" = 'MEAL'
WHERE "kind" = 'OTHER' AND "name" ~* 'meal|breakfast|lunch|dinner|supper';

ALTER TABLE "ScheduleItem"
  ADD COLUMN "mealProviderId" TEXT,
  ADD COLUMN "confirmation" "ItemConfirmation",
  ADD COLUMN "confirmedOn" DATE;

ALTER TABLE "ScheduleItem"
  ADD CONSTRAINT "ScheduleItem_mealProviderId_fkey" FOREIGN KEY ("mealProviderId")
  REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "ScheduleItem_mealProviderId_idx" ON "ScheduleItem"("mealProviderId");

-- Untitled meals take their meal as their name ("Lunch").
UPDATE "ScheduleItem"
SET "title" = CASE "mealKind"
    WHEN 'BREAKFAST' THEN 'Breakfast'
    WHEN 'LUNCH' THEN 'Lunch'
    WHEN 'DINNER' THEN 'Dinner'
    WHEN 'REFRESHMENTS' THEN 'Refreshments'
  END
WHERE "mealKind" IS NOT NULL AND ("title" IS NULL OR btrim("title") = '');

-- A meal taken during an en-route travel stop ("dinner on own at the services").
ALTER TABLE "TravelStop"
  ADD COLUMN "mealKind" "MealKind",
  ADD COLUMN "mealProvision" "MealProvision";
