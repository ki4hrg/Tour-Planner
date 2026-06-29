-- Scope a HOST_SITE share link to a single host site: the link then shows only
-- that location's schedule items + their bookings. Nullable — STAFF/PARTICIPANT
-- links leave it null and span the whole trip. Purely additive, no backfill.

-- AlterTable
ALTER TABLE "ShareLink" ADD COLUMN "locationId" TEXT;

-- CreateIndex
CREATE INDEX "ShareLink_locationId_idx" ON "ShareLink"("locationId");

-- AddForeignKey: deleting a location nulls the scope (link survives, unscoped).
ALTER TABLE "ShareLink" ADD CONSTRAINT "ShareLink_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;
