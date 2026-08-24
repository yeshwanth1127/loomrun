-- CreateEnum
CREATE TYPE "WhatsAppTemplateCategory" AS ENUM ('QUOTATION', 'INVOICE', 'FOLLOW_UP', 'THANK_YOU', 'GREETING');

-- CreateTable
CREATE TABLE "whatsapp_templates" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "category" "WhatsAppTemplateCategory" NOT NULL,
    "name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "whatsapp_templates_organization_id_category_idx" ON "whatsapp_templates"("organization_id", "category");

-- AddForeignKey
ALTER TABLE "whatsapp_templates" ADD CONSTRAINT "whatsapp_templates_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

