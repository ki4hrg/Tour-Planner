-- Standing payment terms on a venue (GH #86): the installment pattern a location
-- generally uses year to year, seeding new (trip, location) engagements. Mirrors
-- PaymentScheduleItem but hangs off Location instead of a booking. Additive —
-- new table only.

-- CreateTable
CREATE TABLE "LocationPaymentScheduleItem" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "label" TEXT,
    "percent" DECIMAL(5,2),
    "fixedAmount" DECIMAL(10,2),
    "dueOffsetDays" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LocationPaymentScheduleItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LocationPaymentScheduleItem_locationId_idx" ON "LocationPaymentScheduleItem"("locationId");

-- AddForeignKey: standing terms live and die with their location.
ALTER TABLE "LocationPaymentScheduleItem" ADD CONSTRAINT "LocationPaymentScheduleItem_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Prisma can't model CHECK constraints: same rule as PaymentScheduleItem — an
-- installment is EITHER a percentage of the agreed price OR a fixed amount, never
-- both / neither.
ALTER TABLE "LocationPaymentScheduleItem" ADD CONSTRAINT "location_payment_schedule_amount" CHECK (
  num_nonnulls("percent", "fixedAmount") = 1
);
