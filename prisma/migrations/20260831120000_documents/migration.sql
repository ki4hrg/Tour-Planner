-- File management: store contracts, invoices, printable participant itineraries
-- and other paperwork against the thing they belong to.
--
-- Two tables on purpose. `Document` is metadata only, so listing a trip's files
-- stays a cheap indexed read; `DocumentBlob` holds the bytea, which Postgres
-- TOASTs out-of-line and which nothing but the download routes ever selects.
--
-- The target is polymorphic exactly like `Note` — a document attaches to ONE of
-- a Location / Booking / Trip / Stay — and is enforced the same way, with a
-- CHECK Prisma cannot model (so it is invisible to `migrate diff`; keep it in
-- mind when regenerating).
--
-- Cascades: a document dies with whatever it was filed against, and its blob
-- dies with it. `uploadedById` is SET NULL so removing a user never blocks on
-- (or destroys) the paperwork they filed.

-- CreateEnum
CREATE TYPE "DocumentKind" AS ENUM ('CONTRACT', 'INVOICE', 'RECEIPT', 'ITINERARY', 'ROSTER', 'CONFIRMATION', 'PERMIT', 'MAP', 'OTHER');

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "kind" "DocumentKind" NOT NULL DEFAULT 'OTHER',
    "filename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    -- Non-staff audiences allowed to download via a share link. Empty = staff
    -- only; STAFF links see everything on their trip and never appear here.
    "shareAudiences" "ShareAudience"[] DEFAULT ARRAY[]::"ShareAudience"[],
    "locationId" TEXT,
    "bookingId" TEXT,
    "tripId" TEXT,
    "stayId" TEXT,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentBlob" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,

    CONSTRAINT "DocumentBlob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Document_locationId_idx" ON "Document"("locationId");

-- CreateIndex
CREATE INDEX "Document_bookingId_idx" ON "Document"("bookingId");

-- CreateIndex
CREATE INDEX "Document_tripId_idx" ON "Document"("tripId");

-- CreateIndex
CREATE INDEX "Document_stayId_idx" ON "Document"("stayId");

-- CreateIndex
CREATE INDEX "Document_uploadedById_idx" ON "Document"("uploadedById");

-- CreateIndex: cheap "have we already got this exact file?" lookup.
CREATE INDEX "Document_checksum_idx" ON "Document"("checksum");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentBlob_documentId_key" ON "DocumentBlob"("documentId");

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_stayId_fkey" FOREIGN KEY ("stayId") REFERENCES "Stay"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentBlob" ADD CONSTRAINT "DocumentBlob_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A document belongs to exactly one owner (mirrors the Note target CHECK).
-- Prisma can't express this, so it lives here and must be preserved by hand.
ALTER TABLE "Document" ADD CONSTRAINT "document_single_target"
  CHECK (num_nonnulls("locationId", "bookingId", "tripId", "stayId") = 1);

-- A zero-byte upload is never a real document; reject it at the storage layer too.
ALTER TABLE "Document" ADD CONSTRAINT "document_size_positive" CHECK ("size" > 0);
