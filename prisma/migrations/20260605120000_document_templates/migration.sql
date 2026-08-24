-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('QUOTATION', 'INVOICE');

-- CreateTable
CREATE TABLE "document_templates" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "doc_type" "DocumentType" NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "layout" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_templates_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN "default_quotation_template_id" TEXT,
ADD COLUMN "default_invoice_template_id" TEXT;

-- AlterTable
ALTER TABLE "quotations" ADD COLUMN "template_id" TEXT;

-- CreateIndex
CREATE INDEX "document_templates_organization_id_doc_type_idx" ON "document_templates"("organization_id", "doc_type");

-- CreateIndex
CREATE UNIQUE INDEX "document_templates_organization_id_slug_doc_type_key" ON "document_templates"("organization_id", "slug", "doc_type");

-- AddForeignKey
ALTER TABLE "document_templates" ADD CONSTRAINT "document_templates_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "document_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_default_quotation_template_id_fkey" FOREIGN KEY ("default_quotation_template_id") REFERENCES "document_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_default_invoice_template_id_fkey" FOREIGN KEY ("default_invoice_template_id") REFERENCES "document_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
