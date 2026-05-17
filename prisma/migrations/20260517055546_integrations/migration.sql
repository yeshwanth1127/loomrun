-- DropForeignKey
ALTER TABLE "telecaller_call_logs" DROP CONSTRAINT "telecaller_call_logs_user_id_fkey";

-- AlterTable
ALTER TABLE "telecaller_call_logs" ADD COLUMN     "ai_summary" TEXT,
ADD COLUMN     "call_sid" TEXT,
ADD COLUMN     "call_source" TEXT NOT NULL DEFAULT 'HUMAN',
ADD COLUMN     "duration_seconds" INTEGER,
ADD COLUMN     "recording_url" TEXT,
ADD COLUMN     "transcript_raw" TEXT,
ALTER COLUMN "user_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "telephony_configs" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "provider_type" TEXT NOT NULL,
    "provider_name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'disconnected',
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "credentials" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "telephony_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "telephony_configs_organization_id_provider_type_idx" ON "telephony_configs"("organization_id", "provider_type");

-- CreateIndex
CREATE UNIQUE INDEX "telephony_configs_organization_id_provider_type_provider_na_key" ON "telephony_configs"("organization_id", "provider_type", "provider_name");

-- AddForeignKey
ALTER TABLE "telecaller_call_logs" ADD CONSTRAINT "telecaller_call_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telephony_configs" ADD CONSTRAINT "telephony_configs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
