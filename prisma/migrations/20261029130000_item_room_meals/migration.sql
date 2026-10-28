-- Rooms within a venue + structured meals on schedule items.
CREATE TYPE "MealKind" AS ENUM ('BREAKFAST', 'LUNCH', 'DINNER', 'REFRESHMENTS');
CREATE TYPE "MealProvision" AS ENUM ('VENUE', 'TAKEAWAY', 'RESTAURANT', 'ON_OWN');

ALTER TABLE "ScheduleItem"
  ADD COLUMN "room" TEXT,
  ADD COLUMN "mealKind" "MealKind",
  ADD COLUMN "mealProvision" "MealProvision";

-- Backfill: meal-category items get their meal from the title ("Packed
-- Breakfast", "Sunday Roast", "Supper en route"), defaulting to the time of day.
UPDATE "ScheduleItem" i
SET "mealKind" = CASE
    WHEN i."title" ~* 'breakfast' THEN 'BREAKFAST'
    WHEN i."title" ~* 'lunch|roast' THEN 'LUNCH'
    WHEN i."title" ~* 'supper|dinner|banquet' THEN 'DINNER'
    WHEN i."title" ~* 'tea|coffee|refreshment|reception|drinks' THEN 'REFRESHMENTS'
    WHEN i."startTime" < '10:30' THEN 'BREAKFAST'
    WHEN i."startTime" < '16:00' THEN 'LUNCH'
    WHEN i."startTime" IS NOT NULL THEN 'DINNER'
    ELSE NULL
  END::"MealKind"
FROM "ScheduleItemCategory" c
WHERE c."id" = i."categoryId" AND lower(c."name") = 'meal';

-- Provision only where it is clear: a packed / take-away meal, else a meal
-- at a host site that provides meals is served by the venue.
UPDATE "ScheduleItem"
SET "mealProvision" = 'TAKEAWAY'
WHERE "mealKind" IS NOT NULL AND "title" ~* 'packed|take-?away';

UPDATE "ScheduleItem" i
SET "mealProvision" = 'VENUE'
WHERE i."mealKind" IS NOT NULL
  AND i."mealProvision" IS NULL
  AND EXISTS (
    SELECT 1
    FROM "ScheduleItemSite" s
    JOIN "HostSite" h ON h."locationId" = s."locationId"
    WHERE s."scheduleItemId" = i."id" AND h."providesMeals"
  );
