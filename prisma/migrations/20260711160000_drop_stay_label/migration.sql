-- Drop the free-text Stay.label (GH #13): a stay is tied to a lodging-flagged
-- host site, so the location name carries the identity; the label duplicated it.
-- Deliberately data-discarding for this column only.
ALTER TABLE "Stay" DROP COLUMN "label";
