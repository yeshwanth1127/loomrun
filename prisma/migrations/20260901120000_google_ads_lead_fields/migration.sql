-- AlterTable
ALTER TABLE "leads" ADD COLUMN "google_ads_submission_id" TEXT,
ADD COLUMN "google_ads_customer_id" TEXT,
ADD COLUMN "google_ads_campaign_id" TEXT,
ADD COLUMN "google_ads_campaign_name" TEXT,
ADD COLUMN "google_ads_form_id" TEXT;

-- CreateIndex
CREATE INDEX "leads_organization_id_google_ads_submission_id_idx" ON "leads"("organization_id", "google_ads_submission_id");
