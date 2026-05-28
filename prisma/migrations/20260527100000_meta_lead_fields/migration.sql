-- AlterTable
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "meta_leadgen_id" TEXT,
ADD COLUMN IF NOT EXISTS "meta_page_id" TEXT,
ADD COLUMN IF NOT EXISTS "meta_form_id" TEXT,
ADD COLUMN IF NOT EXISTS "meta_ad_id" TEXT,
ADD COLUMN IF NOT EXISTS "meta_adset_id" TEXT,
ADD COLUMN IF NOT EXISTS "meta_campaign_id" TEXT,
ADD COLUMN IF NOT EXISTS "meta_campaign_name" TEXT,
ADD COLUMN IF NOT EXISTS "meta_adset_name" TEXT,
ADD COLUMN IF NOT EXISTS "meta_ad_name" TEXT,
ADD COLUMN IF NOT EXISTS "meta_form_name" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "leads_organization_id_meta_campaign_id_idx" ON "leads"("organization_id", "meta_campaign_id");
