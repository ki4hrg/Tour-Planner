-- Add the `system` flag to ScheduleItemCategory: built-in, self-describing kinds
-- (Free time, Break) that are protected from edit/delete and special-cased in the
-- item form (prompt only for times + notes).
--
-- HAND-WRITTEN data step: production runs `prisma migrate deploy` (no seed), so the
-- "Break" row is inserted and both built-ins are flagged here. The seed upsert
-- mirrors this for fresh/`db push` databases.

-- AlterTable
ALTER TABLE "ScheduleItemCategory" ADD COLUMN "system" BOOLEAN NOT NULL DEFAULT false;

-- "Free time" ships from the initial seed; "Break" is new. Insert it if absent so
-- prod gets it without the seed (idempotent on the unique name).
INSERT INTO "ScheduleItemCategory" ("id", "name", "color", "sortOrder", "system")
VALUES ('sic_break', 'Break', '#5f7a6a', 55, true)
ON CONFLICT ("name") DO NOTHING;

-- Flag the two self-describing built-ins (covers DBs that already had these rows).
UPDATE "ScheduleItemCategory" SET "system" = true WHERE "name" IN ('Free time', 'Break');
