-- Subscribable iCalendar feeds (GH #77): a token-authenticated .ics URL that
-- calendar apps poll to stay in sync. New enum + table; purely additive.

-- CreateEnum
CREATE TYPE "CalendarFeedScope" AS ENUM ('TRIP', 'TRIP_TYPE', 'ALL');

-- CreateTable
CREATE TABLE "CalendarFeed" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "scope" "CalendarFeedScope" NOT NULL,
    "tripId" TEXT,
    "tripTypeId" TEXT,
    "label" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CalendarFeed_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CalendarFeed_token_key" ON "CalendarFeed"("token");

-- CreateIndex
CREATE INDEX "CalendarFeed_tripId_idx" ON "CalendarFeed"("tripId");

-- CreateIndex
CREATE INDEX "CalendarFeed_tripTypeId_idx" ON "CalendarFeed"("tripTypeId");

-- AddForeignKey: deleting the scoped trip / trip type removes its feeds.
ALTER TABLE "CalendarFeed" ADD CONSTRAINT "CalendarFeed_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CalendarFeed" ADD CONSTRAINT "CalendarFeed_tripTypeId_fkey" FOREIGN KEY ("tripTypeId") REFERENCES "TripType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: deleting the author leaves the feed (ownership just clears).
ALTER TABLE "CalendarFeed" ADD CONSTRAINT "CalendarFeed_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Prisma can't model CHECK constraints: enforce that the scope and its target
-- agree — TRIP ⇒ only tripId, TRIP_TYPE ⇒ only tripTypeId, ALL ⇒ neither.
ALTER TABLE "CalendarFeed" ADD CONSTRAINT "calendar_feed_scope" CHECK (
  (scope = 'TRIP'      AND "tripId" IS NOT NULL AND "tripTypeId" IS NULL) OR
  (scope = 'TRIP_TYPE' AND "tripTypeId" IS NOT NULL AND "tripId" IS NULL) OR
  (scope = 'ALL'       AND "tripId" IS NULL AND "tripTypeId" IS NULL)
);
