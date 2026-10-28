-- Standing venue events ("Evensong 17:00" at a cathedral) a planner adds to a
-- day in one click from the item form. Purely additive.
CREATE TABLE "LocationEvent" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT,
    "categoryId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LocationEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LocationEvent_locationId_idx" ON "LocationEvent"("locationId");
CREATE INDEX "LocationEvent_categoryId_idx" ON "LocationEvent"("categoryId");

ALTER TABLE "LocationEvent" ADD CONSTRAINT "LocationEvent_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LocationEvent" ADD CONSTRAINT "LocationEvent_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "ScheduleItemCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
