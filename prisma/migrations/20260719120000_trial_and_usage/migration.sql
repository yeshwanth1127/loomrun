-- AlterTable
ALTER TABLE "organizations" ADD COLUMN "trial_ends_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "usage_daily" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "metric" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "usage_daily_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "usage_daily_organization_id_day_idx" ON "usage_daily"("organization_id", "day");

-- CreateIndex
CREATE UNIQUE INDEX "usage_daily_organization_id_day_metric_key" ON "usage_daily"("organization_id", "day", "metric");

-- AddForeignKey
ALTER TABLE "usage_daily" ADD CONSTRAINT "usage_daily_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: free orgs get a 14-day trial from created_at (or remaining window from now if newer)
UPDATE "organizations"
SET "trial_ends_at" = "created_at" + INTERVAL '14 days'
WHERE "plan" = 'free' AND "trial_ends_at" IS NULL;
