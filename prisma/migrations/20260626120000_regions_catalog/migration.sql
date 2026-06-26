-- Regions catalog: admin-managed, hierarchical (parent/child), assignable to many
-- trip types. Location.region moves from free text to a Region relation; existing
-- distinct region strings are migrated into top-level Region rows (data preserved).

-- CreateTable
CREATE TABLE "Region" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Region_pkey" PRIMARY KEY ("id")
);

-- CreateTable (implicit m2m; A=Region, B=TripType — regions a trip type plans in)
CREATE TABLE "_RegionTripTypes" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_RegionTripTypes_AB_pkey" PRIMARY KEY ("A","B")
);

-- AlterTable
ALTER TABLE "Location" ADD COLUMN "regionId" TEXT;

-- Data migration: fold the existing free-text regions into top-level Region rows,
-- then point each Location at its new region. Runs before the old column is dropped.
INSERT INTO "Region" ("id", "name", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, d."region", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (
    SELECT DISTINCT "region"
    FROM "Location"
    WHERE "region" IS NOT NULL AND btrim("region") <> ''
) d;

UPDATE "Location" l
SET "regionId" = r."id"
FROM "Region" r
WHERE r."parentId" IS NULL AND r."name" = l."region";

-- AlterTable
ALTER TABLE "Location" DROP COLUMN "region";

-- CreateIndex
CREATE INDEX "Region_parentId_idx" ON "Region"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "Region_parentId_name_key" ON "Region"("parentId", "name");

-- CreateIndex
CREATE INDEX "Location_regionId_idx" ON "Location"("regionId");

-- CreateIndex
CREATE INDEX "_RegionTripTypes_B_index" ON "_RegionTripTypes"("B");

-- AddForeignKey
ALTER TABLE "Region" ADD CONSTRAINT "Region_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Region"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_RegionTripTypes" ADD CONSTRAINT "_RegionTripTypes_A_fkey" FOREIGN KEY ("A") REFERENCES "Region"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_RegionTripTypes" ADD CONSTRAINT "_RegionTripTypes_B_fkey" FOREIGN KEY ("B") REFERENCES "TripType"("id") ON DELETE CASCADE ON UPDATE CASCADE;
