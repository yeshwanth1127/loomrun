-- Expected payment statuses
DO $$ BEGIN
  CREATE TYPE "ExpectedPaymentStatus" AS ENUM ('OPEN', 'PARTIALLY_FULFILLED', 'FULFILLED', 'CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Production activity types for collections
DO $$ BEGIN
  ALTER TYPE "ProductionActivityType" ADD VALUE IF NOT EXISTS 'EXPECTED_PAYMENT_ADDED';
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
DO $$ BEGIN
  ALTER TYPE "ProductionActivityType" ADD VALUE IF NOT EXISTS 'EXPECTED_PAYMENT_RESCHEDULED';
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
DO $$ BEGIN
  ALTER TYPE "ProductionActivityType" ADD VALUE IF NOT EXISTS 'EXPECTED_PAYMENT_FULFILLED';
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
DO $$ BEGIN
  ALTER TYPE "ProductionActivityType" ADD VALUE IF NOT EXISTS 'EXPECTED_PAYMENT_CANCELLED';
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
DO $$ BEGIN
  ALTER TYPE "ProductionActivityType" ADD VALUE IF NOT EXISTS 'PAYMENT_UPDATED';
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
DO $$ BEGIN
  ALTER TYPE "ProductionActivityType" ADD VALUE IF NOT EXISTS 'PAYMENT_DELETED';
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Extend payments ledger for method / reference / label / promise link
ALTER TABLE "payments"
  ADD COLUMN IF NOT EXISTS "method" TEXT,
  ADD COLUMN IF NOT EXISTS "reference" TEXT,
  ADD COLUMN IF NOT EXISTS "label" TEXT,
  ADD COLUMN IF NOT EXISTS "expected_payment_id" TEXT;

-- Expected / promised payments (do not count as collected)
CREATE TABLE IF NOT EXISTS "expected_payments" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "production_order_id" TEXT NOT NULL,
  "amount_cents" INTEGER NOT NULL,
  "remaining_cents" INTEGER NOT NULL,
  "expected_at" TIMESTAMP(3),
  "label" TEXT,
  "note" TEXT,
  "status" "ExpectedPaymentStatus" NOT NULL DEFAULT 'OPEN',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "cancelled_at" TIMESTAMP(3),

  CONSTRAINT "expected_payments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "expected_payments_production_order_id_idx"
  ON "expected_payments"("production_order_id");
CREATE INDEX IF NOT EXISTS "expected_payments_organization_id_status_idx"
  ON "expected_payments"("organization_id", "status");
CREATE INDEX IF NOT EXISTS "expected_payments_expected_at_idx"
  ON "expected_payments"("expected_at");

DO $$ BEGIN
  ALTER TABLE "expected_payments"
    ADD CONSTRAINT "expected_payments_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "expected_payments"
    ADD CONSTRAINT "expected_payments_production_order_id_fkey"
    FOREIGN KEY ("production_order_id") REFERENCES "production_orders"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "payments_expected_payment_id_idx"
  ON "payments"("expected_payment_id");

DO $$ BEGIN
  ALTER TABLE "payments"
    ADD CONSTRAINT "payments_expected_payment_id_fkey"
    FOREIGN KEY ("expected_payment_id") REFERENCES "expected_payments"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
