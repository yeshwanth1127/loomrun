-- GST fields + quotation→invoice lineage on quotations
ALTER TABLE "quotations"
  ADD COLUMN IF NOT EXISTS "invoice_number" TEXT,
  ADD COLUMN IF NOT EXISTS "invoiced_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "tax_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "tax_rate" DECIMAL(5,2),
  ADD COLUMN IF NOT EXISTS "source_quotation_id" TEXT,
  ADD COLUMN IF NOT EXISTS "source_quotation_version" INTEGER;

CREATE INDEX IF NOT EXISTS "quotations_lead_id_idx" ON "quotations"("lead_id");
CREATE INDEX IF NOT EXISTS "quotations_source_quotation_id_idx" ON "quotations"("source_quotation_id");

DO $$ BEGIN
  ALTER TABLE "quotations"
    ADD CONSTRAINT "quotations_source_quotation_id_fkey"
    FOREIGN KEY ("source_quotation_id") REFERENCES "quotations"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Immutable version snapshots
CREATE TABLE IF NOT EXISTS "quotation_versions" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "quotation_id" TEXT NOT NULL,
  "version_number" INTEGER NOT NULL,
  "title" TEXT,
  "status" "QuotationStatus" NOT NULL,
  "invoice_number" TEXT,
  "subtotal" DECIMAL(12,2) NOT NULL,
  "tax_enabled" BOOLEAN NOT NULL DEFAULT false,
  "tax_rate" DECIMAL(5,2),
  "tax" DECIMAL(12,2) NOT NULL,
  "total" DECIMAL(12,2) NOT NULL,
  "lines_json" JSONB NOT NULL,
  "lead_snapshot" JSONB,
  "note" TEXT,
  "created_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "quotation_versions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "quotation_versions_quotation_id_version_number_key"
  ON "quotation_versions"("quotation_id", "version_number");
CREATE INDEX IF NOT EXISTS "quotation_versions_organization_id_quotation_id_idx"
  ON "quotation_versions"("organization_id", "quotation_id");

DO $$ BEGIN
  ALTER TABLE "quotation_versions"
    ADD CONSTRAINT "quotation_versions_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "quotation_versions"
    ADD CONSTRAINT "quotation_versions_quotation_id_fkey"
    FOREIGN KEY ("quotation_id") REFERENCES "quotations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "quotation_versions"
    ADD CONSTRAINT "quotation_versions_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Backfill Version 1 snapshots for existing documents (idempotent)
INSERT INTO "quotation_versions" (
  "id", "organization_id", "quotation_id", "version_number", "title", "status",
  "invoice_number", "subtotal", "tax_enabled", "tax_rate", "tax", "total",
  "lines_json", "lead_snapshot", "note", "created_at"
)
SELECT
  'qv_' || q."id",
  q."organization_id",
  q."id",
  COALESCE(q."version", 1),
  q."title",
  q."status",
  q."invoice_number",
  q."subtotal",
  COALESCE(q."tax_enabled", false),
  q."tax_rate",
  q."tax",
  q."total",
  COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'description', l."description",
          'quantity', l."quantity",
          'unit_price', l."unit_price",
          'line_total', l."line_total",
          'sort_order', l."sort_order"
        ) ORDER BY l."sort_order"
      )
      FROM "quotation_lines" l
      WHERE l."quotation_id" = q."id"
    ),
    '[]'::jsonb
  ),
  jsonb_build_object(
    'title', lead."title",
    'company', lead."company",
    'phone', lead."phone",
    'email', lead."email"
  ),
  'Initial version',
  COALESCE(q."created_at", CURRENT_TIMESTAMP)
FROM "quotations" q
JOIN "leads" lead ON lead."id" = q."lead_id"
WHERE NOT EXISTS (
  SELECT 1 FROM "quotation_versions" v
  WHERE v."quotation_id" = q."id" AND v."version_number" = COALESCE(q."version", 1)
);
