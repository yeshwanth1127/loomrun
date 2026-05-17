-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('ACTIVE', 'WON', 'LOST', 'UNQUALIFIED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "LeadSource" ADD VALUE 'META_ADS';
ALTER TYPE "LeadSource" ADD VALUE 'GOOGLE_ADS';
ALTER TYPE "LeadSource" ADD VALUE 'INDIAMART';
ALTER TYPE "LeadSource" ADD VALUE 'WEBSITE';
ALTER TYPE "LeadSource" ADD VALUE 'MANUAL';

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "city" TEXT,
ADD COLUMN     "last_activity_at" TIMESTAMP(3),
ADD COLUMN     "lead_score" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lead_status" "LeadStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "product_interest" TEXT,
ADD COLUMN     "quantity_estimate" TEXT,
ADD COLUMN     "source_detail" TEXT,
ADD COLUMN     "tags" TEXT[];

-- CreateTable
CREATE TABLE "lead_connections" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "source_name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'disconnected',
    "credentials" JSONB,
    "webhook_secret" TEXT,
    "last_sync" TIMESTAMP(3),
    "leads_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_connections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lead_connections_organization_id_idx" ON "lead_connections"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "lead_connections_organization_id_source_name_key" ON "lead_connections"("organization_id", "source_name");

-- AddForeignKey
ALTER TABLE "lead_connections" ADD CONSTRAINT "lead_connections_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
