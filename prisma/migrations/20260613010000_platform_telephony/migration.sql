-- AlterTable: add provisioning fields to telephony_configs
ALTER TABLE "telephony_configs"
  ADD COLUMN "provisioned"    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "phone_number"   TEXT,
  ADD COLUMN "subaccount_sid" TEXT,
  ADD COLUMN "external_refs"  JSONB;

-- CreateTable: telephony_usage
CREATE TABLE "telephony_usage" (
  "id"               TEXT         NOT NULL,
  "organization_id"  TEXT         NOT NULL,
  "config_id"        TEXT,
  "call_log_id"      TEXT,
  "provider"         TEXT         NOT NULL,
  "direction"        TEXT         NOT NULL DEFAULT 'outbound',
  "call_sid"         TEXT,
  "duration_seconds" INTEGER      NOT NULL DEFAULT 0,
  "provider_cost"    DECIMAL(10,4) NOT NULL DEFAULT 0,
  "billed_cost"      DECIMAL(10,4) NOT NULL DEFAULT 0,
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "telephony_usage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "telephony_usage_organization_id_created_at_idx" ON "telephony_usage"("organization_id", "created_at");

-- AddForeignKey
ALTER TABLE "telephony_usage" ADD CONSTRAINT "telephony_usage_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "telephony_usage" ADD CONSTRAINT "telephony_usage_config_id_fkey"
  FOREIGN KEY ("config_id") REFERENCES "telephony_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "telephony_usage" ADD CONSTRAINT "telephony_usage_call_log_id_fkey"
  FOREIGN KEY ("call_log_id") REFERENCES "telecaller_call_logs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
