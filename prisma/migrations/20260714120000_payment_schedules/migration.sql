-- Booking payment schedules (GH #51): installments due relative to trip start
-- ("20% deposit 180 days out, balance by 30 days"). New table only — additive.

-- CreateTable
CREATE TABLE "PaymentScheduleItem" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "label" TEXT,
    "percent" DECIMAL(5,2),
    "fixedAmount" DECIMAL(10,2),
    "dueOffsetDays" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentScheduleItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaymentScheduleItem_bookingId_idx" ON "PaymentScheduleItem"("bookingId");

-- AddForeignKey: installments live and die with their booking.
ALTER TABLE "PaymentScheduleItem" ADD CONSTRAINT "PaymentScheduleItem_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Prisma can't model CHECK constraints: an installment is EITHER a percentage
-- of the agreed price OR a fixed amount, never both / neither.
ALTER TABLE "PaymentScheduleItem" ADD CONSTRAINT "payment_schedule_amount" CHECK (
  num_nonnulls("percent", "fixedAmount") = 1
);
