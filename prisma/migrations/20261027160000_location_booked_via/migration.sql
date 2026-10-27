-- "Booked via" parent venue: a child Location's sessions and stays are covered
-- by the parent's (trip, parent) venue engagement. Purely additive.
-- Single-level nesting (a parent has no parent) is enforced in the app; the
-- not-self rule is a CHECK (invisible to prisma migrate diff — verify by hand).
ALTER TABLE "Location" ADD COLUMN "bookedViaId" TEXT;

CREATE INDEX "Location_bookedViaId_idx" ON "Location"("bookedViaId");

ALTER TABLE "Location" ADD CONSTRAINT "Location_bookedViaId_fkey" FOREIGN KEY ("bookedViaId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Location" ADD CONSTRAINT "location_booked_via_not_self" CHECK ("bookedViaId" IS NULL OR "bookedViaId" <> "id");
