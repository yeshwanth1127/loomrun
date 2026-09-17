-- Dual AI credit pools (5h session + weekly) and per-turn usage events.

CREATE TABLE "ai_usage_windows" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "window_type" TEXT NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "limit_credits" INTEGER NOT NULL,
    "used_credits" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_usage_windows_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_usage_events" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "conversation_id" TEXT,
    "source" TEXT NOT NULL,
    "prompt_tokens" INTEGER NOT NULL DEFAULT 0,
    "completion_tokens" INTEGER NOT NULL DEFAULT 0,
    "credits" INTEGER NOT NULL,
    "model" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_usage_windows_organization_id_window_type_key" ON "ai_usage_windows"("organization_id", "window_type");
CREATE INDEX "ai_usage_windows_organization_id_period_end_idx" ON "ai_usage_windows"("organization_id", "period_end");
CREATE INDEX "ai_usage_events_organization_id_created_at_idx" ON "ai_usage_events"("organization_id", "created_at");
CREATE INDEX "ai_usage_events_organization_id_source_created_at_idx" ON "ai_usage_events"("organization_id", "source", "created_at");

ALTER TABLE "ai_usage_windows" ADD CONSTRAINT "ai_usage_windows_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_usage_events" ADD CONSTRAINT "ai_usage_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
