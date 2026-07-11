-- Booking money: the engagement's negotiated price (agreedAmount/Currency/Unit —
-- distinct from the location's asking-price cost catalog) plus a Payment log.
-- An engagement is settled when payments cover the agreed amount. Purely additive.

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN "agreedAmount" DECIMAL(10,2),
ADD COLUMN "agreedCurrency" TEXT NOT NULL DEFAULT 'USD',
ADD COLUMN "agreedUnit" "CostUnit";

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "paidOn" DATE NOT NULL,
    "method" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Payment_bookingId_idx" ON "Payment"("bookingId");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;
