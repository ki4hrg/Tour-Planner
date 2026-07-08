-- Designate one contact as the primary/go-to person for a location. Nullable —
-- most venues can leave it unset. The primary should be one of the location's
-- linked contacts (enforced in app code); the FK only guarantees it points at a
-- real contact. Purely additive, no backfill. Renaming the implicit m2m relation
-- to its default name ("ContactToLocation") keeps the "_ContactToLocation" join
-- table unchanged, so this migration only adds the new column.

-- AlterTable
ALTER TABLE "Location" ADD COLUMN "primaryContactId" TEXT;

-- CreateIndex
CREATE INDEX "Location_primaryContactId_idx" ON "Location"("primaryContactId");

-- AddForeignKey: deleting the contact clears the designation (location survives).
ALTER TABLE "Location" ADD CONSTRAINT "Location_primaryContactId_fkey" FOREIGN KEY ("primaryContactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
