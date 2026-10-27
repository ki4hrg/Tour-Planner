-- Itemized agreed price: a booking's single agreedAmount (+ agreedUnit) becomes a
-- set of BookingPriceLine rows mirroring the venue's Cost lines, so a mixed
-- price (per-person admission + a per-group charge) keeps following the trip
-- headcount. The booking keeps agreedCurrency (one currency per booking).
-- Hand-written + data-preserving: create, backfill, THEN drop.

-- CreateTable
CREATE TABLE "BookingPriceLine" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "unit" "CostUnit" NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "BookingPriceLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BookingPriceLine_bookingId_idx" ON "BookingPriceLine"("bookingId");

-- AddForeignKey: lines live and die with their booking.
ALTER TABLE "BookingPriceLine" ADD CONSTRAINT "BookingPriceLine_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: one line per priced booking. PER_PERSON stays a per-person rate;
-- PER_GROUP and null both meant "already the total" -> a per-group line.
-- Deterministic text id (ids are cuid text; 'bpl_' never collides with a cuid).
INSERT INTO "BookingPriceLine" ("id", "bookingId", "label", "amount", "unit", "order")
SELECT 'bpl_' || b."id",
       b."id",
       'Agreed price',
       b."agreedAmount",
       CASE WHEN b."agreedUnit" = 'PER_PERSON' THEN 'PER_PERSON'::"CostUnit"
            ELSE 'PER_GROUP'::"CostUnit" END,
       0
FROM "Booking" b
WHERE b."agreedAmount" IS NOT NULL;

-- Only now drop the old single-price columns.
ALTER TABLE "Booking" DROP COLUMN "agreedAmount",
DROP COLUMN "agreedUnit";
