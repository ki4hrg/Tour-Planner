-- Region gains an optional phone country code (digits only, e.g. "44"), set by
-- admins on top-level regions; a location's effective code walks up the parent
-- chain. Drives the default dial-code on contact phone entry. Purely additive.

-- AlterTable
ALTER TABLE "Region" ADD COLUMN "dialCode" TEXT;
