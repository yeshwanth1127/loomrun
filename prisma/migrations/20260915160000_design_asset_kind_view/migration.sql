-- Design workspace: separate customer source files from garment design views.

ALTER TABLE "production_design_assets" ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'SOURCE';
ALTER TABLE "production_design_assets" ADD COLUMN IF NOT EXISTS "view_type" TEXT;
ALTER TABLE "production_design_assets" ADD COLUMN IF NOT EXISTS "title" TEXT;

CREATE INDEX IF NOT EXISTS "production_design_assets_production_order_id_kind_idx"
  ON "production_design_assets"("production_order_id", "kind");
