-- CreateEnum
CREATE TYPE "PipelineStageKind" AS ENUM ('OPEN', 'WON', 'LOST');
CREATE TYPE "PipelineType" AS ENUM ('GENERAL', 'CAMPAIGN', 'REGION', 'PRODUCT', 'SECTOR', 'TEAM', 'CUSTOM');

-- CreateTable
CREATE TABLE "pipelines" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "PipelineType" NOT NULL DEFAULT 'GENERAL',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "pipelines_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pipeline_stages" (
    "id" TEXT NOT NULL,
    "pipeline_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "kind" "PipelineStageKind" NOT NULL DEFAULT 'OPEN',
    "probability" INTEGER,
    "system_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "pipeline_stages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pipeline_routing_rules" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "pipeline_id" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "source" "LeadSource",
    "campaign_id" TEXT,
    "campaign_name" TEXT,
    "region" TEXT,
    "product_interest" TEXT,
    "sector" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "pipeline_routing_rules_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "leads" ADD COLUMN "pipeline_id" TEXT,
ADD COLUMN "pipeline_stage_id" TEXT,
ADD COLUMN "region" TEXT,
ADD COLUMN "sector" TEXT,
ADD COLUMN "campaign_id" TEXT,
ADD COLUMN "campaign_name" TEXT;

CREATE INDEX "pipelines_organization_id_idx" ON "pipelines"("organization_id");
CREATE INDEX "pipelines_organization_id_is_default_idx" ON "pipelines"("organization_id", "is_default");
CREATE INDEX "pipelines_organization_id_is_active_idx" ON "pipelines"("organization_id", "is_active");
CREATE INDEX "pipeline_stages_pipeline_id_sort_order_idx" ON "pipeline_stages"("pipeline_id", "sort_order");
CREATE INDEX "pipeline_stages_pipeline_id_system_key_idx" ON "pipeline_stages"("pipeline_id", "system_key");
CREATE UNIQUE INDEX "pipeline_stages_pipeline_id_slug_key" ON "pipeline_stages"("pipeline_id", "slug");
CREATE INDEX "pipeline_routing_rules_organization_id_priority_idx" ON "pipeline_routing_rules"("organization_id", "priority");
CREATE INDEX "leads_organization_id_pipeline_id_idx" ON "leads"("organization_id", "pipeline_id");
CREATE INDEX "leads_organization_id_pipeline_stage_id_idx" ON "leads"("organization_id", "pipeline_stage_id");
CREATE INDEX "leads_organization_id_campaign_id_idx" ON "leads"("organization_id", "campaign_id");

ALTER TABLE "pipelines" ADD CONSTRAINT "pipelines_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pipeline_stages" ADD CONSTRAINT "pipeline_stages_pipeline_id_fkey" FOREIGN KEY ("pipeline_id") REFERENCES "pipelines"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pipeline_routing_rules" ADD CONSTRAINT "pipeline_routing_rules_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pipeline_routing_rules" ADD CONSTRAINT "pipeline_routing_rules_pipeline_id_fkey" FOREIGN KEY ("pipeline_id") REFERENCES "pipelines"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "leads" ADD CONSTRAINT "leads_pipeline_id_fkey" FOREIGN KEY ("pipeline_id") REFERENCES "pipelines"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "leads" ADD CONSTRAINT "leads_pipeline_stage_id_fkey" FOREIGN KEY ("pipeline_stage_id") REFERENCES "pipeline_stages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed default Sales pipeline per org + backfill leads + normalize campaign fields
DO $$
DECLARE
  org RECORD;
  pid TEXT;
  sid_new TEXT;
  sid_contacted TEXT;
  sid_qual TEXT;
  sid_quot TEXT;
  sid_neg TEXT;
  sid_sample TEXT;
  sid_won TEXT;
  sid_lost TEXT;
  now_ts TIMESTAMP(3) := CURRENT_TIMESTAMP;
BEGIN
  FOR org IN SELECT id FROM organizations LOOP
    pid := 'pl_' || substr(md5(random()::text || org.id || clock_timestamp()::text), 1, 24);
    sid_new := 'ps_' || substr(md5(random()::text || 'NEW' || org.id || clock_timestamp()::text), 1, 24);
    sid_contacted := 'ps_' || substr(md5(random()::text || 'CONTACTED' || org.id || clock_timestamp()::text), 1, 24);
    sid_qual := 'ps_' || substr(md5(random()::text || 'QUAL' || org.id || clock_timestamp()::text), 1, 24);
    sid_quot := 'ps_' || substr(md5(random()::text || 'QUOT' || org.id || clock_timestamp()::text), 1, 24);
    sid_neg := 'ps_' || substr(md5(random()::text || 'NEG' || org.id || clock_timestamp()::text), 1, 24);
    sid_sample := 'ps_' || substr(md5(random()::text || 'SAMPLE' || org.id || clock_timestamp()::text), 1, 24);
    sid_won := 'ps_' || substr(md5(random()::text || 'WON' || org.id || clock_timestamp()::text), 1, 24);
    sid_lost := 'ps_' || substr(md5(random()::text || 'LOST' || org.id || clock_timestamp()::text), 1, 24);

    INSERT INTO pipelines (id, organization_id, name, type, is_default, is_active, sort_order, created_at, updated_at)
    VALUES (pid, org.id, 'Sales', 'GENERAL', true, true, 0, now_ts, now_ts);

    INSERT INTO pipeline_stages (id, pipeline_id, name, slug, sort_order, kind, probability, system_key, created_at, updated_at) VALUES
      (sid_new, pid, 'New', 'new', 0, 'OPEN', 10, 'NEW', now_ts, now_ts),
      (sid_contacted, pid, 'Contacted', 'contacted', 1, 'OPEN', 20, 'CONTACTED', now_ts, now_ts),
      (sid_qual, pid, 'Requirement Collected', 'requirement-collected', 2, 'OPEN', 35, 'QUALIFICATION', now_ts, now_ts),
      (sid_quot, pid, 'Quoted', 'quoted', 3, 'OPEN', 50, 'QUOTATION', now_ts, now_ts),
      (sid_neg, pid, 'Negotiation', 'negotiation', 4, 'OPEN', 65, 'NEGOTIATION', now_ts, now_ts),
      (sid_sample, pid, 'Sample Sent', 'sample-sent', 5, 'OPEN', 80, 'SAMPLE', now_ts, now_ts),
      (sid_won, pid, 'Won', 'won', 6, 'WON', 100, 'WON', now_ts, now_ts),
      (sid_lost, pid, 'Lost', 'lost', 7, 'LOST', 0, 'LOST', now_ts, now_ts);

    UPDATE leads SET pipeline_id = pid, pipeline_stage_id = sid_new WHERE organization_id = org.id AND stage = 'NEW';
    UPDATE leads SET pipeline_id = pid, pipeline_stage_id = sid_contacted WHERE organization_id = org.id AND stage = 'CONTACTED';
    UPDATE leads SET pipeline_id = pid, pipeline_stage_id = sid_qual WHERE organization_id = org.id AND stage = 'QUALIFICATION';
    UPDATE leads SET pipeline_id = pid, pipeline_stage_id = sid_quot WHERE organization_id = org.id AND stage = 'QUOTATION';
    UPDATE leads SET pipeline_id = pid, pipeline_stage_id = sid_neg WHERE organization_id = org.id AND stage = 'NEGOTIATION';
    UPDATE leads SET pipeline_id = pid, pipeline_stage_id = sid_sample WHERE organization_id = org.id AND stage = 'SAMPLE';
    UPDATE leads SET pipeline_id = pid, pipeline_stage_id = sid_won WHERE organization_id = org.id AND stage = 'WON';
    UPDATE leads SET pipeline_id = pid, pipeline_stage_id = sid_lost WHERE organization_id = org.id AND stage = 'LOST';
  END LOOP;

  -- Normalize campaign fields from Meta / Google
  UPDATE leads SET campaign_id = meta_campaign_id, campaign_name = meta_campaign_name
  WHERE meta_campaign_id IS NOT NULL AND campaign_id IS NULL;
  UPDATE leads SET campaign_id = google_ads_campaign_id, campaign_name = google_ads_campaign_name
  WHERE google_ads_campaign_id IS NOT NULL AND campaign_id IS NULL;
END $$;
