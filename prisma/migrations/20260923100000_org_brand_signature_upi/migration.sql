-- Brand assets referenced by the Prisma schema but never migrated.
ALTER TABLE "organizations"
ADD COLUMN IF NOT EXISTS "brand_signature_url" TEXT,
ADD COLUMN IF NOT EXISTS "brand_upi_qr_url" TEXT;
