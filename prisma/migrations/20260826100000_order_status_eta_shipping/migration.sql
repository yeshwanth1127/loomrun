-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "OrderStatus" AS ENUM ('ON_TRACK', 'AT_RISK', 'DELAYED', 'ON_HOLD', 'COMPLETED', 'CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AlterEnum ProductionActivityType (each in its own DO block)
DO $$ BEGIN
  ALTER TYPE "ProductionActivityType" ADD VALUE 'NOTE_ADDED';
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
DO $$ BEGIN
  ALTER TYPE "ProductionActivityType" ADD VALUE 'STATUS_CHANGED';
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
DO $$ BEGIN
  ALTER TYPE "ProductionActivityType" ADD VALUE 'ETA_UPDATED';
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
DO $$ BEGIN
  ALTER TYPE "ProductionActivityType" ADD VALUE 'SHIPMENT_UPDATED';
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AlterTable
ALTER TABLE "production_orders"
  ADD COLUMN IF NOT EXISTS "order_status" "OrderStatus" NOT NULL DEFAULT 'ON_TRACK',
  ADD COLUMN IF NOT EXISTS "expected_completion_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "expected_dispatch_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "actual_dispatch_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "courier_name" TEXT,
  ADD COLUMN IF NOT EXISTS "courier_tracking_no" TEXT,
  ADD COLUMN IF NOT EXISTS "shipping_notes" TEXT,
  ADD COLUMN IF NOT EXISTS "on_hold_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "cancelled_at" TIMESTAMP(3);

-- Sync delay_flag → DELAYED where still ON_TRACK
UPDATE "production_orders"
SET "order_status" = 'DELAYED'
WHERE "delay_flag" = true AND "order_status" = 'ON_TRACK';

-- Delivered orders → COMPLETED
UPDATE "production_orders"
SET "order_status" = 'COMPLETED'
WHERE "stage" = 'DELIVERED' AND "order_status" NOT IN ('CANCELLED');

-- CreateIndex
CREATE INDEX IF NOT EXISTS "production_orders_organization_id_order_status_idx"
  ON "production_orders"("organization_id", "order_status");
