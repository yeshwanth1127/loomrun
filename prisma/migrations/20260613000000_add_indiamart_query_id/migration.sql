-- AlterTable
ALTER TABLE "leads" ADD COLUMN "indiamart_query_id" TEXT;

-- CreateIndex
CREATE INDEX "leads_organization_id_indiamart_query_id_idx" ON "leads"("organization_id", "indiamart_query_id");
