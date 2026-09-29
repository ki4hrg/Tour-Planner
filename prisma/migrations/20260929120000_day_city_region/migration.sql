-- Primary city per itinerary day (a Region node). Purely additive: a nullable
-- column, so existing days keep the export's derived city until one is set.
ALTER TABLE "ItineraryDay" ADD COLUMN "cityRegionId" TEXT;

-- CreateIndex
CREATE INDEX "ItineraryDay_cityRegionId_idx" ON "ItineraryDay"("cityRegionId");

-- AddForeignKey
ALTER TABLE "ItineraryDay" ADD CONSTRAINT "ItineraryDay_cityRegionId_fkey" FOREIGN KEY ("cityRegionId") REFERENCES "Region"("id") ON DELETE SET NULL ON UPDATE CASCADE;
