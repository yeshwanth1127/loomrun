-- AlterTable
ALTER TABLE "production_orders"
  ADD COLUMN IF NOT EXISTS "tracking_token" TEXT,
  ADD COLUMN IF NOT EXISTS "tracking_enabled" BOOLEAN NOT NULL DEFAULT true;

-- Backfill tokens for existing rows
UPDATE "production_orders"
SET "tracking_token" = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
WHERE "tracking_token" IS NULL;

-- Unique index
CREATE UNIQUE INDEX IF NOT EXISTS "production_orders_tracking_token_key"
  ON "production_orders"("tracking_token");
