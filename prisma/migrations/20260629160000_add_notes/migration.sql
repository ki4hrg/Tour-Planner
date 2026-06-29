-- Structured contact-log notes, polymorphic over Location / Booking / Trip / Stay.
--
-- HAND-WRITTEN but purely ADDITIVE (new enum + table; no existing data touched).
-- The exactly-one-target rule is a CHECK, which Prisma cannot model — it is invisible
-- to migrate-diff (validated with `prisma migrate diff … --exit-code` → "No difference
-- detected"; the rest of the table IS modeled and matches).

-- CreateEnum
CREATE TYPE "NoteMethod" AS ENUM ('CALL', 'EMAIL', 'IN_PERSON', 'OTHER');

-- CreateTable
CREATE TABLE "Note" (
    "id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "method" "NoteMethod" NOT NULL DEFAULT 'OTHER',
    "contactId" TEXT,
    "contactedOn" DATE NOT NULL,
    "followUp" BOOLEAN NOT NULL DEFAULT false,
    "dueDate" DATE,
    "locationId" TEXT,
    "bookingId" TEXT,
    "tripId" TEXT,
    "stayId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Note_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Note_locationId_idx" ON "Note"("locationId");
CREATE INDEX "Note_bookingId_idx" ON "Note"("bookingId");
CREATE INDEX "Note_tripId_idx" ON "Note"("tripId");
CREATE INDEX "Note_stayId_idx" ON "Note"("stayId");
CREATE INDEX "Note_contactId_idx" ON "Note"("contactId");
CREATE INDEX "Note_createdById_idx" ON "Note"("createdById");

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Note" ADD CONSTRAINT "Note_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Note" ADD CONSTRAINT "Note_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Note" ADD CONSTRAINT "Note_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Note" ADD CONSTRAINT "Note_stayId_fkey" FOREIGN KEY ("stayId") REFERENCES "Stay"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Note" ADD CONSTRAINT "Note_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Exactly one polymorphic target (invisible to migrate-diff; Prisma can't model CHECK).
ALTER TABLE "Note" ADD CONSTRAINT "Note_one_target_chk"
  CHECK (num_nonnulls("locationId", "bookingId", "tripId", "stayId") = 1);
