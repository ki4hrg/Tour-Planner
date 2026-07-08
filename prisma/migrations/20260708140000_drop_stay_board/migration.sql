-- Drop the lodging board type: the field was rarely used and is being retired.
-- Destructive — the per-stay board value is discarded.
ALTER TABLE "Stay" DROP COLUMN "board";

DROP TYPE "BoardType";
