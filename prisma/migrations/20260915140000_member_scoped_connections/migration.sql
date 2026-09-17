-- Per-membership WhatsApp / Gmail connections alongside org-level CEO connectors.

-- WhatsAppConnection: drop org-only unique, add membership_id
ALTER TABLE "whatsapp_connections" ADD COLUMN IF NOT EXISTS "membership_id" TEXT;

ALTER TABLE "whatsapp_connections" DROP CONSTRAINT IF EXISTS "whatsapp_connections_organization_id_key";

CREATE INDEX IF NOT EXISTS "whatsapp_connections_organization_id_idx"
  ON "whatsapp_connections"("organization_id");
CREATE INDEX IF NOT EXISTS "whatsapp_connections_membership_id_idx"
  ON "whatsapp_connections"("membership_id");

-- One org-level row per organization
CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_connections_org_unique"
  ON "whatsapp_connections"("organization_id") WHERE "membership_id" IS NULL;
-- One personal row per membership
CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_connections_membership_unique"
  ON "whatsapp_connections"("membership_id") WHERE "membership_id" IS NOT NULL;

DO $$ BEGIN
  ALTER TABLE "whatsapp_connections"
    ADD CONSTRAINT "whatsapp_connections_membership_id_fkey"
    FOREIGN KEY ("membership_id") REFERENCES "memberships"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AutomationConnection: add membership_id, replace unique
ALTER TABLE "automation_connections" ADD COLUMN IF NOT EXISTS "membership_id" TEXT;

ALTER TABLE "automation_connections" DROP CONSTRAINT IF EXISTS "automation_connections_organization_id_service_name_key";

CREATE INDEX IF NOT EXISTS "automation_connections_organization_id_service_name_idx"
  ON "automation_connections"("organization_id", "service_name");
CREATE INDEX IF NOT EXISTS "automation_connections_membership_id_service_name_idx"
  ON "automation_connections"("membership_id", "service_name");

CREATE UNIQUE INDEX IF NOT EXISTS "automation_connections_org_svc_unique"
  ON "automation_connections"("organization_id", "service_name") WHERE "membership_id" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "automation_connections_mem_svc_unique"
  ON "automation_connections"("membership_id", "service_name") WHERE "membership_id" IS NOT NULL;

DO $$ BEGIN
  ALTER TABLE "automation_connections"
    ADD CONSTRAINT "automation_connections_membership_id_fkey"
    FOREIGN KEY ("membership_id") REFERENCES "memberships"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
