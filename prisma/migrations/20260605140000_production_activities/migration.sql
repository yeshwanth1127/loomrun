-- CreateEnum
CREATE TYPE "ProductionActivityType" AS ENUM ('ORDER_CREATED', 'STAGE_CHANGED', 'DELAY_TOGGLED', 'PAYMENT_RECORDED');

-- CreateTable
CREATE TABLE "production_activities" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "production_order_id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "user_id" TEXT,
    "type" "ProductionActivityType" NOT NULL,
    "body" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "production_activities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "production_activities_organization_id_lead_id_created_at_idx" ON "production_activities"("organization_id", "lead_id", "created_at");

-- CreateIndex
CREATE INDEX "production_activities_production_order_id_created_at_idx" ON "production_activities"("production_order_id", "created_at");

-- AddForeignKey
ALTER TABLE "production_activities" ADD CONSTRAINT "production_activities_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_activities" ADD CONSTRAINT "production_activities_production_order_id_fkey" FOREIGN KEY ("production_order_id") REFERENCES "production_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_activities" ADD CONSTRAINT "production_activities_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_activities" ADD CONSTRAINT "production_activities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
