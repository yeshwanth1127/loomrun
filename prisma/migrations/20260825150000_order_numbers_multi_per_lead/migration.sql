-- DropIndex
DROP INDEX IF EXISTS "production_orders_lead_id_key";

-- AlterTable
ALTER TABLE "production_orders" ADD COLUMN "order_number" TEXT;

-- Backfill order numbers for existing rows (per org, ordered by created_at)
WITH numbered AS (
  SELECT
    id,
    'ORD-' || EXTRACT(YEAR FROM created_at)::TEXT || '-' ||
    LPAD(
      ROW_NUMBER() OVER (
        PARTITION BY organization_id, EXTRACT(YEAR FROM created_at)
        ORDER BY created_at
      )::TEXT,
      5,
      '0'
    ) AS num
  FROM "production_orders"
)
UPDATE "production_orders" po
SET "order_number" = n.num
FROM numbered n
WHERE po.id = n.id;

-- AlterTable
ALTER TABLE "production_orders" ALTER COLUMN "order_number" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "production_orders_organization_id_order_number_key"
  ON "production_orders"("organization_id", "order_number");

-- CreateIndex
CREATE INDEX "production_orders_lead_id_idx" ON "production_orders"("lead_id");
