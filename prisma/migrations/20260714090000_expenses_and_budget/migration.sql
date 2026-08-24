-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('FABRIC', 'LABOR', 'OUTSOURCING', 'FREIGHT', 'CONSUMABLES', 'RENT', 'UTILITIES', 'OTHER');

-- AlterEnum
ALTER TYPE "ProductionActivityType" ADD VALUE 'EXPENSE_RECORDED';
ALTER TYPE "ProductionActivityType" ADD VALUE 'BUDGET_SET';

-- AlterTable
ALTER TABLE "production_orders" ADD COLUMN "budget_cents" INTEGER;

-- CreateTable
CREATE TABLE "expenses" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "production_order_id" TEXT,
    "category" "ExpenseCategory" NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "description" TEXT,
    "vendor" TEXT,
    "incurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "expenses_organization_id_incurred_at_idx" ON "expenses"("organization_id", "incurred_at");

-- CreateIndex
CREATE INDEX "expenses_production_order_id_idx" ON "expenses"("production_order_id");

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_production_order_id_fkey" FOREIGN KEY ("production_order_id") REFERENCES "production_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
