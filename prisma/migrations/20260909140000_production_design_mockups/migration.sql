-- CreateTable
CREATE TABLE "production_design_assets" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "production_order_id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "storage_path" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "production_design_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_mockups" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "production_order_id" TEXT NOT NULL,
    "design_asset_id" TEXT NOT NULL,
    "garment_type" TEXT NOT NULL,
    "view" TEXT NOT NULL,
    "placement" JSONB NOT NULL,
    "engine" TEXT NOT NULL DEFAULT 'TEMPLATE_2D',
    "status" TEXT NOT NULL DEFAULT 'READY',
    "storage_path" TEXT,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "production_mockups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "production_design_assets_production_order_id_idx" ON "production_design_assets"("production_order_id");

-- CreateIndex
CREATE INDEX "production_design_assets_organization_id_production_order_id_idx" ON "production_design_assets"("organization_id", "production_order_id");

-- CreateIndex
CREATE INDEX "production_mockups_production_order_id_idx" ON "production_mockups"("production_order_id");

-- CreateIndex
CREATE INDEX "production_mockups_design_asset_id_idx" ON "production_mockups"("design_asset_id");

-- CreateIndex
CREATE INDEX "production_mockups_organization_id_production_order_id_idx" ON "production_mockups"("organization_id", "production_order_id");

-- AddForeignKey
ALTER TABLE "production_design_assets" ADD CONSTRAINT "production_design_assets_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_design_assets" ADD CONSTRAINT "production_design_assets_production_order_id_fkey" FOREIGN KEY ("production_order_id") REFERENCES "production_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_mockups" ADD CONSTRAINT "production_mockups_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_mockups" ADD CONSTRAINT "production_mockups_production_order_id_fkey" FOREIGN KEY ("production_order_id") REFERENCES "production_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_mockups" ADD CONSTRAINT "production_mockups_design_asset_id_fkey" FOREIGN KEY ("design_asset_id") REFERENCES "production_design_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
