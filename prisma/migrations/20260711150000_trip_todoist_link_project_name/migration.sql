-- Denormalize the Todoist project name onto the per-user trip link so the trip
-- page can render it without a Todoist API call (GH #50). Nullable: existing
-- links backfill lazily when the picker next loads project options.
ALTER TABLE "TripTodoistLink" ADD COLUMN "todoistProjectName" TEXT;
